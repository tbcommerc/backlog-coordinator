from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.orm import Session

from app.api.dto import (
    ApplyIntentRequest,
    ArtifactCreateRequest,
    ArtifactValidateRequest,
    CaseDecisionRequest,
    ClaimCreateRequest,
    ClaimDecisionRequest,
    ConflictCreateRequest,
    ConflictDecisionRequest,
    CreateCaseRequest,
    DiffCreateRequest,
    DiffOperationDecisionRequest,
    DiffRebaseRequest,
    GapCreateRequest,
    GapDecisionRequest,
    HandoffRequest,
    MessageRequest,
    ReviewCandidateRequest,
    ReviewDecisionRequest,
    RevisionCreateRequest,
    SourceCreateRequest,
    SplitRequest,
    TransitionRequest,
)
from app.api.errors import DomainError
from app.application.service import AssistantV2Service
from app.config import get_settings
from app.database import get_db
from app.models import ArtifactRevision, ReviewGate
from app.security import ActorContext, get_actor


router = APIRouter()


def idempotency_key(value: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> str:
    if value is None or not 8 <= len(value) <= 64:
        raise DomainError("idempotency_key_required", "Idempotency-Key должен содержать 8–64 символа.", 422)
    return value


def service(
    db: Session = Depends(get_db),
    actor: ActorContext = Depends(get_actor),
) -> AssistantV2Service:
    return AssistantV2Service(db, actor)


@router.get("/config")
def runtime_config(actor: ActorContext = Depends(get_actor)):
    return {
        "enabled": True,
        "pilot_allowed": actor.pilot_allowed,
        "modes": ["capture_assignment", "requirement_copilot"],
        "provider_mode": "manual_safe",
        "real_data_allowed": get_settings().ALLOW_REAL_DATA,
        "atomic_apply_enabled": False,
    }


@router.post("/cases", status_code=status.HTTP_201_CREATED)
def create_case(body: CreateCaseRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_case(body.model_dump(), key)


@router.get("/cases")
def list_cases(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None),
    svc: AssistantV2Service = Depends(service),
):
    return svc.list_cases(limit=limit, cursor=cursor)


@router.get("/cases/{case_id}")
def get_case(case_id: str, svc: AssistantV2Service = Depends(service)):
    return svc.case_projection(svc._case(case_id))


@router.post("/cases/{case_id}/sources", status_code=status.HTTP_201_CREATED)
def add_source(case_id: str, body: SourceCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.add_source(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/claims", status_code=status.HTTP_201_CREATED)
def create_claim(case_id: str, body: ClaimCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_claim(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/claims/{claim_id}/decision")
def decide_claim(case_id: str, claim_id: str, body: ClaimDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.decide_claim(case_id, claim_id, body.model_dump(), key)


@router.post("/cases/{case_id}/decisions")
def record_case_decision(case_id: str, body: CaseDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.record_case_decision(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/gaps", status_code=status.HTTP_201_CREATED)
def create_gap(case_id: str, body: GapCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_gap(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/gaps/{gap_id}/decisions")
def decide_gap(case_id: str, gap_id: str, body: GapDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.decide_gap(case_id, gap_id, body.model_dump(), key)


@router.post("/cases/{case_id}/conflicts", status_code=status.HTTP_201_CREATED)
def create_conflict(case_id: str, body: ConflictCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_conflict(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/conflicts/{conflict_id}/decisions")
def decide_conflict(case_id: str, conflict_id: str, body: ConflictDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.decide_conflict(case_id, conflict_id, body.model_dump(), key)


@router.post("/cases/{case_id}/transitions")
def transition_case(case_id: str, body: TransitionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.transition_case(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/split", status_code=status.HTTP_201_CREATED)
def split_case(case_id: str, body: SplitRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.split_case(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/handoffs", status_code=status.HTTP_201_CREATED)
def handoff_case(case_id: str, body: HandoffRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.handoff(case_id, body.model_dump(), key)


@router.post("/cases/{case_id}/messages")
def add_message(case_id: str, body: MessageRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.add_message(case_id, body.model_dump(), key)


@router.post("/artifacts", status_code=status.HTTP_201_CREATED)
def create_artifact(body: ArtifactCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_artifact(body.model_dump(), key)


@router.get("/artifacts/{artifact_id}")
def get_artifact(artifact_id: str, svc: AssistantV2Service = Depends(service)):
    return svc.artifact_projection(svc._artifact(artifact_id))


@router.post("/artifacts/{artifact_id}/revisions", status_code=status.HTTP_201_CREATED)
def create_revision(artifact_id: str, body: RevisionCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_revision(artifact_id, body.model_dump(), key)


@router.post("/artifacts/{artifact_id}/validate")
def validate_artifact(artifact_id: str, body: ArtifactValidateRequest, svc: AssistantV2Service = Depends(service)):
    return svc.validate_artifact(artifact_id, body.revision_id)


@router.post("/artifacts/{artifact_id}/review-candidates", status_code=status.HTTP_201_CREATED)
def create_review_candidate(artifact_id: str, body: ReviewCandidateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_review_candidate(artifact_id, body.model_dump(), key)


@router.get("/review-gates/{gate_id}")
def get_review_gate(gate_id: str, svc: AssistantV2Service = Depends(service)):
    gate = svc.db.get(ReviewGate, gate_id)
    if gate is None:
        raise DomainError("review_gate_not_found", "Review gate недоступен.", 404)
    revision = svc.db.get(ArtifactRevision, gate.artifact_revision_id)
    artifact = svc._artifact(revision.artifact_id)
    return {
        "id": gate.id,
        "status": gate.status,
        "version": gate.version,
        "active": gate.active,
        "reviewer": gate.reviewer_snapshot,
        "submitted_at": gate.submitted_at,
        "decided_at": gate.decided_at,
        "artifact": svc.artifact_projection(artifact),
    }


@router.post("/review-gates/{gate_id}/decisions")
def decide_review(gate_id: str, body: ReviewDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.decide_review(gate_id, body.model_dump(), key)


@router.post("/diffs", status_code=status.HTTP_201_CREATED)
def create_diff(body: DiffCreateRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_diff(body.model_dump(), key)


@router.get("/diffs/{diff_id}")
def get_diff(diff_id: str, svc: AssistantV2Service = Depends(service)):
    return svc.diff_projection(svc._diff(diff_id))


@router.post("/diffs/{diff_id}/operations/{operation_id}/decision")
def decide_diff_operation(diff_id: str, operation_id: str, body: DiffOperationDecisionRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.decide_diff_operation(diff_id, operation_id, body.model_dump(), key)


@router.post("/diffs/{diff_id}/rebase", status_code=status.HTTP_201_CREATED)
def rebase_diff(diff_id: str, body: DiffRebaseRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.rebase_diff(diff_id, body.model_dump(), key)


@router.post("/diffs/{diff_id}/apply-intents")
def create_apply_intent(diff_id: str, body: ApplyIntentRequest, key: str = Depends(idempotency_key), svc: AssistantV2Service = Depends(service)):
    return svc.create_apply_intent(diff_id, body.model_dump(), key)


@router.get("/runs/{run_id}")
def get_run(run_id: str, svc: AssistantV2Service = Depends(service)):
    return svc.get_run(run_id)
