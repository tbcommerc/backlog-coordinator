import json

from routers import agent_router


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps({"ok": True}).encode("utf-8")


def test_agent_proxy_uses_configured_timeout(monkeypatch):
    captured = {}

    def open_request(_request, timeout):
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(agent_router.urllib.request, "urlopen", open_request)
    monkeypatch.setattr(agent_router.settings, "AGENT_TIMEOUT_SECONDS", 180.0)

    assert agent_router._call_agent("GET", "/api/agent/config") == {"ok": True}
    assert captured["timeout"] == 180.0
