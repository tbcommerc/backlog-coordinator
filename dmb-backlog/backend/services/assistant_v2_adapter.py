from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from auth import authorize_task, get_request_review_access
from config import settings
from models import RequirementRequest, Task, User


TASK_PROJECTION_FIELDS = (
    "title",
    "description",
    "comment",
    "link_mockups",
    "link_requirements",
)
TASK_DIFF_PATHS = frozenset(f"/{field}" for field in TASK_PROJECTION_FIELDS)
PROTECTED_PATH_PREFIXES = (
    "/priority", "/status", "/owner", "/user", "/role", "/team",
    "/dictionary", "/business_customer", "/department",
)
_seen_actor_jti: dict[str, int] = {}
_seen_actor_jti_lock = threading.Lock()


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def digest_projection(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def require_service_secret(value: str | None) -> None:
    if not value or not hmac.compare_digest(value, settings.ASSISTANT_V2_SERVICE_SECRET):
        raise HTTPException(status_code=401, detail={"code": "invalid_service_credential", "message": "Invalid service credential"})


def decode_actor_envelope(token: str | None) -> dict[str, Any]:
    if not token:
        raise HTTPException(status_code=401, detail={"code": "actor_envelope_required", "message": "Actor envelope required"})
    try:
        payload = jwt.decode(
            token,
            settings.ASSISTANT_V2_ENVELOPE_SECRET,
            algorithms=["HS256"],
            audience="assistant-v2",
            issuer="dmb-backlog",
        )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail={"code": "invalid_actor_envelope", "message": "Invalid actor envelope"}) from exc
    if payload.get("pilot_allowed") is not True:
        raise HTTPException(status_code=403, detail={"code": "pilot_not_allowed", "message": "Pilot access denied"})
    jti = str(payload.get("jti") or "")
    exp = int(payload.get("exp") or 0)
    if not jti:
        raise HTTPException(status_code=401, detail={"code": "invalid_actor_envelope", "message": "Invalid actor envelope"})
    now = int(time.time())
    with _seen_actor_jti_lock:
        for seen_jti, seen_exp in list(_seen_actor_jti.items()):
            if seen_exp <= now:
                _seen_actor_jti.pop(seen_jti, None)
        if jti in _seen_actor_jti:
            raise HTTPException(status_code=401, detail={"code": "actor_envelope_replayed", "message": "Actor envelope already used"})
        _seen_actor_jti[jti] = exp
    return payload


def actor_user(db: Session, envelope: dict[str, Any]) -> User:
    try:
        user_id = int(envelope["user_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail={"code": "invalid_actor_envelope", "message": "Invalid actor"}) from exc
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if user is None:
        raise HTTPException(status_code=401, detail={"code": "actor_not_found", "message": "Actor not found"})
    return user


def _task_projection(task: Task) -> dict[str, Any]:
    return {field: getattr(task, field) for field in TASK_PROJECTION_FIELDS}


def _request_projection(request: RequirementRequest) -> dict[str, Any]:
    return {
        "title": request.title,
        "description": request.description,
        "draft": request.draft,
        "status": request.status,
    }


def authorized_snapshot(db: Session, user: User, object_type: str, object_id: str) -> dict[str, Any]:
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if object_type in {"task", "goal"}:
        try:
            task_id = int(object_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"code": "object_not_found", "message": "Object unavailable"}) from exc
        task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
        if task is None:
            raise HTTPException(status_code=404, detail={"code": "object_not_found", "message": "Object unavailable"})
        authorize_task("read", task, user)
        projection = _task_projection(task)
        return {
            "object_type": object_type,
            "object_id": str(task.id),
            "version": task.version,
            "digest": digest_projection(projection),
            "captured_at": captured_at,
            "projection": projection,
            "policy": {"read": True, "edit": None, "allowed_diff_paths": sorted(TASK_DIFF_PATHS)},
        }
    if object_type == "request":
        try:
            request_id = int(object_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"code": "object_not_found", "message": "Object unavailable"}) from exc
        row = db.query(RequirementRequest).filter(RequirementRequest.id == request_id, RequirementRequest.is_deleted == False).first()
        if row is None:
            raise HTTPException(status_code=404, detail={"code": "object_not_found", "message": "Object unavailable"})
        can_review = get_request_review_access(user) == "all" or (
            get_request_review_access(user) == "team" and user.team_id is not None and user.team_id == row.team_id
        )
        if row.user_id != user.id and not can_review:
            raise HTTPException(status_code=403, detail={"code": "object_access_denied", "message": "Object unavailable"})
        projection = _request_projection(row)
        return {
            "object_type": object_type,
            "object_id": str(row.id),
            "version": row.version,
            "digest": digest_projection(projection),
            "captured_at": captured_at,
            "projection": projection,
            "policy": {"read": True, "edit": False, "allowed_diff_paths": []},
        }
    raise HTTPException(status_code=422, detail={"code": "object_type_not_supported", "message": "Unsupported object type"})


def validate_task_operations(operations: list[dict[str, Any]]) -> None:
    for operation in operations:
        path = str(operation.get("path") or "")
        if path.startswith(PROTECTED_PATH_PREFIXES) or path not in TASK_DIFF_PATHS:
            raise HTTPException(status_code=422, detail={"code": "path_not_allowed", "message": "Diff path is not allowed", "path": path})
        if operation.get("op") not in {"add", "replace", "remove"}:
            raise HTTPException(status_code=422, detail={"code": "operation_not_allowed", "message": "Diff operation is not allowed"})


def validate_snapshot_match(snapshot: dict[str, Any], base_version: int, base_digest: str) -> dict[str, Any]:
    valid = snapshot["version"] == base_version and hmac.compare_digest(snapshot["digest"], base_digest)
    return {
        "valid": valid,
        "version": snapshot["version"],
        "digest": snapshot["digest"],
        "current_version": snapshot["version"],
        "current_digest": snapshot["digest"],
        "allowed_diff_paths": snapshot["policy"]["allowed_diff_paths"],
    }
