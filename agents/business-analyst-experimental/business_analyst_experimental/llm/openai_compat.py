"""OpenAI-compatible provider (OpenAI, Azure OpenAI, vLLM, Ollama, LM Studio...).

Configured via OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL in .env.
Uses only the standard library to avoid extra runtime dependencies.
"""
import json
import logging
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Iterator, List, Optional
from datetime import datetime, timedelta, timezone
from dmb_agent_contracts.model import ModelRequest, Message, AgentError
from dmb_agent_contracts.chat import ChatCompletionModel
from dmb_agent_contracts.http import response_bytes, sse_lines
from dmb_agent_contracts.operation import bind_request,check_operation,reserve_model_attempt,limit_timeout

from ..config import settings
from .base import LLMProvider
from .http import open_http
from .context import current_llm_session

logger = logging.getLogger("business_analyst_experimental.llm.openai_compat")
USER_AGENT = "DMB-AI-Business-Analyst-V2/2.0"


class LLMRateLimitError(AgentError):
    """Compatibility exception with a safe common error code."""
    def __init__(self, message, provider_status=429):
        super().__init__("provider_quota_exhausted" if provider_status == 429 else "provider_unavailable")
        self.args = (message,)


class LLMResponseIncompleteError(RuntimeError):
    """The model exhausted its output budget before finishing structured output."""


class OpenAICompatProvider:
    name = "openai_compat"

    def __init__(self):
        self.last_response_meta = {}
        self.model_purpose = "dialogue"
        # Optional shared budget for a multi-step document operation. Ordinary
        # dialogue/check calls retain their existing per-attempt timeouts.
        self.operation_deadline = None
        self._standalone_session_id = "dmb-v2-" + uuid.uuid4().hex

    def available(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

    def _headers(self, url: str) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "User-Agent": USER_AGENT,
        }
        endpoint = urllib.parse.urlsplit(url)
        is_opencode = (
            endpoint.scheme == "https" and endpoint.hostname == "opencode.ai"
            and endpoint.port in (None, 443)
            and endpoint.username is None and endpoint.password is None
            and any(endpoint.path == prefix or endpoint.path.startswith(prefix + "/")
                    for prefix in ("/zen/v1", "/zen/go/v1", "/inference/go/openai/v1"))
        )
        if is_opencode:
            headers["x-opencode-session"] = current_llm_session() or self._standalone_session_id
        return headers

    def _post(self, path: str, payload: dict, timeout: float = 60.0) -> dict:
        url = settings.OPENAI_BASE_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        headers = self._headers(url)
        # OpenCode may return a short burst-limit response even when the account
        # quota is available. Retry only that transient status; auth and other
        # errors must remain visible immediately.
        deadline = time.monotonic() + limit_timeout(timeout)
        for attempt in range(3):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AgentError("operation_deadline_exceeded", 504)
            attempt_timeout = remaining
            if self.operation_deadline is not None:
                remaining = self.operation_deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('document_operation_deadline')
                attempt_timeout = min(attempt_timeout, remaining)
            req = urllib.request.Request(
                url,
                data=body,
                headers=headers,
                method="POST",
            )
            try:
                reserve_model_attempt()
                with open_http(req, timeout=attempt_timeout) as resp:
                    raw = response_bytes(resp, min(deadline,self.operation_deadline) if self.operation_deadline is not None else deadline)
                    response_headers = getattr(resp, "headers", None)
                    self.last_response_meta = {
                        "http_status": getattr(resp, "status", None),
                        "content_type": response_headers.get("Content-Type") if response_headers else None,
                        "response_bytes": len(raw),
                        "attempt_count": attempt + 1,
                    }
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code not in {429, 502, 503, 504}:
                    raise
                if attempt == 2:
                    raise LLMRateLimitError(
                        f"LLM provider HTTP {exc.code} persisted after 3 attempts", provider_status=exc.code
                    ) from exc
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = min(10.0, max(0.5, float(retry_after)))
                except (TypeError, ValueError):
                    delay = float(2 ** attempt)
                logger.warning(
                    "LLM provider returned HTTP %d; retrying in %.1fs (%d/3)",
                    exc.code, delay, attempt + 1,
                )
                if time.monotonic() + delay >= deadline:
                    raise AgentError("operation_deadline_exceeded", 504) from None
                self._retry_sleep(delay)
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                if attempt == 2:
                    raise RuntimeError(
                        "LLM provider network failure persisted after 3 attempts"
                    ) from exc
                delay = float(2 ** attempt)
                logger.warning(
                    "LLM provider network failure; retrying in %.1fs (%d/3)",
                    delay, attempt + 1,
                )
                if time.monotonic() + delay >= deadline:
                    raise AgentError("operation_deadline_exceeded", 504) from None
                self._retry_sleep(delay)
        raise RuntimeError("unreachable")

    def _retry_sleep(self, delay: float) -> None:
        if self.operation_deadline is not None and time.monotonic() + delay >= self.operation_deadline:
            raise TimeoutError('document_operation_deadline')
        time.sleep(delay)

    def chat(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
        timeout: float = 60.0,
    ) -> str:
        return self._chat_completion(
            messages, system_prompt=system_prompt, temperature=temperature,
            max_tokens=max_tokens, timeout=timeout,
        )

    def chat_json(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
        timeout: float = 60.0,
    ) -> str:
        """Request a JSON object from providers that support JSON mode."""
        return self._chat_completion(
            messages, system_prompt=system_prompt, temperature=temperature,
            max_tokens=max_tokens, timeout=timeout,
            response_format={"type": "json_object"},
        )

    def chat_stream(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
        timeout: float = 60.0,
    ) -> Iterator[str]:
        """Yield text deltas from an OpenAI-compatible SSE response."""
        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        payload_messages.extend(messages or [])
        payload = {
            "model": settings.OPENAI_MODEL,
            "messages": payload_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if settings.OPENAI_REASONING_EFFORT:
            payload["reasoning_effort"] = settings.OPENAI_REASONING_EFFORT
        yield from self._stream_post("/chat/completions", payload, timeout=timeout)

    def _stream_post(self, path: str, payload: dict, timeout: float) -> Iterator[str]:
        url = settings.OPENAI_BASE_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        headers = self._headers(url)

        deadline = time.monotonic()+limit_timeout(timeout)
        emitted = False
        for attempt in range(3):
            remaining=deadline-time.monotonic()
            if remaining<=0:
                raise AgentError("operation_deadline_exceeded",504)
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            try:
                reserve_model_attempt()
                with open_http(req, timeout=remaining) as resp:
                    response_headers = getattr(resp, "headers", None)
                    self.last_response_meta = {
                        "http_status": getattr(resp, "status", None),
                        "content_type": response_headers.get("Content-Type") if response_headers else None,
                        "stream": True,
                    }
                    for raw_line in sse_lines(resp,deadline):
                        check_operation()
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            if self.last_response_meta.get("finish_reason")=="length":
                                raise AgentError("model_result_incomplete",502)
                            return
                        try:
                            chunk = json.loads(data)
                            choice = chunk["choices"][0]
                            self.last_response_meta["finish_reason"] = choice.get("finish_reason")
                            content = choice.get("delta", {}).get("content")
                        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                            continue
                        if isinstance(content, list):
                            content = "".join(
                                str(part.get("text") or "") for part in content if isinstance(part, dict)
                            )
                        if content:
                            emitted = True
                            yield str(content)
                    if self.last_response_meta.get("finish_reason")=="length":
                        raise AgentError("model_result_incomplete",502)
                    return
            except urllib.error.HTTPError as exc:
                if emitted or exc.code not in {429, 502, 503, 504}:
                    raise
                if attempt == 2:
                    raise LLMRateLimitError(
                        f"LLM provider HTTP {exc.code} persisted after 3 attempts", provider_status=exc.code
                    ) from exc
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = min(10.0, max(0.5, float(retry_after)))
                except (TypeError, ValueError):
                    delay = float(2 ** attempt)
                if time.monotonic()+delay>=deadline:
                    raise AgentError("operation_deadline_exceeded",504) from None
                time.sleep(delay)
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                if emitted or attempt == 2:
                    raise RuntimeError("LLM provider streaming failed") from exc
                delay=float(2 ** attempt)
                if time.monotonic()+delay>=deadline:
                    raise AgentError("operation_deadline_exceeded",504) from None
                time.sleep(delay)

    def _chat_completion(
        self,
        messages: List[dict],
        system_prompt: Optional[str],
        temperature: float,
        max_tokens: int,
        timeout: float,
        response_format: Optional[dict] = None,
    ) -> str:
        if settings.MODEL_PROTOCOL != "chat_completions":
            raise AgentError("model_capability_missing", 422)
        request = bind_request(ModelRequest(request_id=uuid.uuid4(), run_id=uuid.uuid4(),
            conversation_ref=current_llm_session(), purpose=self.model_purpose,
            messages=[Message(**message) for message in messages], system_prompt=system_prompt or "",
            output_schema={"type": "object"} if response_format else None,
            model_profile="local-go-direct", deadline_at=datetime.now(timezone.utc)+timedelta(seconds=timeout),
            max_output_tokens=max_tokens, temperature=temperature,
            reasoning_effort=settings.OPENAI_REASONING_EFFORT or None))
        return self.complete(request).text

    def complete(self, request):
        """ModelPort; domain parsing and application remain in this service."""
        if settings.EXECUTION_BACKEND == "opencode":
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            result = RemoteProfile.from_settings(settings).model_port().complete(request)
            self.last_response_meta = {"finish_reason": result.finish_reason, "attempt_count": result.attempt_count,
                "usage": result.usage.model_dump()}
            return result
        metadata = {}
        def transport(path, payload, timeout):
            data = self._post(path, payload, timeout=timeout)
            metadata.update(self.last_response_meta)
            self.last_response_meta = metadata
            return data
        port = ChatCompletionModel(transport=transport, model=settings.OPENAI_MODEL,
                                   response_meta=metadata)
        try:
            result = port.complete(request)
        except AgentError as error:
            if error.code == "model_result_incomplete":
                raise LLMResponseIncompleteError("Structured response exceeded the configured token budget") from None
            raise
        self.last_response_meta["usage"] = result.usage.model_dump()
        return result

    def embed(self, text: str) -> Optional[List[float]]:
        # A chat subscription does not qualify an embeddings endpoint/model.
        if not settings.EMBEDDINGS_ENABLED:
            return None
        raise AgentError("embedding_capability_not_qualified",422)
