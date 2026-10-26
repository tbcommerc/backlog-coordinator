from __future__ import annotations

import json
import time
import urllib.error
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from jose import jwt

from services import assistant_v2_adapter as adapter
from services import assistant_v2_gateway as gateway


def _user(*, admin_access: str = "none") -> SimpleNamespace:
    role = SimpleNamespace(
        backlog_dmb_access="none",
        backlog_team_access="none",
        reports_access="none",
        analytics_access="none",
        customer_access="none",
        settings_access="none",
        admin_access=admin_access,
    )
    return SimpleNamespace(id=42, email="ba@example.test", role=role)


def test_empty_pilot_allowlist_denies_without_new_role(monkeypatch):
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_ENABLED", True)
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_PILOT_USER_IDS", "")
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_PILOT_EMAILS", "")
    assert gateway.pilot_allowed(_user()) is False


def test_full_admin_is_allowed_without_pilot_allowlist(monkeypatch):
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_ENABLED", True)
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_PILOT_USER_IDS", "")
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_PILOT_EMAILS", "")
    assert gateway.pilot_allowed(_user(admin_access="full")) is True


def test_global_flag_still_denies_full_admin(monkeypatch):
    monkeypatch.setattr(gateway.settings, "ASSISTANT_V2_ENABLED", False)
    assert gateway.pilot_allowed(_user(admin_access="full")) is False


def test_gateway_outage_is_bounded_503(monkeypatch):
    monkeypatch.setattr(gateway._opener, "open", lambda *_args, **_kwargs: (_ for _ in ()).throw(urllib.error.URLError("down")))
    status, payload, content_type = gateway.proxy_request(
        method="GET", path="cases", query="", body=b"", content_type=None,
        idempotency_key=None, request_id="req-1", trace_id="trace-1", actor_envelope="signed",
    )
    body = json.loads(payload)
    assert status == 503
    assert content_type.startswith("application/json")
    assert body["error"]["code"] == "assistant_v2_unavailable"
    assert "down" not in json.dumps(body)


def test_adapter_rejects_protected_paths():
    with pytest.raises(HTTPException) as error:
        adapter.validate_task_operations([{"op": "replace", "path": "/team_id", "proposed_value": 7}])
    assert error.value.status_code == 422


def test_adapter_actor_envelope_replay_is_rejected(monkeypatch):
    monkeypatch.setattr(adapter.settings, "ASSISTANT_V2_ENVELOPE_SECRET", "test-v2-envelope-secret")
    adapter._seen_actor_jti.clear()
    now = int(time.time())
    token = jwt.encode({
        "iss": "dmb-backlog", "aud": "assistant-v2", "iat": now, "exp": now + 60,
        "jti": "adapter-replay-1", "user_id": "42", "pilot_allowed": True,
    }, "test-v2-envelope-secret", algorithm="HS256")
    assert adapter.decode_actor_envelope(token)["user_id"] == "42"
    with pytest.raises(HTTPException) as error:
        adapter.decode_actor_envelope(token)
    assert error.value.detail["code"] == "actor_envelope_replayed"


def test_flag_off_imports_are_conditional():
    source = (adapter.__file__ and __import__("pathlib").Path(adapter.__file__).parents[1] / "main.py").read_text(encoding="utf-8-sig")
    conditional = source.index("if settings.ASSISTANT_V2_ENABLED:")
    gateway_import = source.index("from routers.assistant_v2_gateway_router")
    assert gateway_import > conditional
