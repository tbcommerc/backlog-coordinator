import io
import json
import urllib.error

import pytest

from business_analyst.llm.openai_compat import LLMRateLimitError, OpenAICompatProvider


class _Response:
    def __init__(self, content="ok"):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"choices": [{"message": {"content": self.content}, "finish_reason": "stop"}]}).encode()


class _StreamResponse:
    status = 200
    headers = {"Content-Type": "text/event-stream"}

    def __init__(self, lines):
        self.lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def __iter__(self):
        return iter(self.lines)


def _rate_limit(retry_after="0"):
    return urllib.error.HTTPError(
        "https://example.test/chat/completions", 429, "Too Many Requests",
        {"Retry-After": retry_after}, io.BytesIO(b'{"error":"temporary"}'),
    )


def _http_error(code, retry_after="0"):
    return urllib.error.HTTPError(
        "https://example.test/chat/completions", code, "upstream",
        {"Retry-After": retry_after}, io.BytesIO(b'{"error":"temporary"}'),
    )


def test_retries_transient_rate_limit(monkeypatch):
    outcomes = [_rate_limit(), _Response()]

    def respond(*_args, **_kwargs):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", respond)
    monkeypatch.setattr("business_analyst.llm.openai_compat.time.sleep", lambda _delay: None)

    result = OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert result == "ok"
    assert outcomes == []


def test_fails_after_bounded_rate_limit_retries(monkeypatch):
    calls = []

    def fail(*_args, **_kwargs):
        calls.append(1)
        raise _rate_limit()

    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", fail)
    monkeypatch.setattr("business_analyst.llm.openai_compat.time.sleep", lambda _delay: None)

    with pytest.raises(LLMRateLimitError, match="after 3 attempts"):
        OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert len(calls) == 3


def test_uses_product_identity_for_go(monkeypatch):
    captured = {}

    def respond(request, **_kwargs):
        captured.update({key.lower(): value for key, value in request.header_items()})
        return _Response()

    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", respond)
    monkeypatch.setattr(
        "business_analyst.llm.openai_compat.settings.OPENAI_BASE_URL",
        "https://opencode.ai/zen/v1",
    )

    assert OpenAICompatProvider().chat([{"role": "user", "content": "test"}]) == "ok"
    assert captured["user-agent"] == "DMB-AI-Business-Analyst/1.0"
    assert "x-opencode-client" not in captured


def test_retries_transient_upstream_503(monkeypatch):
    outcomes = [_http_error(503), _Response()]

    def respond(*_args, **_kwargs):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", respond)
    monkeypatch.setattr("business_analyst.llm.openai_compat.time.sleep", lambda _delay: None)

    assert OpenAICompatProvider().chat([{"role": "user", "content": "test"}]) == "ok"
    assert outcomes == []


def test_chat_json_requests_json_object(monkeypatch):
    captured = {}

    def post(_path, payload, timeout=60.0):
        captured.update(payload)
        return {"choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}]}

    provider = OpenAICompatProvider()
    monkeypatch.setattr(provider, "_post", post)

    assert provider.chat_json([{"role": "user", "content": "test"}]) == '{"ok":true}'
    assert captured["response_format"] == {"type": "json_object"}


def test_chat_stream_yields_provider_deltas(monkeypatch):
    captured = {}

    def respond(request, **_kwargs):
        captured.update(json.loads(request.data.decode("utf-8")))
        return _StreamResponse([
            b'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
            b'\n',
            'data: {"choices":[{"delta":{"content":"Первый "}}]}\n'.encode("utf-8"),
            b'\n',
            'data: {"choices":[{"delta":{"content":"ответ"},"finish_reason":null}]}\n'.encode("utf-8"),
            b'\n',
            b'data: [DONE]\n',
            b'\n',
        ])

    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", respond)

    chunks = list(OpenAICompatProvider().chat_stream([{"role": "user", "content": "test"}]))

    assert chunks == ["Первый ", "ответ"]
    assert captured["stream"] is True


@pytest.mark.parametrize("base_url,expected", [
    ("https://opencode.ai/zen/go/v1", True),
    ("https://api.example.test/v1", False),
])
def test_session_header_for_opencode(monkeypatch, base_url, expected):
    monkeypatch.setattr("business_analyst.llm.openai_compat.settings.OPENAI_BASE_URL", base_url)
    requests = []
    def respond(req, **kwargs):
        requests.append(req)
        return _Response("{}")
    monkeypatch.setattr("business_analyst.llm.openai_compat.open_http", respond)
    provider = OpenAICompatProvider()
    provider.chat([{"role": "user", "content": "test"}])
    provider.chat_json([{"role": "user", "content": "test"}])
    headers = [dict((k.lower(), v) for k, v in req.header_items()) for req in requests]
    assert ("x-opencode-session" in headers[0]) is expected
    if expected:
        assert headers[0]["x-opencode-session"] == headers[1]["x-opencode-session"]


def test_go_chat_does_not_imply_embedding_capability(monkeypatch):
    provider=OpenAICompatProvider()
    monkeypatch.setattr(provider,"_post",lambda *a,**kw:pytest.fail("Unqualified embeddings request"))
    assert provider.embed("Synthetic") is None


def test_logical_run_is_shared_but_next_turn_is_separate(monkeypatch):
    from types import SimpleNamespace
    from dmb_agent_contracts.operation import current_operation
    from business_analyst.llm.context import llm_session
    provider=OpenAICompatProvider()
    captured=[]
    def complete(request):
        captured.append(request)
        return SimpleNamespace(text="synthetic")
    monkeypatch.setattr(provider,"complete",complete)
    with llm_session("synthetic-conversation"):
        owner=current_operation()
        provider.chat([{"role":"user","content":"synthetic one"}])
        provider.chat([{"role":"user","content":"synthetic two"}])
        assert captured[0].run_id==captured[1].run_id==owner.run_id
        assert captured[0].request_id!=captured[1].request_id
    with llm_session("synthetic-conversation"):
        provider.chat([{"role":"user","content":"synthetic next turn"}])
    assert captured[2].run_id!=captured[0].run_id


def test_shared_attempt_budget_counts_real_transport_retries(monkeypatch):
    from dmb_agent_contracts.operation import operation_scope
    from dmb_agent_contracts.model import AgentError
    import business_analyst.llm.openai_compat as module
    calls=[]
    def open_synthetic(request,timeout):
        calls.append(request)
        if len(calls)==1:raise _rate_limit()
        return _Response("synthetic")
    monkeypatch.setattr(module,"open_http",open_synthetic)
    monkeypatch.setattr(module.time,"sleep",lambda _:None)
    monkeypatch.setattr(module.settings,"OPENAI_API_KEY","synthetic")
    provider=OpenAICompatProvider()
    with operation_scope(max_model_attempts=2) as owner:
        assert provider.chat([{"role":"user","content":"synthetic"}])=="synthetic"
        assert owner.model_attempts==2
        with pytest.raises(AgentError,match="local_budget_exceeded"):
            provider.chat([{"role":"user","content":"synthetic again"}])
        assert len(calls)==2
