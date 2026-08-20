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
