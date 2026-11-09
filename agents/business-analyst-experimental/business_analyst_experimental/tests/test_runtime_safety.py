import pytest

import business_analyst_experimental.llm.rephrase as rephrase_module
from business_analyst_experimental.config import DEFAULT_AGENT_SECRET, settings, validate_runtime_settings
from business_analyst_experimental.llm.rephrase import _preserves_invariants, rephrase_stream


def test_rephrase_rejects_changed_numbers():
    assert not _preserves_invariants("Срок — 5 дней", "Срок — 7 дней")


def test_rephrase_preserves_list_structure():
    assert _preserves_invariants("- Первый\n- Второй", "- Один\n- Два")
    assert not _preserves_invariants("- Первый\n- Второй", "Первый и второй")


def test_rephrase_stream_forwards_provider_chunks(monkeypatch):
    class Provider:
        def available(self):
            return True

        def chat_stream(self, *args, **kwargs):
            yield "Срок — "
            yield "5 дней"

    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai_compat")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "provider-key")
    monkeypatch.setattr(rephrase_module, "OpenAICompatProvider", Provider)
    monkeypatch.setattr(rephrase_module, "_cooldown_until", 0.0)
    deltas = []

    final, streamed = rephrase_stream("Срок — 5 дней", deltas.append)

    assert deltas == ["Срок — ", "5 дней"]
    assert streamed == "Срок — 5 дней"
    assert final == streamed


def test_rephrase_stream_returns_safe_original_after_invalid_stream(monkeypatch):
    class Provider:
        def available(self):
            return True

        def chat_stream(self, *args, **kwargs):
            yield "Срок — 7 дней"

    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai_compat")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "provider-key")
    monkeypatch.setattr(rephrase_module, "OpenAICompatProvider", Provider)
    monkeypatch.setattr(rephrase_module, "_cooldown_until", 0.0)

    final, streamed = rephrase_stream("Срок — 5 дней", lambda _delta: None)

    assert streamed == "Срок — 7 дней"
    assert final == "Срок — 5 дней"


def test_production_rejects_default_secret(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "AGENT_SECRET", DEFAULT_AGENT_SECRET)
    with pytest.raises(RuntimeError):
        validate_runtime_settings()


def test_production_requires_postgresql_session_store(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "SESSION_DATABASE_URL", "sqlite:///agent_v2.db")

    with pytest.raises(RuntimeError, match="SESSION_DATABASE_URL"):
        validate_runtime_settings()


def _valid_production_runtime(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_BASE_URL", "https://opencode.ai/zen/go/v1")
    monkeypatch.setattr(settings, "UNIT_TEST_MODE", False)
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


def test_local_service_rejects_mock_without_unit_mode(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "UNIT_TEST_MODE", False)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "mock")
    with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
        validate_runtime_settings()


def test_explicit_unit_mode_accepts_mock(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "UNIT_TEST_MODE", True)
    validate_runtime_settings()


@pytest.mark.parametrize("provider_name", ["mock", "openai_compat"])
def test_factory_cannot_silently_fallback_in_local_service(monkeypatch, provider_name):
    from business_analyst_experimental.llm.factory import get_llm
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "UNIT_TEST_MODE", False)
    monkeypatch.setattr(settings, "LLM_PROVIDER", provider_name)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    with pytest.raises(RuntimeError):
        get_llm()
