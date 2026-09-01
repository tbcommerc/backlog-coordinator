from types import SimpleNamespace

from app.llm import factory
from app.llm.openai_compat import OpenAICompatAdapter


class _Response:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [{"message": {"content": '{"kind":"rnd","confident":false}'}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7},
        }


def test_openai_compatible_adapter_uses_configured_endpoint_model_and_key(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return _Response()

    monkeypatch.setattr("app.llm.openai_compat.httpx.post", fake_post)
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
    )
    monkeypatch.setattr(factory, "get_settings", lambda: settings)

    adapter = factory.get_adapter()

    assert isinstance(adapter, OpenAICompatAdapter)
    assert adapter.api_key == "shared-key"
    assert adapter.base_url == "https://llm.example/v1"
    assert adapter.model == "shared-model"
    assert adapter.timeout == 42.0


def test_opencode_zen_uses_same_cli_identity_as_business_agent(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(kwargs)
        return _Response()

    monkeypatch.setattr("app.llm.openai_compat.httpx.post", fake_post)
    adapter = OpenAICompatAdapter(
        api_key="shared-key",
        base_url="https://opencode.ai/zen/v1",
        model="shared-model",
    )

    adapter.complete("system", "user", {"type": "object"})

    assert captured["headers"]["User-Agent"] == "opencode/latest/1.18.21/cli"
    assert captured["headers"]["x-opencode-client"] == "cli"
