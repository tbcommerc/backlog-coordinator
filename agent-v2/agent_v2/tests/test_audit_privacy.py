import json

from agent_v2 import audit


def _read_single_event(tmp_path):
    rows = (tmp_path / "audit.log").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 1
    return json.loads(rows[0])


def test_refusal_audit_does_not_persist_rejected_input(tmp_path, monkeypatch):
    monkeypatch.setattr(audit, "LOG_DIR", tmp_path)
    sensitive = "Карта 4111 1111 1111 1111, пароль secret-value"

    audit.log_refusal("session-1", 7, "malicious_or_policy_violation", sensitive)

    event = _read_single_event(tmp_path)
    assert event["message_length"] == len(sensitive)
    assert "message_preview" not in event
    assert sensitive not in json.dumps(event, ensure_ascii=False)
    assert "4111" not in json.dumps(event, ensure_ascii=False)


def test_dialogue_audit_records_metadata_without_message_body(tmp_path, monkeypatch):
    monkeypatch.setattr(audit, "LOG_DIR", tmp_path)
    message = "Внутренний текст требования"

    audit.log_dialogue("session-2", 8, "BA", message, "ask")

    event = _read_single_event(tmp_path)
    assert event["message_length"] == len(message)
    assert "message_preview" not in event
    assert message not in json.dumps(event, ensure_ascii=False)
