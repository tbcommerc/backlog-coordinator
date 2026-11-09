import io
import json
import urllib.error

import pytest

from business_analyst_experimental.llm.context import current_llm_session, llm_session
from business_analyst_experimental.llm.openai_compat import LLMRateLimitError, LLMResponseIncompleteError, OpenAICompatProvider


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


@pytest.mark.parametrize("effort", ["", "low"])
def test_reasoning_setting_is_optional_for_json_and_stream(monkeypatch, effort):
    captured = []
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.settings.OPENAI_REASONING_EFFORT", effort)
    provider = OpenAICompatProvider()
    def post(path, payload, **kwargs):
        captured.append(payload)
        return {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}
    def stream(path, payload, **kwargs):
        captured.append(payload)
        yield "{}"
    monkeypatch.setattr(provider, "_post", post)
    monkeypatch.setattr(provider, "_stream_post", stream)
    assert provider.chat_json([{"role": "user", "content": "test"}]) == "{}"
    assert list(provider.chat_stream([])) == ["{}"]
    for payload in captured:
        if effort:
            assert payload["reasoning_effort"] == effort
        else:
            assert "reasoning_effort" not in payload


def test_incomplete_json_is_rejected_even_when_prefix_parses(monkeypatch):
    provider = OpenAICompatProvider()
    monkeypatch.setattr(provider, "_post", lambda *a, **kw: {
        "choices": [{"message": {"content": "{}"}, "finish_reason": "length"}]})
    with pytest.raises(LLMResponseIncompleteError):
        provider.chat_json([{"role": "user", "content": "test"}])
    assert provider.last_response_meta["finish_reason"] == "length"


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

    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.open_http", respond)
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.time.sleep", lambda _delay: None)

    result = OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert result == "ok"
    assert outcomes == []


def test_fails_after_bounded_rate_limit_retries(monkeypatch):
    calls = []

    def fail(*_args, **_kwargs):
        calls.append(1)
        raise _rate_limit()

    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.open_http", fail)
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.time.sleep", lambda _delay: None)

    with pytest.raises(LLMRateLimitError, match="after 3 attempts"):
        OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert len(calls) == 3


def test_document_deadline_caps_attempts_and_prevents_retry_after_budget(monkeypatch):
    provider = OpenAICompatProvider()
    provider.operation_deadline = 103.0
    clock = [100.0]
    calls = []
    monkeypatch.setattr('business_analyst_experimental.llm.openai_compat.time.monotonic', lambda: clock[0])
    def fail(_request, timeout):
        calls.append(timeout)
        clock[0] += timeout
        raise TimeoutError('synthetic timeout')
    monkeypatch.setattr('business_analyst_experimental.llm.openai_compat.open_http', fail)
    monkeypatch.setattr('business_analyst_experimental.llm.openai_compat.time.sleep', lambda _: pytest.fail('must not sleep past deadline'))
    with pytest.raises(TimeoutError, match='document_operation_deadline'):
        provider.chat_json([{"role": "user", "content": "test"}], timeout=90)
    assert calls == [3.0]


@pytest.mark.parametrize("base_url", ["https://opencode.ai/zen/v1", "https://opencode.ai/zen/go/v1/"])
def test_opencode_uses_api_key_and_application_identity(monkeypatch, base_url):
    captured = {}

    def respond(request, **_kwargs):
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return _Response("{}")

    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.open_http", respond)
    monkeypatch.setattr(
        "business_analyst_experimental.llm.openai_compat.settings.OPENAI_BASE_URL",
        base_url,
    )
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.settings.OPENAI_API_KEY", "test-opencode-key")
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.settings.OPENAI_MODEL", "test-model")

    assert OpenAICompatProvider().chat_json([{"role": "user", "content": "test"}]) == "{}"
    assert captured["url"] == base_url.rstrip("/") + "/chat/completions"
    assert captured["method"] == "POST"
    assert captured["headers"]["authorization"] == "Bearer test-opencode-key"
    assert captured["headers"]["content-type"] == "application/json"
    assert captured["headers"]["user-agent"] == "DMB-AI-Business-Analyst-V2/2.0"
    assert "x-opencode-client" not in captured["headers"]
    assert captured["headers"]["x-opencode-session"].startswith("dmb-v2-")
    assert captured["payload"]["model"] == "test-model"
    assert captured["payload"]["response_format"] == {"type": "json_object"}


def test_retries_transient_upstream_503(monkeypatch):
    outcomes = [_http_error(503), _Response()]

    def respond(*_args, **_kwargs):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.open_http", respond)
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.time.sleep", lambda _delay: None)

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
        captured["url"] = request.full_url
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        captured["payload"] = json.loads(request.data.decode("utf-8"))
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

    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.open_http", respond)
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.settings.OPENAI_BASE_URL", "https://opencode.ai/zen/v1/")
    monkeypatch.setattr("business_analyst_experimental.llm.openai_compat.settings.OPENAI_API_KEY", "test-opencode-key")

    with llm_session("stream-conversation"):
        expected_session = current_llm_session()
        chunks = list(OpenAICompatProvider().chat_stream([{"role": "user", "content": "test"}]))

    assert chunks == ["Первый ", "ответ"]
    assert captured["payload"]["stream"] is True
    assert captured["url"] == "https://opencode.ai/zen/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer test-opencode-key"
    assert captured["headers"]["user-agent"] == "DMB-AI-Business-Analyst-V2/2.0"
    assert "x-opencode-client" not in captured["headers"]
    assert captured["headers"]["x-opencode-session"] == expected_session


def test_opencode_identity_is_stable_per_conversation_and_standalone_provider():
    url = "https://opencode.ai/zen/go/v1/chat/completions"
    standalone = OpenAICompatProvider()
    fallback = standalone._headers(url)["x-opencode-session"]
    assert standalone._headers(url)["x-opencode-session"] == fallback
    assert OpenAICompatProvider()._headers(url)["x-opencode-session"] != fallback
    with llm_session("private-session-a"):
        first = standalone._headers(url)["x-opencode-session"]
        assert OpenAICompatProvider()._headers(url)["x-opencode-session"] == first
        assert "private-session-a" not in first
    with llm_session("private-session-a"):
        assert OpenAICompatProvider()._headers(url)["x-opencode-session"] == first
    with llm_session("private-session-b"):
        assert standalone._headers(url)["x-opencode-session"] != first
    assert standalone._headers(url)["x-opencode-session"] == fallback


def test_llm_session_restores_nested_context_after_exception():
    assert current_llm_session() is None
    with llm_session("outer"):
        outer = current_llm_session()
        with pytest.raises(RuntimeError, match="failure"):
            with llm_session("inner"):
                assert current_llm_session() != outer
                raise RuntimeError("failure")
        assert current_llm_session() == outer
    assert current_llm_session() is None


@pytest.mark.parametrize("url", [
    "https://api.example.test/zen/go/v1/chat/completions",
    "https://opencode.ai.example.test/zen/go/v1/chat/completions",
    "http://opencode.ai/zen/go/v1/chat/completions",
    "https://opencode.ai:8443/zen/go/v1/chat/completions",
    "https://user@opencode.ai/zen/go/v1/chat/completions",
    "https://opencode.ai/zen/go/v10/chat/completions",
    "https://opencode.ai/zen/v11/chat/completions",
    "https://opencode.ai/other/v1/chat/completions",
])
def test_opencode_session_header_is_not_sent_to_other_origins_or_paths(url):
    with llm_session("private-conversation"):
        assert "x-opencode-session" not in OpenAICompatProvider()._headers(url)


def test_go_chat_does_not_imply_embedding_capability(monkeypatch):
    provider=OpenAICompatProvider()
    monkeypatch.setattr(provider,"_post",lambda *a,**kw:pytest.fail("Unqualified embeddings request"))
    assert provider.embed("Synthetic") is None


def test_logical_run_is_shared_but_next_turn_is_separate(monkeypatch):
    from types import SimpleNamespace
    from dmb_agent_contracts.operation import current_operation
    from business_analyst_experimental.llm.context import llm_session
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
    import business_analyst_experimental.llm.openai_compat as module
    calls=[]
    def open_synthetic(request,timeout):
        calls.append(request)
        if len(calls)==1:raise urllib.error.HTTPError("https://synthetic.invalid",429,"synthetic",{},None)
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
