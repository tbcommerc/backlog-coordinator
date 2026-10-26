from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from jose import jwt

from config import settings
from auth import check_permission, get_request_review_access, get_task_action_scope


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _allowlist(raw: str) -> set[str]:
    return {item.strip().casefold() for item in raw.split(",") if item.strip()}


def pilot_allowed(user) -> bool:
    if not settings.ASSISTANT_V2_ENABLED:
        return False
    if check_permission(user, "admin", "full"):
        return True
    ids = _allowlist(settings.ASSISTANT_V2_PILOT_USER_IDS)
    emails = _allowlist(settings.ASSISTANT_V2_PILOT_EMAILS)
    return str(user.id).casefold() in ids or str(user.email or "").casefold() in emails


def permission_snapshot(user) -> dict[str, Any]:
    role = user.role
    return {
        "backlog_dmb": role.backlog_dmb_access if role else "none",
        "backlog_team": role.backlog_team_access if role else "none",
        "customer": role.customer_access if role else "none",
        "review": get_request_review_access(user),
        "task_edit": get_task_action_scope(user, "edit"),
        "task_comment": get_task_action_scope(user, "comment"),
    }


def issue_actor_envelope(user, *, request_id: str, trace_id: str, purpose: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "iss": "dmb-backlog",
        "aud": "assistant-v2",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.ASSISTANT_V2_ENVELOPE_TTL_SECONDS)).timestamp()),
        "jti": str(uuid4()),
        "key_id": "dmb-v2-signing-key-current",
        "user_id": str(user.id),
        "team_id": str(user.team_id) if user.team_id is not None else None,
        "roles": [user.role.name] if user.role else [],
        "permissions": permission_snapshot(user),
        "pilot_allowed": pilot_allowed(user),
        "purpose": purpose,
        "request_id": request_id,
        "trace_id": trace_id,
    }
    return jwt.encode(payload, settings.ASSISTANT_V2_ENVELOPE_SECRET, algorithm="HS256")


def proxy_request(
    *,
    method: str,
    path: str,
    query: str,
    body: bytes,
    content_type: str | None,
    idempotency_key: str | None,
    request_id: str,
    trace_id: str,
    actor_envelope: str,
) -> tuple[int, bytes, str]:
    url = f"{settings.ASSISTANT_V2_BASE_URL.rstrip('/')}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{query}"
    headers = {
        "Accept": "application/json",
        "X-Actor-Envelope": actor_envelope,
        "X-Request-ID": request_id,
        "X-Trace-ID": trace_id,
    }
    if content_type:
        headers["Content-Type"] = content_type
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = urllib.request.Request(url, data=body or None, method=method, headers=headers)
    try:
        with _opener.open(request, timeout=settings.ASSISTANT_V2_TIMEOUT_SECONDS) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "application/json; charset=utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("Content-Type", "application/json; charset=utf-8")
    except (urllib.error.URLError, TimeoutError):
        payload = {
            "error": {
                "code": "assistant_v2_unavailable",
                "message": "AI Assistant V2 временно недоступен. Основной DMB продолжает работать.",
                "details": {},
                "request_id": request_id,
                "trace_id": trace_id,
                "retryable": True,
            }
        }
        return 503, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8"
