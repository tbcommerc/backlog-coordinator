import pytest

from agent.config import DEFAULT_AGENT_SECRET, settings, validate_runtime_settings
from agent.llm.rephrase import _preserves_invariants


def test_rephrase_rejects_changed_numbers():
    assert not _preserves_invariants("Срок — 5 дней", "Срок — 7 дней")


def test_rephrase_preserves_list_structure():
    assert _preserves_invariants("- Первый\n- Второй", "- Один\n- Два")
    assert not _preserves_invariants("- Первый\n- Второй", "Первый и второй")


def test_production_rejects_default_secret(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "AGENT_SECRET", DEFAULT_AGENT_SECRET)
    with pytest.raises(RuntimeError):
        validate_runtime_settings()


def test_production_requires_postgresql_session_store(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "SESSION_DATABASE_URL", "sqlite:///agent.db")

    with pytest.raises(RuntimeError, match="SESSION_DATABASE_URL"):
        validate_runtime_settings()


def _valid_production_runtime(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "SESSION_DATABASE_URL", "postgresql+psycopg://agent:test@db/agent_sessions")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai_compat")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "provider-key")


def test_production_rejects_mock_provider(monkeypatch):
    _valid_production_runtime(monkeypatch)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "mock")
    with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
        validate_runtime_settings()


def test_production_requires_provider_key(monkeypatch):
    _valid_production_runtime(monkeypatch)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        validate_runtime_settings()


def test_valid_production_runtime_is_accepted(monkeypatch):
    _valid_production_runtime(monkeypatch)
    validate_runtime_settings()
