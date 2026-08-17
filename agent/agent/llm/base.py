"""LLM provider abstraction.

The agent must be able to connect different LLMs via API key. Any provider
must implement LLMProvider. Chat is used for natural language generation
(questions, summaries, drafting); embed is optional for semantic search.
"""
from typing import List, Optional, Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    def available(self) -> bool:
        """Whether the provider is configured and usable."""
        ...

    def chat(
        self,
        messages: List[dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 1024,
    ) -> str:
        """Send a chat conversation and return the assistant text."""
        ...

    def embed(self, text: str) -> Optional[List[float]]:
        """Return embedding vector or None if not supported."""
        ...
