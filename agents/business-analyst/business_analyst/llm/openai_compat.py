"""OpenAI-compatible provider (OpenAI, Azure OpenAI, vLLM, Ollama, LM Studio...).

Configured via OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL in .env.
Uses only the standard library to avoid extra runtime dependencies.
"""
import json
import logging
import socket
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterator, List, Optional

from ..config import settings
from .base import LLMProvider

logger = logging.getLogger("business_analyst.llm.openai_compat")


class LLMRateLimitError(RuntimeError):
    """The provider kept rate-limiting the request after bounded retries."""


class OpenAICompatProvider:
    name = "openai_compat"

    def __init__(self):
        self.last_response_meta = {}
        self._session_id = "dmb-agent-" + uuid.uuid4().hex

    def available(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

    def _post(self, path: str, payload: dict, timeout: float = 60.0) -> dict:
        url = settings.OPENAI_BASE_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        is_opencode_zen = host == "opencode.ai" and "/zen/" in url
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "User-Agent": (
                "opencode/latest/1.18.21/cli" if is_opencode_zen else
                "DMB-AI-Business-Analyst/1.0"
            ),
        }
        if is_opencode_zen:
            # Zen applies a separate free-model policy to OpenCode clients.
            # Keep these headers aligned with the locally installed CLI.
            headers["x-opencode-client"] = "cli"
            headers["x-opencode-session"] = self._session_id
        # OpenCode may return a short burst-limit response even when the account
        # quota is available. Retry only that transient status; auth and other
        # errors must remain visible immediately.
        for attempt in range(3):
            req = urllib.request.Request(
                url,
                data=body,
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read()
                    response_headers = getattr(resp, "headers", None)
                    self.last_response_meta = {
                        "http_status": getattr(resp, "status", None),
                        "content_type": response_headers.get("Content-Type") if response_headers else None,
                        "response_bytes": len(raw),
                    }
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code not in {429, 502, 503, 504}:
                    raise
                if attempt == 2:
                    detail = exc.read().decode("utf-8", errors="replace")[:500]
                    raise LLMRateLimitError(
                        f"LLM provider HTTP {exc.code} persisted after 3 attempts: {detail}"
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
                time.sleep(delay)
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                if attempt == 2:
                    raise RuntimeError(
                        f"LLM provider network failure persisted after 3 attempts: {exc}"
                    ) from exc
                delay = float(2 ** attempt)
                logger.warning(
                    "LLM provider network failure; retrying in %.1fs (%d/3)",
                    delay, attempt + 1,
                )
                time.sleep(delay)
        raise RuntimeError("unreachable")

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
        yield from self._stream_post("/chat/completions", payload, timeout=timeout)

    def _stream_post(self, path: str, payload: dict, timeout: float) -> Iterator[str]:
        url = settings.OPENAI_BASE_URL.rstrip("/") + path
        body = json.dumps(payload).encode("utf-8")
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        is_opencode_zen = host == "opencode.ai" and "/zen/" in url
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "User-Agent": "opencode/latest/1.18.21/cli" if is_opencode_zen else "DMB-AI-Business-Analyst/1.0",
        }
        if is_opencode_zen:
            headers["x-opencode-client"] = "cli"
            headers["x-opencode-session"] = self._session_id

        emitted = False
        for attempt in range(3):
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    response_headers = getattr(resp, "headers", None)
                    self.last_response_meta = {
                        "http_status": getattr(resp, "status", None),
                        "content_type": response_headers.get("Content-Type") if response_headers else None,
                        "stream": True,
                    }
                    for raw_line in resp:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
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
                    return
            except urllib.error.HTTPError as exc:
                if emitted or exc.code not in {429, 502, 503, 504}:
                    raise
                if attempt == 2:
                    detail = exc.read().decode("utf-8", errors="replace")[:500]
                    raise LLMRateLimitError(
                        f"LLM provider HTTP {exc.code} persisted after 3 attempts: {detail}"
                    ) from exc
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = min(10.0, max(0.5, float(retry_after)))
                except (TypeError, ValueError):
                    delay = float(2 ** attempt)
                time.sleep(delay)
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                if emitted or attempt == 2:
                    raise RuntimeError(f"LLM provider streaming failed: {exc}") from exc
                time.sleep(float(2 ** attempt))

    def _chat_completion(
        self,
        messages: List[dict],
        system_prompt: Optional[str],
        temperature: float,
        max_tokens: int,
        timeout: float,
        response_format: Optional[dict] = None,
    ) -> str:
        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        payload_messages.extend(messages or [])
        payload = {
            "model": settings.OPENAI_MODEL,
            "messages": payload_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            payload["response_format"] = response_format
        data = self._post("/chat/completions", payload, timeout=timeout)
        try:
            self.last_response_meta["finish_reason"] = data["choices"][0].get("finish_reason")
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError("Unexpected LLM response: " + json.dumps(data)[:500])

    def embed(self, text: str) -> Optional[List[float]]:
        try:
            data = self._post("/embeddings", {
                "model": settings.OPENAI_EMBEDDING_MODEL,
                "input": text,
            })
            return data["data"][0]["embedding"]
        except Exception:
            return None
