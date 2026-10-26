from __future__ import annotations

import json
import urllib.error
import asyncio
from pathlib import Path
from types import SimpleNamespace

from services import agent_v2_gateway as gateway
from routers import agent_v2_router


def _user(role_name="BA/Участник команды", *, user_id=42, email="ba@example.test", admin_access="none"):
    role = SimpleNamespace(
        customer_access="read",
        review_access="team",
        task_edit_scope="team",
        task_comment_scope="all",
        admin_access=admin_access,
    )
    return SimpleNamespace(
        id=user_id,
        email=email,
        name="BA Test",
        role_name=role_name,
        role=role,
        team=SimpleNamespace(name="Core"),
    )


def test_full_admin_has_v2_access_without_pilot_allowlist(monkeypatch):
    monkeypatch.setattr(gateway.settings, "AGENT_V2_ENABLED", True)
    monkeypatch.setattr(gateway.settings, "AGENT_V2_KILL_SWITCH", False)
    monkeypatch.setattr(gateway.settings, "AGENT_V2_PILOT_USER_IDS", "")
    monkeypatch.setattr(gateway.settings, "AGENT_V2_PILOT_EMAILS", "")
    assert gateway.pilot_allowed(_user(role_name="Администратор", admin_access="full")) is True
    assert gateway.operator_role(_user(role_name="Администратор", admin_access="full")) == "BA"
    assert gateway.pilot_allowed(_user(role_name="Администратор", admin_access="partial")) is False
    monkeypatch.setattr(gateway.settings, "AGENT_V2_PILOT_USER_IDS", "42")
    assert gateway.pilot_allowed(_user()) is True


def test_kill_switch_denies_allowlisted_user(monkeypatch):
    monkeypatch.setattr(gateway.settings, "AGENT_V2_ENABLED", True)
    monkeypatch.setattr(gateway.settings, "AGENT_V2_KILL_SWITCH", True)
    monkeypatch.setattr(gateway.settings, "AGENT_V2_PILOT_USER_IDS", "42")
    assert gateway.pilot_allowed(_user()) is False
    assert gateway.pilot_allowed(_user(role_name="Администратор", admin_access="full")) is False


def test_only_configured_ba_po_roles_are_mapped(monkeypatch):
    monkeypatch.setattr(gateway.settings, "AGENT_V2_BA_ROLE_NAMES", "BA/Участник команды")
    monkeypatch.setattr(gateway.settings, "AGENT_V2_PO_ROLE_NAMES", "PO/PL/CL")
    assert gateway.operator_role(_user()) == "BA"
    assert gateway.operator_role(_user("PO/PL/CL")) == "PO"
    assert gateway.operator_role(_user("Администратор")) == ""


def test_trusted_context_is_derived_from_authenticated_user(monkeypatch):
    monkeypatch.setattr(gateway.settings, "AGENT_V2_BA_ROLE_NAMES", "BA/Участник команды")
    context = gateway.trusted_context(_user())
    assert context["user_id"] == 42
    assert context["operator_role"] == "BA"
    assert context["role_name"] == "BA/Участник команды"


def test_gateway_outage_is_bounded_and_does_not_leak_transport_error(monkeypatch):
    monkeypatch.setattr(
        gateway._opener,
        "open",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(urllib.error.URLError("secret network detail")),
    )
    status, payload, content_type = gateway.proxy_request(
        method="GET", path="sessions", request_id="req-1", trace_id="trace-1",
    )
    body = json.loads(payload)
    assert status == 503
    assert content_type == "application/json"
    assert body["error"]["code"] == "agent_v2_unavailable"
    assert "secret network detail" not in json.dumps(body)


def test_flag_off_import_is_conditional():
    source = (Path(__file__).parents[1] / "main.py").read_text(encoding="utf-8-sig")
    conditional = source.index("if settings.AGENT_V2_ENABLED and not settings.AGENT_V2_KILL_SWITCH:")
    router_import = source.index("from routers.agent_v2_router")
    assert router_import > conditional


def test_new_session_gateway_drops_client_linked_snapshot():
    source = Path(agent_v2_router.__file__).read_text(encoding="utf-8-sig")
    new_session_branch = source[source.index('if path == "new-session":'):source.index('elif path == "chat"')]
    assert 'payload.pop("linked_object", None)' in new_session_branch
    assert 'payload["context"] = trusted_context(current_user)' in new_session_branch
    assert 'query["user_id"] = str(current_user.id)' in source
    assert 'payload["idempotency_key"] = request.headers.get("Idempotency-Key", "")' in source
    assert 'current_snapshot_fingerprint": current_snapshot["fingerprint"]' in source


def test_linked_object_search_is_authorized_and_escapes_sql_wildcards():
    source = Path(agent_v2_router.__file__).read_text(encoding="utf-8-sig")
    assert '@router.get("/objects/search")' in source
    assert "task_read_scope_clause(current_user, Task)" in source
    assert 'can_access_task("read", row, current_user)' in source
    assert 'get_request_review_access(current_user)' in source
    assert agent_v2_router._escaped_like(r"a%b_c\\d") == r"a\%b\_c\\\\d"


class _Request:
    headers = {"Idempotency-Key": "test-submit"}

    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class _Query:
    def __init__(self, row):
        self.row = row

    def filter(self, *_args):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self.row


class _Db:
    def __init__(self, existing=None):
        self.existing = existing
        self.added = None

    def query(self, _model):
        return _Query(self.existing)

    def add(self, row):
        self.added = row

    def flush(self):
        if self.added and not self.added.id:
            self.added.id = 101

    def commit(self):
        return None

    def rollback(self):
        return None

    def refresh(self, _row):
        return None


def test_review_adapter_reuses_requirement_request_with_v2_namespace(monkeypatch):
    monkeypatch.setattr(agent_v2_router, "_deny_unless_pilot", lambda _user: None)
    calls = []
    draft = {
        "schema": "business-requirement-draft.v2",
        "title": "Контроль расчётов",
        "problem_statement": "Не видны зависшие сделки",
        "fingerprint": "sha256:" + "d" * 64,
        "revision": 1,
    }

    def call_json(method, path, payload=None, query=""):
        calls.append((method, path, payload, query))
        if method == "GET":
            return 200, {
                "session_id": "session-1",
                "product_mode": "requirement_copilot",
                "artifact_type": "business_requirement_v2",
                "schema_version": 1,
                "readiness": {"ready": True, "blocking_codes": []},
                "draft": draft,
            }
        return 200, {"action": "sent", "session_id": "session-1", "draft": draft}

    monkeypatch.setattr(agent_v2_router, "call_json", call_json)
    db = _Db()
    user = SimpleNamespace(id=42, team_id=7, name="BA Test")
    response = asyncio.run(agent_v2_router.send_for_review(
        _Request({"session_id": "session-1", "expected_draft_hash": draft["fingerprint"]}),
        db,
        user,
    ))
    assert db.added.agent_session_id == "v2:session-1"
    assert db.added.user_id == 42
    assert db.added.team_id == 7
    assert db.added.status == "submitted"
    assert response["request_id"] == 101
    assert any(method == "POST" and path == "send-for-review" for method, path, *_ in calls)
