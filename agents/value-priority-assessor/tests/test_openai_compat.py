from types import SimpleNamespace

import httpx
import pytest

from value_priority_assessor.llm import factory
from value_priority_assessor.llm.openai_compat import OpenAICompatAdapter, _http_client, close_http_client
from value_priority_assessor.service.metrics import render_prometheus, reset_metrics


class _Response:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [{"message": {"content": '{"kind":"rnd","confident":false}'}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7},
        }


def test_http_client_is_reused_between_requests():
    close_http_client()
    first = _http_client()
    second = _http_client()

    assert first is second
    close_http_client()


def test_openai_compatible_adapter_uses_configured_endpoint_model_and_key(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return _Response()

    monkeypatch.setattr(
        "value_priority_assessor.llm.openai_compat._http_client",
        lambda: SimpleNamespace(post=fake_post),
    )
    adapter = OpenAICompatAdapter(
        api_key="shared-key",
        base_url="https://llm.example/v1/",
        model="shared-model",
    )

    hints = adapter.classify("Исследование", "AI", "serving")

    assert hints.kind == "rnd"
    assert captured["url"] == "https://llm.example/v1/chat/completions"
    assert captured["json"]["model"] == "shared-model"
    assert captured["headers"]["Authorization"] == "Bearer shared-key"
    assert captured["json"]["response_format"] == {"type": "json_object"}
    assert adapter.last_usage["tokens_in"] == 12


def test_factory_passes_shared_openai_compatible_settings(monkeypatch):
    settings = SimpleNamespace(
        llm_provider="openai_compat",
        openai_api_key="shared-key",
        openai_base_url="https://llm.example/v1",
        openai_model="shared-model",
        llm_timeout_seconds=42.0,
        llm_retry_attempts=4,
        llm_retry_base_seconds=0.25,
        llm_retry_max_seconds=2.0,
    )
    monkeypatch.setattr(factory, "get_settings", lambda: settings)

    adapter = factory.get_adapter()

    assert isinstance(adapter, OpenAICompatAdapter)
    assert adapter.api_key == "shared-key"
    assert adapter.base_url == "https://llm.example/v1"
    assert adapter.model == "shared-model"
    assert adapter.timeout == 42.0
    assert adapter.retry_attempts == 4
    assert adapter.retry_base_seconds == 0.25
    assert adapter.retry_max_seconds == 2.0


def test_opencode_zen_uses_same_cli_identity_as_business_agent(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr(
        "value_priority_assessor.llm.openai_compat._http_client",
        lambda: SimpleNamespace(post=fake_post),
    )
    adapter = OpenAICompatAdapter(
        api_key="shared-key",
        base_url="https://opencode.ai/zen/v1",
        model="shared-model",
    )

    adapter.complete("system", "user", {"type": "object"})

    assert captured["headers"]["User-Agent"] == "opencode/latest/1.18.21/cli"
    assert captured["headers"]["x-opencode-client"] == "cli"


def test_transient_http_failure_is_retried(monkeypatch):
    attempts = []
    delays = []
    request = httpx.Request("POST", "https://llm.example/v1/chat/completions")
    overloaded = httpx.Response(
        503,
        request=request,
        headers={"Retry-After": "0.01"},
    )

    def fake_post(*_args, **_kwargs):
        attempts.append(True)
        if len(attempts) == 1:
            return overloaded
        return _Response()

    reset_metrics()
    monkeypatch.setattr(
        "value_priority_assessor.llm.openai_compat._http_client",
        lambda: SimpleNamespace(post=fake_post),
    )
    monkeypatch.setattr("value_priority_assessor.llm.openai_compat.time.sleep", delays.append)
    adapter = OpenAICompatAdapter(
        api_key="shared-key",
        base_url="https://llm.example/v1",
        model="shared-model",
    )

    adapter.complete("system", "user", {"type": "object"})

    assert len(attempts) == 2
    assert delays == [0.01]
    assert "prioritiser_llm_retries_total 1" in render_prometheus()


def test_non_transient_http_failure_is_not_retried(monkeypatch):
    attempts = []
    request = httpx.Request("POST", "https://llm.example/v1/chat/completions")
    invalid = httpx.Response(400, request=request)

    def fake_post(*_args, **_kwargs):
        attempts.append(True)
        return invalid

    monkeypatch.setattr(
        "value_priority_assessor.llm.openai_compat._http_client",
        lambda: SimpleNamespace(post=fake_post),
    )
    adapter = OpenAICompatAdapter(
        api_key="shared-key",
        base_url="https://llm.example/v1",
        model="shared-model",
    )

    with pytest.raises(httpx.HTTPStatusError):
        adapter.complete("system", "user", {"type": "object"})

    assert len(attempts) == 1
