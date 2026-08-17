"""OpenAI-compatible provider (OpenAI, Azure OpenAI, vLLM, Ollama, LM Studio...).

Configured via OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL in .env.
Uses only the standard library to avoid extra runtime dependencies.
"""
import json
import urllib.error
import urllib.request
from typing import List, Optional

from ..config import settings
from .base import LLMProvider


class OpenAICompatProvider:
    name = "openai_compat"

    def available(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

    def _post(self, path: str, payload: dict, timeout: float = 60.0) -> dict:
        url = settings.OPENAI_BASE_URL.rstrip("/") + path
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

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
