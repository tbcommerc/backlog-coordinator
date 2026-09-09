"""Проверка владельца сессии и идемпотентности отправки драфта на ревью.

/agent/send-for-review не должен принимать чужой session_id, обязан
передавать user_id текущего пользователя в agent service и не создавать
дубликаты RequirementRequest для одной и той же сессии.
"""
import pytest

from routers import agent_router
from database import get_db
from main import app
from models import RequirementRequest


def _mock_agent_flow(monkeypatch, sessions={"own-session"}, calls=None, payloads=None):
    monkeypatch.setattr(agent_router, "_user_session_ids", lambda db_, user: set(sessions))

    def fake_call(method, path, payload=None):
        if calls is not None:
            calls.append((method, path))
        if method == "POST" and payloads is not None:
            payloads.append(payload or {})
        if method == "GET" and path == "/api/agent/session/own-session":
            return {"draft": {"title": "Драфт", "completeness_score": 80}}
        if method == "POST" and path == "/api/agent/send-for-review":
            return {"success": True, "action": "sent", "draft": {"title": "Драфт", "completeness_score": 80}}
        if method == "POST" and path == "/api/agent/cancel-review":
            return {"success": True, "action": "cancelled"}
        raise AssertionError(f"Неожиданный вызов агента: {method} {path}")

    monkeypatch.setattr(agent_router, "_call_agent", fake_call)


def test_send_for_review_rejects_foreign_session(client, auth_headers, db, monkeypatch):
    monkeypatch.setattr(
        agent_router, "_user_session_ids", lambda db_, user: {"own-session"}
    )
    resp = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "foreign-session",
        "title": "Тест",
    })
    assert resp.status_code == 404
    assert db.query(RequirementRequest).count() == 0


def test_send_for_review_passes_user_id_to_agent(client, auth_headers, db, monkeypatch):
    payloads = []
    _mock_agent_flow(monkeypatch, payloads=payloads)

    resp = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
    })
    assert resp.status_code == 200
    assert resp.json()["request_id"] == 1
    assert payloads[-1].get("user_id") == 1

    req = db.query(RequirementRequest).first()
    assert req is not None
    assert req.status == "submitted"
    assert req.agent_session_id == "own-session"


def test_send_for_review_is_idempotent(client, auth_headers, db, monkeypatch):
    calls = []
    _mock_agent_flow(monkeypatch, calls=calls)

    first = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
    })
    assert first.status_code == 200
    assert first.json().get("duplicate") is None

    second = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
        "title": "Повторный клик",
    })
    assert second.status_code == 200
    body = second.json()
    assert body["duplicate"] is True
    assert body["request_id"] == first.json()["request_id"]
    assert body["request_url"] == f"#/customer/request/{first.json()['request_id']}"

    assert db.query(RequirementRequest).count() == 1
    send_calls = [c for c in calls if c[0] == "POST" and c[1] == "/api/agent/send-for-review"]
    assert len(send_calls) == 1


def test_send_for_review_allows_resend_after_soft_delete(client, auth_headers, db, monkeypatch):
    _mock_agent_flow(monkeypatch)

    first = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
    })
    request_id = first.json()["request_id"]

    row = db.get(RequirementRequest, request_id)
    row.is_deleted = True
    db.commit()

    second = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
    })
    assert second.status_code == 200
    assert second.json()["request_id"] != request_id
    assert db.query(RequirementRequest).count() == 2


def test_send_for_review_rolls_back_when_agent_does_not_confirm(client, auth_headers, db, monkeypatch):
    _mock_agent_flow(monkeypatch)

    original = agent_router._call_agent
    def reject_send(method, path, payload=None):
        if method == "POST" and path == "/api/agent/send-for-review":
            return {"success": True, "action": "error", "message": "Черновик не подтверждён"}
        return original(method, path, payload)
    monkeypatch.setattr(agent_router, "_call_agent", reject_send)

    resp = client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
        "session_id": "own-session",
    })
    assert resp.status_code == 409
    assert db.query(RequirementRequest).count() == 0


def test_send_for_review_compensates_agent_when_backend_commit_fails(
    client, auth_headers, db, monkeypatch,
):
    calls = []
    confirmed = False
    monkeypatch.setattr(agent_router, "_user_session_ids", lambda db_, user: {"own-session"})

    def fake_call(method, path, payload=None):
        nonlocal confirmed
        calls.append((method, path, payload or {}))
        if method == "GET":
            return {"draft": {"title": "Драфт", "completeness_score": 80}}
        if path == "/api/agent/send-for-review":
            confirmed = True
            return {"success": True, "action": "sent", "draft": {"title": "Драфт", "completeness_score": 80}}
        if path == "/api/agent/cancel-review":
            return {"success": True, "action": "cancelled"}
        raise AssertionError(f"Неожиданный вызов: {method} {path}")

    monkeypatch.setattr(agent_router, "_call_agent", fake_call)
    def use_test_session():
        yield db
    monkeypatch.setitem(app.dependency_overrides, get_db, use_test_session)
    original_commit = db.commit

    def fail_after_agent_confirmation():
        if confirmed:
            raise RuntimeError("injected commit failure")
        return original_commit()

    monkeypatch.setattr(db, "commit", fail_after_agent_confirmation)
    with pytest.raises(RuntimeError, match="injected commit failure"):
        client.post("/api/v1/agent/send-for-review", headers=auth_headers, json={
            "session_id": "own-session",
        })

    cancel_calls = [call for call in calls if call[1] == "/api/agent/cancel-review"]
    assert len(cancel_calls) == 1
    assert cancel_calls[0][2]["task_id"] == 1


def test_activate_session_rejects_foreign_dialogue(client, auth_headers, monkeypatch):
    monkeypatch.setattr(agent_router, "_user_session_ids", lambda db_, user: {"own-session"})
    resp = client.post("/api/v1/agent/session/foreign-session/activate", headers=auth_headers)
    assert resp.status_code == 404
