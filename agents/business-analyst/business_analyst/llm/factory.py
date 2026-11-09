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
        if not (settings.DEBUG and settings.UNIT_TEST_MODE):
            raise RuntimeError("OpenAI-compatible LLM provider is unavailable; configure OPENAI_API_KEY")
        # Only explicitly isolated unit tests may use a deterministic provider.
        return MockProvider()
    if settings.DEBUG and settings.UNIT_TEST_MODE and provider_name == "mock":
        return MockProvider()
    raise RuntimeError("Unsupported LLM_PROVIDER or unit mode is not enabled")
