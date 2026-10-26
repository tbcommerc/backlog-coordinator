from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from auth import authorize_task
from database import get_db
from models import Task
from services.assistant_v2_adapter import (
    actor_user,
    authorized_snapshot,
    decode_actor_envelope,
    require_service_secret,
    validate_snapshot_match,
    validate_task_operations,
)


router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SnapshotRequest(StrictModel):
    object_type: Literal["task", "request", "goal"]
    object_id: str


class DiffValidationRequest(StrictModel):
    target_type: Literal["task", "request", "goal"]
    target_id: str
    base_version: int = Field(ge=0)
    base_digest: str
    operations: list[dict[str, Any]] = Field(max_length=100)


class ApplyIntentPrepareRequest(DiffValidationRequest):
    diff_id: str


def integration_context(
    db: Session = Depends(get_db),
    service_secret: str | None = Header(default=None, alias="X-Assistant-V2-Service-Secret"),
    actor_envelope: str | None = Header(default=None, alias="X-Actor-Envelope"),
):
    require_service_secret(service_secret)
    envelope = decode_actor_envelope(actor_envelope)
    return db, actor_user(db, envelope)


@router.post("/snapshots")
def snapshots(body: SnapshotRequest, context=Depends(integration_context)):
    db, user = context
    return authorized_snapshot(db, user, body.object_type, body.object_id)


@router.post("/diffs/validate")
def validate_diff(body: DiffValidationRequest, context=Depends(integration_context)):
    db, user = context
    if body.target_type not in {"task", "goal"}:
        return {"valid": False, "code": "pilot_target_not_supported", "allowed_diff_paths": []}
    validate_task_operations(body.operations)
    snapshot = authorized_snapshot(db, user, body.target_type, body.target_id)
    return validate_snapshot_match(snapshot, body.base_version, body.base_digest)


@router.post("/apply-intents/prepare")
def prepare_apply_intent(body: ApplyIntentPrepareRequest, context=Depends(integration_context)):
    db, user = context
    if body.target_type not in {"task", "goal"}:
        return {"valid": False, "code": "pilot_target_not_supported"}
    validate_task_operations(body.operations)
    snapshot = authorized_snapshot(db, user, body.target_type, body.target_id)
    result = validate_snapshot_match(snapshot, body.base_version, body.base_digest)
    if not result["valid"]:
        return result
    task = db.query(Task).filter(Task.id == int(body.target_id), Task.is_deleted == False).first()
    authorize_task("edit", task, user)
    prefill: dict[str, Any] = {}
    for operation in body.operations:
        field = operation["path"].lstrip("/")
        prefill[field] = None if operation["op"] == "remove" else operation.get("proposed_value")
    return {
        **result,
        "form_url": f"#/backlog?task={task.id}&assistantV2Diff={body.diff_id}",
        "prefill": prefill,
    }

