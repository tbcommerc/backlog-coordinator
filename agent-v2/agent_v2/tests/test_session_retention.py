import json
from datetime import datetime, timedelta, timezone

from agent_v2.config import settings
from agent_v2.dialogue.state import DialogueState
from agent_v2.session import SessionStore


def test_dialogue_and_slot_histories_are_bounded(monkeypatch):
    monkeypatch.setattr(settings, "AGENT_HISTORY_MESSAGES", 4)
    monkeypatch.setattr(settings, "AGENT_SLOT_HISTORY_ITEMS", 2)
    state = DialogueState(session_id="bounded", user_id=1)

    for index in range(7):
        state.add_message("user", f"message-{index}")
        state.record_slot_change("role", str(index), str(index + 1))

    assert [item["content"] for item in state.history] == [
        "message-3", "message-4", "message-5", "message-6"
    ]
    assert len(state.slot_history["role"]) == 2


def test_receipts_expire_and_are_removed_with_session(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MESSAGE_RECEIPT_RETENTION_DAYS", 7)
    store = SessionStore(str(tmp_path / "retention.db"))
    state = store.new_session(1)
    store.cache_response(state.session_id, "fresh", {"ok": True})

    expired_at = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    with store.engine.begin() as conn:
        conn.execute(store._message_receipts.insert().values(
            session_id=state.session_id,
            message_id="expired",
            response_json=json.dumps({"expired": True}),
            created_at=expired_at,
        ))

    assert store.get_cached_response(state.session_id, "fresh") == {"ok": True}
    assert store.get_cached_response(state.session_id, "expired") is None

    store.delete(state.session_id)
    with store.engine.connect() as conn:
        assert conn.execute(store._message_receipts.select()).all() == []


def test_fact_memory_roundtrips_without_database_and_survives_history_retention(monkeypatch):
    from agent_v2.session import state_to_dict, state_from_dict
    monkeypatch.setattr(settings, "AGENT_HISTORY_MESSAGES", 2)
    state = DialogueState()
    state.add_message("user", "Пока не знаю эффект", message_id="source-message")
    state.set("value", "Не знаю", evidence="Пока не знаю эффект", message_id="source-message",
              provenance=[{"value": "Не знаю", "evidence": "Пока не знаю эффект", "message_id": "source-message"}])
    state.requirement_conflicts = [{"id": "conflict-1", "field": "role", "slot": "role", "status": "open", "severity": "critical"}]
    state.requirement_assumptions = [{"id": "assumption-1", "field": "role", "text": "возможно трейдер", "status": "open"}]
    for index in range(4):
        state.add_message("user", f"Дополнение {index}")
    restored = state_from_dict(json.loads(json.dumps(state_to_dict(state))))
    assert restored.get_slot("value").status == "unknown"
    assert restored.get_slot("value").message_id == "source-message"
    assert restored.get_slot("value").provenance == state.get_slot("value").provenance
    assert restored.requirement_conflicts == state.requirement_conflicts
    assert restored.requirement_assumptions == state.requirement_assumptions
    restored.set("role", "риск-менеджер", confirmed=True)
    assert restored.requirement_conflicts[0]["status"] == "resolved"
    assert restored.requirement_assumptions[0]["status"] == "resolved"


def test_old_session_without_new_fact_metadata_remains_readable():
    from agent_v2.session import state_from_dict
    state = state_from_dict({"session_id": "old", "user_id": 1,
                             "slots": {"role": {"key": "role", "value": "трейдер", "status": "filled"}}})
    assert state.get("role") == "трейдер"
    assert state.get_slot("role").evidence == ""
    assert state.get_slot("role").provenance == []
    assert state.requirement_conflicts == []
    assert state.requirement_assumptions == []
