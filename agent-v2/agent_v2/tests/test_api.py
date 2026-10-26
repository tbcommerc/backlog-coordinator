import pytest
import threading
from fastapi.testclient import TestClient

from agent_v2.api import router as api_router
from agent_v2.config import settings
from agent_v2.dialogue.agentic import Fact, TurnDecision
from agent_v2.main import app
from agent_v2.llm.context import current_llm_session, llm_session
from agent_v2.llm.openai_compat import OpenAICompatProvider
from agent_v2.session import SessionStore
from agent_v2.v2.orchestrator import V2Orchestrator


SECRET = {"X-Agent-Secret": "dmb-agent-v2-local-secret-2026"}


def _context(user_id=5, role="BA"):
    return {
        "user_id": user_id,
        "name": "Test Operator",
        "email": "operator@example.test",
        "role_name": role,
        "operator_role": role,
        "is_ba": role == "BA",
    }


def _new_session(client, user_id=5, mode="assignment_capture", idempotency_key=""):
    return client.post("/api/agent-v2/new-session", headers=SECRET, json={
        "user_id": user_id,
        "context": _context(user_id),
        "product_mode": mode,
        "source_context": {
            "source_type": "operator",
            "channel": "oral",
            "source_summary": "Нужно улучшить контроль расчётов",
        },
        "idempotency_key": idempotency_key,
    })


@pytest.fixture()
def client(tmp_path, monkeypatch):
    previous = (settings.ENABLED, settings.KILL_SWITCH, settings.AGENT_SECRET)
    settings.ENABLED = True
    settings.KILL_SWITCH = False
    settings.AGENT_SECRET = SECRET["X-Agent-Secret"]
    api_router._orchestrator = V2Orchestrator(SessionStore(str(tmp_path / "api-v2.db")))

    def decision(state, text):
        missing = state.get_missing_mandatory_hard()
        focus = missing[0] if missing else "scope_out"
        facts = [] if text.lower() in {"да", "подтверждаю"} else [
            Fact(focus, text, 0.9, evidence=text),
        ]
        return TurnDecision(
            facts=facts,
            next_action="ask",
            focus=focus,
            reply="Уточните следующий обязательный факт?",
            source="llm",
        )

    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", decision)
    with TestClient(app) as test_client:
        yield test_client
    settings.ENABLED, settings.KILL_SWITCH, settings.AGENT_SECRET = previous


def test_config_requires_v2_secret(client):
    assert client.get("/api/agent-v2/config").status_code == 403
    response = client.get("/api/agent-v2/config", headers=SECRET)
    assert response.status_code == 200
    assert response.json()["assistant_version"] == "v2"


def test_new_session_requires_trusted_ba_or_po_context(client):
    response = client.post("/api/agent-v2/new-session", headers=SECRET, json={
        "user_id": 5,
        "context": _context(5, role="viewer"),
        "product_mode": "assignment_capture",
    })
    assert response.status_code == 422
    assert response.json()["detail"] == "trusted_operator_role_required"


def test_full_chat_flow_is_v2_and_owned(client):
    created = _new_session(client)
    assert created.status_code == 200
    payload = created.json()
    assert payload["product_mode"] == "assignment_capture"
    assert payload["artifact_type"] == "assignment_passport"
    assert payload["source_context"]["source_type"] == "operator"
    sid = payload["session_id"]

    response = client.post("/api/agent-v2/chat", headers=SECRET, json={
        "session_id": sid,
        "message_id": "browser-message-1",
        "message": "Результат — ежедневный список зависших сделок",
        "context": _context(),
    })
    assert response.status_code == 200
    assert response.json()["schema_version"] == 1

    foreign = client.post("/api/agent-v2/chat", headers=SECRET, json={
        "session_id": sid,
        "message": "Чужое сообщение",
        "context": _context(999),
    })
    assert foreign.status_code == 404


@pytest.mark.parametrize("route", ["chat", "chat-stream", "document-action"])
def test_api_binds_model_identity_to_session_including_stream_worker(client, monkeypatch, route):
    endpoint = "https://opencode.ai/zen/go/v1/chat/completions"
    observed = []
    method = "document_action" if route == "document-action" else "handle_message"
    original = getattr(api_router._orchestrator, method)

    def capture(*args, **kwargs):
        observed.append((OpenAICompatProvider()._headers(endpoint)["x-opencode-session"], threading.current_thread().name))
        return original(*args, **kwargs)

    monkeypatch.setattr(api_router._orchestrator, method, capture)
    expected = []
    for number in range(2):
        mode = "requirement_copilot" if route == "document-action" else "assignment_capture"
        sid = _new_session(client, mode=mode).json()["session_id"]
        with llm_session(sid):
            expected.append(current_llm_session())
        payload = {"session_id": sid, "context": _context(), "message": "Нужен контроль расчётов по сделкам", "message_id": f"scope-{number}"}
        if route == "document-action":
            payload = {"session_id": sid, "user_id": 5, "action": "add_source", "source": {"title": "Контекст", "content": "Нужен контроль расчётов по сделкам"}}
        response = client.post(f"/api/agent-v2/{route}", headers=SECRET, json=payload)
        assert response.status_code == 200
        if route == "chat-stream":
            assert "event: result" in response.text
            assert "event: error" not in response.text
    assert [value for value, _thread in observed] == expected
    assert expected[0] != expected[1]
    if route == "chat-stream":
        assert all(name == "agent-chat-stream" for _value, name in observed)
    assert current_llm_session() is None


def test_api_session_scope_resets_context_when_operation_raises(client):
    sid = _new_session(client).json()["session_id"]
    with llm_session("outer"):
        outer = current_llm_session()
        with pytest.raises(RuntimeError, match="operation failed"):
            with api_router._session_scope(sid):
                assert current_llm_session() != outer
                raise RuntimeError("operation failed")
        assert current_llm_session() == outer
    assert current_llm_session() is None


def test_chat_message_id_is_idempotent(client):
    sid = _new_session(client, 6).json()["session_id"]
    payload = {
        "session_id": sid,
        "message_id": "browser-message-1",
        "message": "Нужен контроль расчётов по сделкам",
        "context": _context(6),
    }
    first = client.post("/api/agent-v2/chat", headers=SECRET, json=payload)
    history = list(api_router._orchestrator.store.get(sid).history)
    second = client.post("/api/agent-v2/chat", headers=SECRET, json=payload)
    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert api_router._orchestrator.store.get(sid).history == history


def test_new_session_and_reset_idempotency_keys_are_replayed(client):
    first = _new_session(client, 16, idempotency_key="create-once")
    second = _new_session(client, 16, idempotency_key="create-once")
    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert len(api_router._orchestrator.store.list_for_user(16)) == 1

    payload = {
        "session_id": first.json()["session_id"],
        "user_id": 16,
        "idempotency_key": "reset-once",
    }
    reset = client.post("/api/agent-v2/reset", headers=SECRET, json=payload)
    replay = client.post("/api/agent-v2/reset", headers=SECRET, json=payload)
    assert reset.status_code == replay.status_code == 200
    assert replay.json() == reset.json()


def test_session_queries_and_mutations_require_owner(client):
    sid = _new_session(client, 15).json()["session_id"]
    assert client.get(f"/api/agent-v2/session/{sid}", headers=SECRET).status_code == 404
    assert client.get(f"/api/agent-v2/session/{sid}?user_id=999", headers=SECRET).status_code == 404
    assert client.get(f"/api/agent-v2/session/{sid}?user_id=15", headers=SECRET).status_code == 200
    assert client.get("/api/agent-v2/sessions", headers=SECRET).status_code == 422

    archived = client.post(
        f"/api/agent-v2/session/{sid}/archive?archived=true&user_id=15",
        headers=SECRET,
    )
    assert archived.status_code == 200
    assert archived.json()["archived"] is True

    foreign_reset = client.post("/api/agent-v2/reset", headers=SECRET, json={
        "session_id": sid,
        "user_id": 999,
    })
    assert foreign_reset.status_code == 404
    owner_reset = client.post("/api/agent-v2/reset", headers=SECRET, json={
        "session_id": sid,
        "user_id": 15,
    })
    assert owner_reset.status_code == 200


def test_feature_gate_disables_mutations_but_keeps_config_visible(client):
    settings.KILL_SWITCH = True
    assert _new_session(client).status_code == 503
    assert client.get("/api/agent-v2/config", headers=SECRET).status_code == 200


def test_unknown_session_returns_404(client):
    response = client.post("/api/agent-v2/chat", headers=SECRET, json={
        "session_id": "missing-session",
        "message": "Привет",
        "context": _context(),
    })
    assert response.status_code == 404


def test_import_requirement_document_is_owned_and_idempotent(client):
    sid = _new_session(client, 22, mode="requirement_copilot").json()["session_id"]
    payload = {
        "session_id": sid,
        "content": "## Проблема\nРучная сверка занимает два часа.\n\n## Бизнес-цель\nСократить её до десяти минут.",
        "user_id": 22,
        "idempotency_key": "import-once",
    }
    first = client.post(
        "/api/agent-v2/import-requirement-document", headers=SECRET, json=payload
    )
    replay = client.post(
        "/api/agent-v2/import-requirement-document", headers=SECRET, json=payload
    )
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    assert first.json()["action"] == "document_imported"
    assert len(first.json()["artifact_revision_history"]) == 1

    foreign = client.post(
        "/api/agent-v2/import-requirement-document",
        headers=SECRET,
        json={**payload, "user_id": 999, "idempotency_key": "foreign"},
    )
    assert foreign.status_code == 200
    assert foreign.json()["action"] == "error"
