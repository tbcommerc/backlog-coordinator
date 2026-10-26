import io
import json
import urllib.error

import pytest

from agent.llm.openai_compat import LLMRateLimitError, OpenAICompatProvider


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode()


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

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("agent.llm.openai_compat.time.sleep", lambda _delay: None)

    result = OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert result == "ok"
    assert outcomes == []


def test_fails_after_bounded_rate_limit_retries(monkeypatch):
    calls = []

    def fail(*_args, **_kwargs):
        calls.append(1)
        raise _rate_limit()

    monkeypatch.setattr("urllib.request.urlopen", fail)
    monkeypatch.setattr("agent.llm.openai_compat.time.sleep", lambda _delay: None)

    with pytest.raises(LLMRateLimitError, match="after 3 attempts"):
        OpenAICompatProvider().chat([{"role": "user", "content": "test"}])

    assert len(calls) == 3


def test_uses_opencode_cli_identity_for_zen(monkeypatch):
    captured = {}

    def respond(request, **_kwargs):
        captured.update({key.lower(): value for key, value in request.header_items()})
        return _Response()

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr(
        "agent.llm.openai_compat.settings.OPENAI_BASE_URL",
        "https://opencode.ai/zen/v1",
    )

    assert OpenAICompatProvider().chat([{"role": "user", "content": "test"}]) == "ok"
    assert captured["user-agent"] == "opencode/latest/1.18.21/cli"
    assert captured["x-opencode-client"] == "cli"


def test_retries_transient_upstream_503(monkeypatch):
    outcomes = [_http_error(503), _Response()]

    def respond(*_args, **_kwargs):
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr("urllib.request.urlopen", respond)
    monkeypatch.setattr("agent.llm.openai_compat.time.sleep", lambda _delay: None)

    assert OpenAICompatProvider().chat([{"role": "user", "content": "test"}]) == "ok"
    assert outcomes == []


def test_chat_json_requests_json_object(monkeypatch):
    captured = {}

    def post(_path, payload, timeout=60.0):
        captured.update(payload)
        return {"choices": [{"message": {"content": '{"ok":true}'}}]}

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

    monkeypatch.setattr("urllib.request.urlopen", respond)

    chunks = list(OpenAICompatProvider().chat_stream([{"role": "user", "content": "test"}]))

    assert chunks == ["Первый ", "ответ"]
    assert captured["stream"] is True


@pytest.mark.parametrize("base_url,expected", [
    ("https://opencode.ai/zen/go/v1", True),
    ("https://api.example.test/v1", False),
])
def test_session_header_for_opencode(monkeypatch, base_url, expected):
    monkeypatch.setattr("agent.llm.openai_compat.settings.OPENAI_BASE_URL", base_url)
    requests = []
    def respond(req, **kwargs):
        requests.append(req)
        return _Response()
    monkeypatch.setattr("urllib.request.urlopen", respond)
    provider = OpenAICompatProvider()
    provider.chat([])
    provider.chat_json([])
    headers = [dict((k.lower(), v) for k, v in req.header_items()) for req in requests]
    assert ("x-opencode-session" in headers[0]) is expected
    if expected:
        assert headers[0]["x-opencode-session"] == headers[1]["x-opencode-session"]
