"""OpenAI-compatible LLM adapter shared by configuration with DMB AI Agent."""

from __future__ import annotations

import json
import time
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import Any

import httpx

from app.llm.base import SYSTEM_PROMPT, TaskHints, build_user_prompt, parse_hints


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
        retry_attempts: int = 3,
        retry_base_seconds: float = 0.5,
        retry_max_seconds: float = 5.0,
    ) -> None:
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
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if schema is not None:
            # Matches the JSON mode already used by the business-requirements
            # agent and remains compatible with generic OpenAI gateways.
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        is_opencode_zen = (
            httpx.URL(self.base_url).host == "opencode.ai"
            and "/zen/" in self.base_url
        )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": (
                "opencode/latest/1.18.21/cli"
                if is_opencode_zen
                else "DMB-Task-Prioritiser/1.0"
            ),
        }
        if is_opencode_zen:
            headers["x-opencode-client"] = "cli"
        response: httpx.Response | None = None
        for attempt in range(self.retry_attempts):
            try:
                response = _http_client().post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                break
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status not in {429, 502, 503, 504} or attempt + 1 >= self.retry_attempts:
                    raise
                from app.service.metrics import record_llm_retry

                record_llm_retry()
                time.sleep(self._retry_delay(exc.response, attempt))
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt + 1 >= self.retry_attempts:
                    raise
                from app.service.metrics import record_llm_retry

                record_llm_retry()
                time.sleep(self._retry_delay(None, attempt))

        if response is None:  # pragma: no cover - loop always attempts at least once
            raise RuntimeError("OpenAI-compatible запрос не был выполнен")
        data = response.json()
        usage = data.get("usage") or {}
        self.last_usage = {
            "tokens_in": usage.get("prompt_tokens"),
            "tokens_out": usage.get("completion_tokens"),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                "OpenAI-compatible провайдер вернул неожиданный ответ: "
                + json.dumps(data, ensure_ascii=False)[:500]
            ) from exc

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        text = self._complete(
            SYSTEM_PROMPT,
            build_user_prompt(task_text, team, team_class),
            max_tokens=512,
            schema={"type": "object"},
        )
        return parse_hints(text, self.name)

    def complete(self, system: str, user: str, schema: dict | None = None) -> str:
        return self._complete(system, user, max_tokens=1024, schema=schema)
