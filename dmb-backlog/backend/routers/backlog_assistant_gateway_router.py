"""Explicit product routes only. Never proxies arbitrary OpenCode paths."""
import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime
from copy import deepcopy
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from auth import get_current_user
from config import settings
from services.backlog_assistant_integration import ledger
from services.backlog_assistant_integration.transport import call

router = APIRouter()


class ContextBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context: dict = Field(default_factory=lambda: {"surface": "assistant", "object_ref": None,
        "filters": {"object_type": "task"}, "timezone": "Europe/Moscow"})


class MessageBody(ContextBody):
    text: str = Field(min_length=1, max_length=8000)
    context_revision: int = Field(ge=1)


def allowed(user=Depends(get_current_user)):
    if not ledger.pilot(user):
        raise HTTPException(403, "assistant_unavailable")
    return user


def identity_id(value):
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(404, "not_found")


def checked_context(context):
    ledger.schema_validate("context.schema.json", context)
    query_schema = json.loads((ledger.SCHEMA_DIR / "query.schema.json").read_text(encoding="utf-8"))
    filters = dict(context.get("filters", {}))
    for name, prop in query_schema["properties"].items():
        if name not in filters:
            filters[name] = deepcopy(prop.get("default", [] if prop.get("type") == "array" else None))
        if filters[name] and name in {"created_from", "created_to", "updated_from", "updated_to"}:
            filters[name] = datetime.fromisoformat(filters[name].replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    return {"surface": context.get("surface", "assistant"), "object_ref": context.get("object_ref"),
            "filters": filters, "timezone": "Europe/Moscow"}


def read_proof(user, refs):
    payload = {"subject": str(user.id), "receipt_refs": sorted(set(refs)), "user_id": user.id,
        "sid": user._auth_sid, "auth_version": user._auth_version, "expires": time.time()+30}
    raw = base64.urlsafe_b64encode(ledger.canonical(payload).encode()).decode()
    return raw+"."+hmac.new(settings.BACKLOG_ASSISTANT_GATEWAY_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()


@router.get("/capabilities")
def capabilities(user=Depends(get_current_user)):
    return {"enabled": ledger.pilot(user), "read_only": True, "contract_version": "1.0"}


@router.post("/sessions", status_code=201)
def create(body: ContextBody, user=Depends(allowed), idempotency_key: str = Header(default="")):
    body.context = checked_context(body.context)
    ledger.validate_context(user, body.context)
    return call(user, "POST", "/v1/sessions", body.model_dump(), idempotency_key)


@router.get("/sessions")
def sessions(user=Depends(allowed), cursor: int = Query(0, ge=0)):
    return call(user, "GET", f"/v1/sessions?cursor={cursor}")


@router.get("/sessions/{sid}")
def session(sid: str, user=Depends(allowed)):
    sid = identity_id(sid)
    manifest = call(user, "GET", f"/v1/internal/sessions/{sid}")
    return call(user, "GET", f"/v1/sessions/{sid}", proof=read_proof(user, manifest["receipt_refs"]))


@router.patch("/sessions/{sid}")
def patch(sid: str, body: dict, user=Depends(allowed)):
    if set(body) - {"context_revision", "context", "archived"}:
        raise HTTPException(422, "invalid_request")
    if body.get("context"):
        body["context"] = checked_context(body["context"])
        ledger.validate_context(user, body["context"])
    return call(user, "PATCH", f"/v1/sessions/{identity_id(sid)}", body)


@router.delete("/sessions/{sid}")
def remove(sid: str, user=Depends(allowed)):
    sid = identity_id(sid)
    manifest = call(user, "GET", f"/v1/internal/sessions/{sid}")
    for execution in manifest["execution_refs"]:
        ledger.revoke(execution, user.id)
    return call(user, "DELETE", f"/v1/sessions/{sid}")


@router.post("/sessions/{sid}/messages", status_code=202)
def message(sid: str, body: MessageBody, user=Depends(allowed), idempotency_key: str = Header(default="")):
    sid = identity_id(sid)
    body.context = checked_context(body.context)
    # Verify ownership before creating a delegation.
    call(user, "GET", f"/v1/internal/sessions/{sid}")
    execution = ledger.register(user, idempotency_key, sid, body.model_dump())
    return call(user, "POST", f"/v1/sessions/{sid}/messages", dict(body.model_dump(), execution_ref=execution), idempotency_key)


@router.get("/runs/{rid}")
def run(rid: str, user=Depends(allowed)):
    rid = identity_id(rid)
    manifest = call(user, "GET", f"/v1/internal/runs/{rid}")
    return call(user, "GET", f"/v1/runs/{rid}", proof=read_proof(user, manifest["receipt_refs"]))


@router.post("/runs/{rid}/cancel")
def cancel(rid: str, user=Depends(allowed)):
    rid = identity_id(rid)
    manifest = call(user, "GET", f"/v1/internal/runs/{rid}")
    for execution in manifest["execution_refs"]:
        ledger.revoke(execution, user.id)
    return call(user, "POST", f"/v1/runs/{rid}/cancel", {})


@router.get("/results/{result_id}")
def result(result_id: str, cursor: int = Query(0, ge=0, le=1000000), user=Depends(allowed)):
    result_id = identity_id(result_id)
    manifest = call(user, "GET", f"/v1/internal/results/{result_id}")
    return call(user, "GET", f"/v1/results/{result_id}?cursor={cursor}", proof=read_proof(user, manifest["receipt_refs"]))


@router.post("/messages/{rid}/feedback")
def feedback(rid: str, body: dict, user=Depends(allowed)):
    if set(body) - {"rating", "reason_code", "comment"}:
        raise HTTPException(422, "invalid_feedback")
    return call(user, "POST", f"/v1/messages/{identity_id(rid)}/feedback", body)
