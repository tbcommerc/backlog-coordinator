import pytest
from fastapi.testclient import TestClient

from agent.main import app
from agent.api import router as api_router
from agent.agentic_orchestrator import AgenticOrchestrator
from agent.dialogue.agentic import Fact, TurnDecision
from agent.session import SessionStore


@pytest.fixture()
def client(tmp_path, monkeypatch):
    api_router._orchestrator = AgenticOrchestrator(SessionStore(str(tmp_path / "api.db")))
    def decision(state, text):
        facts = [] if text.lower() in {"да", "да, всё верно"} else [Fact("need_statement", text, 0.9, evidence=text)]
        return TurnDecision(facts=facts, next_action="ask", focus="to_be",
                            reply="Как должен выглядеть целевой результат?", source="llm")
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", decision)
    with TestClient(app) as c:
        yield c


SECRET = {"X-Agent-Secret": "dmb-agent-local-secret-2026"}


def test_config_requires_secret(client):
    assert client.get("/api/agent/config").status_code == 403


def test_config_ok(client):
    r = client.get("/api/agent/config", headers=SECRET)
    assert r.status_code == 200
    assert r.json()["provider"] == "mock"


def test_full_chat_flow(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 5})
    assert r.status_code == 200
    sid = r.json()["session_id"]

    r = client.post("/api/agent/chat", headers=SECRET, json={
        "session_id": sid,
        "message": "Нужно, чтобы бэк-офицеры видели, по каким сделкам с облигациями не прошли расчёты, и могли отправлять повторный запрос",
    })
    assert r.status_code == 200
    assert r.json()["action"] in ("reflect", "question")

    r = client.post("/api/agent/chat", headers=SECRET, json={"session_id": sid, "message": "да"})
    assert r.json()["action"] in ("question", "reflect", "summarize")


def test_chat_message_id_is_idempotent(client):
    created = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 6})
    sid = created.json()["session_id"]
    payload = {
        "session_id": sid,
        "message_id": "browser-message-1",
        "message": "Какой прогноз погоды на выходные?",
    }

    first = client.post("/api/agent/chat", headers=SECRET, json=payload)
    history_after_first = api_router._orchestrator.store.get(sid).history
    second = client.post("/api/agent/chat", headers=SECRET, json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    state = api_router._orchestrator.store.get(sid)
    assert state.history == history_after_first


def test_chat_stream_preserves_validated_reply_without_second_model_call(client, monkeypatch):
    created = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 17})
    sid = created.json()["session_id"]

    def stream_reply(_source, on_delta):
        raise AssertionError("Validated active reply must not be rewritten by a second model")

    monkeypatch.setattr(api_router, "rephrase_stream", stream_reply)
    payload = {
        "session_id": sid,
        "message_id": "stream-message-1",
        "message": "Нужен контроль расчётов по сделкам",
    }
    response = client.post("/api/agent/chat-stream", headers=SECRET, json=payload)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'event: ready' in response.text
    assert response.text.count('event: delta') >= 1
    assert 'event: result' in response.text
    assert "Как должен выглядеть целевой результат?" in response.text
    assert api_router._orchestrator.store.get(sid).history[-1]["content"] == "Как должен выглядеть целевой результат?"

    history = list(api_router._orchestrator.store.get(sid).history)
    replay = client.post("/api/agent/chat-stream", headers=SECRET, json=payload)
    assert 'event: result' in replay.text
    assert 'event: delta' not in replay.text
    assert api_router._orchestrator.store.get(sid).history == history


def test_user_message_is_persisted_before_processing_failure(client, monkeypatch):
    created = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 16})
    sid = created.json()["session_id"]

    def fail_before_response(_message):
        raise RuntimeError("processing failed")

    monkeypatch.setattr(
        "agent.orchestrator.input_harness.classify_domain_detailed",
        fail_before_response,
    )
    with pytest.raises(RuntimeError, match="processing failed"):
        client.post("/api/agent/chat", headers=SECRET, json={
            "session_id": sid,
            "message_id": "accepted-before-failure",
            "message": "Нужен контроль расчётов по сделкам",
        })

    state = api_router._orchestrator.store.get(sid)
    assert state.history[-1] == {
        "role": "user",
        "content": "Нужен контроль расчётов по сделкам",
        "message_id": "accepted-before-failure",
    }


def test_out_of_domain(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 1})
    sid = r.json()["session_id"]
    r = client.post("/api/agent/chat", headers=SECRET, json={
        "session_id": sid, "message": "Какой прогноз погоды на выходные?"
    })
    assert r.json()["action"] == "out_of_domain"


def test_session_can_be_archived_and_restored(client):
    created = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 15})
    sid = created.json()["session_id"]

    archived = client.post(f"/api/agent/session/{sid}/archive?archived=true", headers=SECRET)
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    sessions = client.get("/api/agent/sessions?user_id=15", headers=SECRET).json()["sessions"]
    assert sessions[0]["archived"] is True

    restored = client.post(f"/api/agent/session/{sid}/archive?archived=false", headers=SECRET)
    assert restored.status_code == 200
    assert restored.json()["archived"] is False


def test_send_for_review_rejects_unconfirmed_draft(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 2})
    sid = r.json()["session_id"]
    r = client.post("/api/agent/chat", headers=SECRET, json={
        "session_id": sid,
        "message": "Нужна доработка: расчёты по облигациям не проходят, нужен повторный запрос",
    })
    client.post("/api/agent/chat", headers=SECRET, json={"session_id": sid, "message": "да"})
    client.post("/api/agent/chat", headers=SECRET, json={"session_id": sid, "message": "да, всё верно"})

    r = client.post("/api/agent/send-for-review", headers=SECRET, json={
        "session_id": sid, "task_id": 999, "title": "Тест"
    })
    assert r.json()["action"] == "error"


def _force_confirmed_draft(client, sid):
    orch = api_router._orchestrator
    state = orch.store.get(sid)
    state.draft = {"title": "Тест", "completeness_score": 80,
                   "problem_statement": "Нужна сверка", "target_process": "Система сверяет расчёты",
                   "primary_role": "Оператор", "process": "Сверка расчётов"}
    state.confirmed = True
    orch.store.save(state)


def test_send_for_review_rejects_foreign_user(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 5})
    sid = r.json()["session_id"]
    _force_confirmed_draft(client, sid)

    r = client.post("/api/agent/send-for-review", headers=SECRET, json={
        "session_id": sid, "task_id": 1, "title": "Тест", "user_id": 999,
    })
    assert r.status_code == 200
    assert r.json()["action"] == "error"
    assert "доступа" in r.json()["message"]

    state = api_router._orchestrator.store.get(sid)
    assert state.review_status != "needs_review"


def test_send_for_review_allows_owner_with_user_id(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 5})
    sid = r.json()["session_id"]
    _force_confirmed_draft(client, sid)

    r = client.post("/api/agent/send-for-review", headers=SECRET, json={
        "session_id": sid, "task_id": 1, "title": "Тест", "user_id": 5,
    })
    assert r.status_code == 200
    assert r.json()["action"] == "sent"


def test_chat_unknown_session_returns_404(client):
    response = client.post("/api/agent/chat", headers=SECRET, json={
        "session_id": "missing-session", "message": "Привет",
    })
    assert response.status_code == 404
