import json
import asyncio

import pytest
from pydantic import ValidationError

from routers import agent_router
from interservice import reset_circuits


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"ok": True}).encode("utf-8")


class _StreamResponse:
    def __init__(self, lines):
        self.lines = lines
        self.closed = False

    def __iter__(self):
        return iter(self.lines)

    def close(self):
        self.closed = True


def test_agent_proxy_uses_configured_timeout(monkeypatch):
    captured = {}

    def open_request(_request, timeout):
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(agent_router.urllib.request, "urlopen", open_request)
    monkeypatch.setattr(agent_router.settings, "AGENT_TIMEOUT_SECONDS", 180.0)

    assert agent_router._call_agent("GET", "/api/agent/config") == {"ok": True}
    assert captured["timeout"] == 180.0


def test_agent_stream_proxy_relays_sse_without_buffering(monkeypatch):
    captured = {}
    upstream = _StreamResponse([
        b'event: ready\ndata: {"stream":true}\n\n',
        'event: delta\ndata: {"text":"Ответ"}\n\n'.encode("utf-8"),
        'event: result\ndata: {"message":"Ответ"}\n\n'.encode("utf-8"),
    ])

    def open_request(request, timeout):
        captured["url"] = request.full_url
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return upstream

    monkeypatch.setattr(agent_router, "_user_session_ids", lambda _db, _user: {"session-1"})
    monkeypatch.setattr(agent_router, "_user_context", lambda _user: {"user_id": 1})
    monkeypatch.setattr(agent_router.urllib.request, "urlopen", open_request)
    monkeypatch.setattr(agent_router, "inc_counter", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(agent_router, "observe_histogram", lambda *_args, **_kwargs: None)

    response = agent_router.agent_chat_stream(
        agent_router.AgentChatRequest(
            session_id="session-1", message_id="message-1", message="Текст"
        ),
        db=object(),
        current_user=object(),
    )

    async def collect():
        return b"".join([chunk async for chunk in response.body_iterator])

    body = asyncio.run(collect())
    assert captured["url"].endswith("/api/agent/chat-stream")
    assert captured["payload"]["message_id"] == "message-1"
    assert b"event: delta" in body
    assert b"event: result" in body
    assert upstream.closed is True


def test_agent_proxy_retries_transport_failures(monkeypatch):
    reset_circuits()
    calls = 0

    def open_request(_request, timeout):
        nonlocal calls
        calls += 1
        if calls < 3:
            raise TimeoutError("temporary")
        return _Response()

    monkeypatch.setattr(agent_router.urllib.request, "urlopen", open_request)
    monkeypatch.setattr(agent_router.settings, "INTERSERVICE_RETRY_BASE_SECONDS", 0.0)
    monkeypatch.setattr(agent_router.settings, "INTERSERVICE_MAX_ATTEMPTS", 3)

    assert agent_router._call_agent("GET", "/api/agent/config") == {"ok": True}
    assert calls == 3


def test_new_session_is_not_retried_without_idempotency_key(monkeypatch):
    reset_circuits()
    calls = 0

    def fail(_request, timeout):
        nonlocal calls
        calls += 1
        raise TimeoutError("lost response")

    monkeypatch.setattr(agent_router.urllib.request, "urlopen", fail)
    monkeypatch.setattr(agent_router.settings, "INTERSERVICE_RETRY_BASE_SECONDS", 0.0)
    with pytest.raises(agent_router.HTTPException):
        agent_router._call_agent("POST", "/api/agent/new-session", {"user_id": 1})
    assert calls == 1


@pytest.mark.parametrize("length", [3999, 4000])
def test_agent_chat_accepts_messages_within_shared_limit(length):
    assert len(agent_router.AgentChatRequest(message="x" * length).message) == length


@pytest.mark.parametrize("length", [4001, 5000])
def test_agent_chat_rejects_messages_above_shared_limit(length):
    with pytest.raises(ValidationError):
        agent_router.AgentChatRequest(message="x" * length)


def test_agent_ux_event_records_only_bounded_labels(monkeypatch):
    counters = []
    durations = []
    monkeypatch.setattr(agent_router, "inc_counter", lambda name, labels=None: counters.append((name, labels)))
    monkeypatch.setattr(agent_router, "observe_histogram", lambda name, value, labels=None: durations.append((name, value, labels)))

    result = agent_router.agent_ux_event(
        agent_router.AgentUxEvent(event="response_received", duration_ms=1250),
        current_user=object(),
    )

    assert result == {"success": True}
    assert counters == [("dmb_agent_ux_events_total", {"event": "response_received", "outcome": "ok"})]
    assert durations == [("dmb_agent_ux_duration_seconds", 1.25, {"event": "response_received"})]


def test_agent_ux_event_rejects_unbounded_event_names():
    with pytest.raises(agent_router.HTTPException) as error:
        agent_router.agent_ux_event(
            agent_router.AgentUxEvent(event="prompt-text-would-be-high-cardinality"),
            current_user=object(),
        )
    assert error.value.status_code == 422
