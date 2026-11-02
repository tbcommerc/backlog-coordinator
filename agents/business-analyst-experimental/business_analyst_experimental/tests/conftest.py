import pytest

from business_analyst_experimental.config import settings


@pytest.fixture(autouse=True)
def _force_mock_llm():
    """Keep tests deterministic regardless of the local .env: the LLM provider
    is always mocked, so no network calls are made during test runs."""
    settings.LLM_PROVIDER = "mock"
    settings.OPENAI_API_KEY = ""
    yield
