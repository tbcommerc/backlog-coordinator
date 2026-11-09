"""OpenAI-compatible LLM adapter shared by configuration with DMB AI Agent."""

from __future__ import annotations

import json
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone
from dmb_agent_contracts.model import ModelRequest, Message, AgentError
from dmb_agent_contracts.chat import ChatCompletionModel
from dmb_agent_contracts.operation import bind_request,reserve_model_attempt
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import Any

import httpx

from value_priority_assessor.llm.base import SYSTEM_PROMPT, TaskHints, build_user_prompt, parse_hints


@lru_cache(maxsize=1)
def _http_client() -> httpx.Client:
    """A thread-safe process client reuses TCP/TLS connections between calls."""
    return httpx.Client(
        limits=httpx.Limits(
            max_connections=16,
            max_keepalive_connections=8,
            keepalive_expiry=30.0,
        )
    )


def close_http_client() -> None:
    """Close pooled connections during controlled shutdowns and tests."""
    if _http_client.cache_info().currsize:
        _http_client().close()
        _http_client.cache_clear()


class OpenAICompatAdapter:
    """Adapter for OpenAI, Azure-compatible gateways, vLLM and local proxies."""

    name = "openai_compat"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float = 30.0,
        protocol: str = "chat_completions",
        retry_attempts: int = 3,
        retry_base_seconds: float = 0.5,
        retry_max_seconds: float = 5.0,
    ) -> None:
        if protocol != "chat_completions":
            raise AgentError("model_capability_missing", 422)
        if not api_key.strip():
            raise RuntimeError("не задан PRIORITISER_OPENAI_API_KEY")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.retry_attempts = max(1, retry_attempts)
        self.retry_base_seconds = max(0.0, retry_base_seconds)
        self.retry_max_seconds = max(self.retry_base_seconds, retry_max_seconds)
        self.last_usage: dict[str, int | float | None] = {}
        self.cache_profile_ref = hashlib.sha256(json.dumps({"base_url":self.base_url,"protocol":protocol},
            sort_keys=True).encode()).hexdigest()
        from value_priority_assessor.config import get_settings
        if get_settings().execution_backend == "opencode":
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            self.cache_profile_ref = RemoteProfile.from_settings(get_settings()).profile_ref

    def _retry_delay(self, response: httpx.Response | None, attempt: int) -> float:
        retry_after = response.headers.get("Retry-After") if response is not None else None
        if retry_after:
            try:
                return min(self.retry_max_seconds, max(0.0, float(retry_after)))
            except ValueError:
                try:
                    retry_at = parsedate_to_datetime(retry_after)
                    delay = retry_at.timestamp() - time.time()
                    return min(self.retry_max_seconds, max(0.0, delay))
                except (TypeError, ValueError, OverflowError):
                    pass
        return min(
            self.retry_max_seconds,
            self.retry_base_seconds * (2**attempt),
        )

    def _complete(
        self,
        system: str,
        user: str,
        *,
        max_tokens: int,
        schema: dict[str, Any] | None = None,
    ) -> str:
        request = bind_request(ModelRequest(request_id=uuid.uuid4(), run_id=uuid.uuid4(), purpose="factor_assessment",
            messages=[Message(role="user", content=user)], system_prompt=system, output_schema=schema,
            model_profile="local-go-direct", deadline_at=datetime.now(timezone.utc)+timedelta(seconds=self.timeout),
            max_output_tokens=max_tokens, temperature=.1))
        return self.complete_model(request).text

    def complete_model(self, request):
        from value_priority_assessor.config import get_settings
        if get_settings().execution_backend == "opencode":
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            result = RemoteProfile.from_settings(get_settings()).model_port().complete(request)
            self.last_usage = {"tokens_in": result.usage.input_tokens, "tokens_out": result.usage.output_tokens,
                "reasoning_tokens": result.usage.reasoning_tokens, "cache_tokens": result.usage.cache_tokens,
                "unavailable_reason": result.usage.unavailable_reason, "latency_ms": result.elapsed_ms}
            return result
        request=bind_request(request)
        if request.conversation_ref is None:
            role=hashlib.sha256((request.system_prompt+"\0"+json.dumps(request.output_schema,sort_keys=True)).encode()).hexdigest()
            request=request.model_copy(update={"conversation_ref":f"dmb-assessor:{request.run_id}:{role}"})
        metadata = {}
        def transport(path, payload, timeout):
            return self._post_chat(path, payload, timeout, request, metadata)
        result = ChatCompletionModel(transport=transport, model=self.model, response_meta=metadata).complete(request)
        self.last_usage = {"tokens_in": result.usage.input_tokens, "tokens_out": result.usage.output_tokens,
                           "reasoning_tokens": result.usage.reasoning_tokens, "cache_tokens": result.usage.cache_tokens,
                           "unavailable_reason": result.usage.unavailable_reason, "latency_ms": result.elapsed_ms}
        return result

    def _post_chat(self, path, payload, timeout, request, metadata):
        started = time.perf_counter()
        is_opencode_zen = (
            httpx.URL(self.base_url).host == "opencode.ai"
            and any(route in self.base_url for route in ("/zen/", "/inference/go/openai/"))
        )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "DMB-Value-Priority-Assessor/1.0",
        }
        if is_opencode_zen:
            headers["x-opencode-session"] = str(uuid.uuid5(uuid.NAMESPACE_URL, request.conversation_ref or str(request.run_id)))
        response: httpx.Response | None = None
        deadline = time.monotonic()+timeout
        for attempt in range(self.retry_attempts):
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                raise AgentError("operation_deadline_exceeded", 504)
            try:
                reserve_model_attempt()
                response = _http_client().post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=remaining,
                )
                response.raise_for_status()
                metadata["attempt_count"] = attempt+1
                break
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status not in {429, 502, 503, 504} or attempt + 1 >= self.retry_attempts:
                    raise
                from value_priority_assessor.service.metrics import record_llm_retry

                record_llm_retry()
                delay = self._retry_delay(exc.response, attempt)
                if time.monotonic()+delay >= deadline:
                    raise AgentError("operation_deadline_exceeded", 504) from None
                time.sleep(delay)
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt + 1 >= self.retry_attempts:
                    raise
                from value_priority_assessor.service.metrics import record_llm_retry

                record_llm_retry()
                delay = self._retry_delay(None, attempt)
                if time.monotonic()+delay >= deadline:
                    raise AgentError("operation_deadline_exceeded", 504) from None
                time.sleep(delay)

        if response is None:  # pragma: no cover - loop always attempts at least once
            raise RuntimeError("OpenAI-compatible запрос не был выполнен")
        return response.json()

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        text = self._complete(
            SYSTEM_PROMPT,
            build_user_prompt(task_text, team, team_class),
            max_tokens=512,
            schema={"type": "object"},
        )
        return parse_hints(text, self.name)

    def complete(self, system: str | ModelRequest, user: str | None = None, schema: dict | None = None):
        if isinstance(system, ModelRequest):
            return self.complete_model(system)
        return self._complete(system, user, max_tokens=1024, schema=schema)
