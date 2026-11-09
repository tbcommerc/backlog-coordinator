import pytest

from business_analyst.config import settings


@pytest.fixture(autouse=True)
def _force_mock_llm(monkeypatch):
    """Keep tests deterministic regardless of the local .env: the LLM provider
    is always mocked, so no network calls are made during test runs."""
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "UNIT_TEST_MODE", True)
    settings.LLM_PROVIDER = "mock"
    settings.OPENAI_API_KEY = ""
    yield
