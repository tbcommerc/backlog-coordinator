"""Deterministic offline provider (no API key needed).

Used for demo, development and tests. Natural-language generation is handled
by template generators in the dialogue engine; this provider only exposes a
minimal chat() so that the rest of the code never depends on network access.
"""
from typing import Iterator, List, Optional

from .base import LLMProvider


class MockProvider:
    name = "mock"

    def available(self) -> bool:
        return True

    def chat(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
    ) -> str:
        last_user = ""
        for m in reversed(messages or []):
            if m.get("role") == "user":
                last_user = m.get("content", "")
                break
        return (
            "Продолжаем собирать требование. "
            "Уточните, пожалуйста, детали по вашему запросу: "
            + (last_user[:200] if last_user else "опишите суть потребности.")
        )

    def chat_stream(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
    ) -> Iterator[str]:
        yield self.chat(messages, system_prompt, temperature, max_tokens)

    def embed(self, text: str) -> Optional[List[float]]:
        return None
