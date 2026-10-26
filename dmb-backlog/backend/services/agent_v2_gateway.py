"""Trusted DMB gateway for the isolated fork-based Assistant V2."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from auth import get_request_review_access, get_task_action_scope
from config import settings


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _values(raw: str) -> set[str]:
    return {item.strip().casefold() for item in (raw or "").split(",") if item.strip()}


def _is_full_admin(user) -> bool:
    return (getattr(getattr(user, "role", None), "admin_access", "") or "").strip().casefold() == "full"


def pilot_allowed(user) -> bool:
    if not settings.AGENT_V2_ENABLED or settings.AGENT_V2_KILL_SWITCH:
        return False
    if _is_full_admin(user):
        return True
    ids = _values(settings.AGENT_V2_PILOT_USER_IDS)
    emails = _values(settings.AGENT_V2_PILOT_EMAILS)
    return str(user.id).casefold() in ids or str(user.email or "").casefold() in emails


def operator_role(user) -> str:
    """Map existing RBAC names to dialogue context without changing RBAC data."""
    if _is_full_admin(user):
        return "BA"
    name = (getattr(user, "role_name", "") or "").strip().casefold()
    ba_names = _values(settings.AGENT_V2_BA_ROLE_NAMES)
    po_names = _values(settings.AGENT_V2_PO_ROLE_NAMES)
    matches = ({"BA"} if name in ba_names else set()) | ({"PO"} if name in po_names else set())
    return next(iter(matches)) if len(matches) == 1 else ""


def trusted_context(user) -> dict[str, Any]:
    return {
        "user_id": user.id,
        "name": user.name or "",
        "email": user.email or "",
        "role_name": user.role_name or "",
        "customer_access": getattr(getattr(user, "role", None), "customer_access", "none") or "none",
        "team_name": getattr(getattr(user, "team", None), "name", "") or "",
        "department": "",
        "is_ba": operator_role(user) == "BA",
        "operator_role": operator_role(user),
        "capabilities": {
            "review": get_request_review_access(user),
            "task_edit": get_task_action_scope(user, "edit"),
            "task_comment": get_task_action_scope(user, "comment"),
        },
    }


def proxy_request(
    *,
    method: str,
    path: str,
    query: str = "",
    body: bytes | None = None,
    request_id: str = "",
    trace_id: str = "",
) -> tuple[int, bytes, str]:
    url = f"{settings.AGENT_V2_BASE_URL.rstrip('/')}/api/agent-v2/{path.lstrip('/')}"
    if query:
        url += "?" + query
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Agent-Secret": settings.AGENT_V2_SECRET,
        "X-Request-ID": request_id or "unknown",
        "X-Trace-ID": trace_id or request_id or "unknown",
    }
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with _opener.open(request, timeout=settings.AGENT_V2_TIMEOUT_SECONDS) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("Content-Type", "application/json")
    except (urllib.error.URLError, TimeoutError):
        payload = {
            "error": {
                "code": "agent_v2_unavailable",
                "message": "Assistant V2 временно недоступен. V1 и основной DMB продолжают работать.",
                "details": {},
                "request_id": request_id or "unknown",
                "trace_id": trace_id or request_id or "unknown",
                "retryable": True,
            }
        }
        return 503, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json"


def call_json(method: str, path: str, payload: dict | None = None, query: str = "") -> tuple[int, dict]:
    status, raw, _ = proxy_request(
        method=method,
        path=path,
        query=query,
        body=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
    )
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except Exception:
        decoded = {"error": {"code": "invalid_agent_v2_response", "message": "Некорректный ответ Assistant V2"}}
    return status, decoded
