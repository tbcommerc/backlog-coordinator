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
        # Fallback to mock when API key is missing so the app never breaks.
        return MockProvider()
    return MockProvider()
