import pytest
from fastapi.testclient import TestClient

from agent.main import app
from agent.api import router as api_router
from agent.orchestrator import AgentOrchestrator
from agent.session import SessionStore


@pytest.fixture()
def client(tmp_path):
    api_router._orchestrator = AgentOrchestrator(SessionStore(str(tmp_path / "api.db")))
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


def test_out_of_domain(client):
    r = client.post("/api/agent/new-session", headers=SECRET, json={"user_id": 1})
    sid = r.json()["session_id"]
    r = client.post("/api/agent/chat", headers=SECRET, json={
        "session_id": sid, "message": "Какой прогноз погоды на выходные?"
    })
    assert r.json()["action"] == "out_of_domain"


def test_send_for_review(client):
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
    assert r.json()["action"] == "sent"
