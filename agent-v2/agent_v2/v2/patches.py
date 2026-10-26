"""Safe ProposedPatch preview. This module deliberately has no write client."""
from __future__ import annotations

import uuid
from copy import deepcopy

from .models import (
    BusinessRequirementDraftV2,
    LinkedObjectSnapshot,
    ProposedPatch,
    ProposedPatchOperation,
    ProposedPatchTarget,
)

PROTECTED_PATHS = {
    "/owner_id", "/team_id", "/role_id", "/business_customer_id",
    "/user_id", "/credentials", "/password", "/assignee_id",
}

ARTIFACT_FIELD_MAP = {
    "title": "title",
    "description": "problem_statement",
    "business_goal": "business_goal",
    "scope_in": "scope_in",
    "scope_out": "scope_out",
    "acceptance_criteria": "acceptance_criteria",
}


def build_proposed_patch(
    session_id: str,
    snapshot: LinkedObjectSnapshot,
    artifact: BusinessRequirementDraftV2,
    *,
    current_snapshot_fingerprint: str = "",
) -> ProposedPatch:
    stale = bool(
        current_snapshot_fingerprint
        and current_snapshot_fingerprint != snapshot.fingerprint
    )
    operations: list[ProposedPatchOperation] = []
    for field in snapshot.allowed_fields:
        path = "/" + field.lstrip("/")
        if path in PROTECTED_PATHS:
            continue
        artifact_field = ARTIFACT_FIELD_MAP.get(field)
        if not artifact_field:
            continue
        before = deepcopy(snapshot.fields.get(field))
        after = deepcopy(getattr(artifact, artifact_field, None))
        if before == after or after in (None, "", []):
            continue
        operations.append(ProposedPatchOperation(
            op="add" if before in (None, "", []) else "replace",
            path=path,
            before=before,
            after=after,
            reason=f"Предложено из подтверждённой ревизии {artifact.revision}",
        ))
    return ProposedPatch(
        id=f"pp_{uuid.uuid4().hex}",
        session_id=session_id,
        target=ProposedPatchTarget(
            object_type=snapshot.object_type,
            object_id=snapshot.object_id,
            base_version=snapshot.object_version,
            base_fingerprint=snapshot.fingerprint,
        ),
        operations=operations,
        protected_paths=sorted(PROTECTED_PATHS),
        status="stale" if stale else "awaiting_human_decision",
        created_from_revision=artifact.revision,
    )


def decide_operation(patch: ProposedPatch, operation_index: int, decision: str) -> ProposedPatch:
    if patch.status == "stale":
        raise ValueError("stale_patch")
    if decision not in {"accepted", "rejected"}:
        raise ValueError("invalid_patch_decision")
    try:
        operation = patch.operations[operation_index]
    except IndexError as exc:
        raise ValueError("patch_operation_not_found") from exc
    if operation.path in PROTECTED_PATHS:
        raise ValueError("protected_path")
    operation.status = decision
    statuses = {item.status for item in patch.operations}
    if statuses == {"accepted"}:
        patch.status = "accepted"
    elif statuses == {"rejected"}:
        patch.status = "rejected"
    else:
        patch.status = "partially_decided"
    return patch
