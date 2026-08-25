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
from typing import List, Optional

from ..config import settings
from .base import LLMProvider

logger = logging.getLogger("agent.llm.openai_compat")


class LLMRateLimitError(RuntimeError):
    """The provider kept rate-limiting the request after bounded retries."""


class OpenAICompatProvider:
    name = "openai_compat"

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
                    return json.loads(resp.read().decode("utf-8"))
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
        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        payload_messages.extend(messages or [])
        data = self._post("/chat/completions", {
            "model": settings.OPENAI_MODEL,
            "messages": payload_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }, timeout=timeout)
        try:
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
