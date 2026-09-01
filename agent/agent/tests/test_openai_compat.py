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
