"""LLM provider factory: picks provider by settings.LLM_PROVIDER."""
from ..config import settings
from .base import LLMProvider
from .mock import MockProvider
from .openai_compat import OpenAICompatProvider


def get_llm() -> LLMProvider:
    provider_name = (settings.LLM_PROVIDER or "mock").strip().lower()
    if provider_name == "openai_compat":
        provider = OpenAICompatProvider()
        if provider.available():
            return provider
        if not settings.DEBUG:
            raise RuntimeError("OpenAI-compatible LLM provider is unavailable in production")
        # Development keeps an explicit local fallback for offline work.
        return MockProvider()
    if settings.DEBUG and provider_name == "mock":
        return MockProvider()
    raise RuntimeError(f"Unsupported LLM provider: {provider_name or '<empty>'}")
