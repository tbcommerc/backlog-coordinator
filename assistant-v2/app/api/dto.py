from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.enums import ClaimType, NeedCaseStatus


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateCaseRequest(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    passport: dict[str, Any] = Field(default_factory=dict)
    source_party: dict[str, Any] = Field(default_factory=dict)
    data_classification: Literal["synthetic", "approved_real"] = "synthetic"


class SourceCreateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    kind: Literal["text", "note", "transcript", "dmb_snapshot", "message", "raw_audio"]
    origin_type: Literal["verbatim", "operator_retelling", "authorized_snapshot", "operator_input"]
    channel: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1)
    mime_type: str = Field(default="text/plain", max_length=128)
    captured_at: datetime
    supersedes_id: str | None = None


class ClaimCreateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    statement: str = Field(min_length=1, max_length=20_000)
    path: str | None = Field(default=None, max_length=255)
    claim_type: ClaimType
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence_fragment_ids: list[str] = Field(default_factory=list, max_length=50)
    status: Literal["proposed", "accepted"] = "proposed"


class ClaimDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    decision: Literal["accept", "edit", "reject"]
    rationale: str = Field(min_length=1, max_length=4000)
    edited_statement: str | None = Field(default=None, max_length=20_000)
    edited_claim_type: ClaimType | None = None
    passport_value: Any = None

    @model_validator(mode="after")
    def validate_edit(self):
        if self.decision == "edit" and not self.edited_statement:
            raise ValueError("edited_statement is required for edit")
        return self


class CaseDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    decision_type: Literal["fidelity_confirmation", "customer_confirmation", "gap_disposition", "conflict_resolution"]
    rationale: str = Field(min_length=1, max_length=4000)
    target_refs: dict[str, Any] = Field(default_factory=dict)
    revision_digest: str | None = None


class GapCreateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    rule_id: str = Field(min_length=1, max_length=64)
    path: str = Field(min_length=1, max_length=255)
    severity: Literal["blocking", "warning", "info"]
    owner_snapshot: dict[str, Any] | None = None
    next_step: str | None = Field(default=None, max_length=4000)
    due_at: datetime | None = None


class GapDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    expected_case_version: int = Field(ge=0)
    decision: Literal["resolve", "assign", "defer", "reopen"]
    rationale: str = Field(min_length=1, max_length=4000)
    owner_snapshot: dict[str, Any] | None = None
    next_step: str | None = Field(default=None, max_length=4000)
    due_at: datetime | None = None

    @model_validator(mode="after")
    def validate_disposition(self):
        if self.decision in {"assign", "defer"} and not (self.owner_snapshot and self.next_step):
            raise ValueError("owner_snapshot and next_step are required for assign/defer")
        return self


class ConflictCreateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    left_ref: str = Field(min_length=1, max_length=128)
    right_ref: str = Field(min_length=1, max_length=128)
    severity: Literal["critical", "major", "minor"]

    @model_validator(mode="after")
    def validate_distinct_refs(self):
        if self.left_ref == self.right_ref:
            raise ValueError("left_ref and right_ref must be different")
        return self


class ConflictDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    expected_case_version: int = Field(ge=0)
    decision: Literal["resolve", "escalate", "reopen"]
    rationale: str = Field(min_length=1, max_length=4000)
    owner_snapshot: dict[str, Any] | None = None


class TransitionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    target_status: NeedCaseStatus
    rationale: str = Field(min_length=1, max_length=4000)
    disposition: dict[str, Any] = Field(default_factory=dict)


class SplitChild(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    passport: dict[str, Any] = Field(default_factory=dict)


class SplitRequest(StrictModel):
    expected_version: int = Field(ge=0)
    rationale: str = Field(min_length=1, max_length=4000)
    children: list[SplitChild] = Field(min_length=2, max_length=20)


class HandoffItem(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    content: dict[str, Any] = Field(default_factory=dict)


class HandoffRequest(StrictModel):
    expected_version: int = Field(ge=0)
    rationale: str = Field(min_length=1, max_length=4000)
    requirements: list[HandoffItem] = Field(min_length=1, max_length=20)


class MessageRequest(StrictModel):
    message_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    body: str = Field(min_length=1)
    expected_case_version: int = Field(ge=0)
    mode: Literal["capture_assignment", "requirement_copilot"]
    artifact_revision_id: str | None = None
    client_context: dict[str, Any] = Field(default_factory=dict)


class ArtifactCreateRequest(StrictModel):
    case_id: str | None = None
    external_object_type: Literal["task", "request", "goal"] | None = None
    external_object_id: str | None = None
    title: str = Field(min_length=1, max_length=255)
    content: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_origin(self):
        if bool(self.case_id) == bool(self.external_object_type and self.external_object_id):
            raise ValueError("provide exactly one origin: case_id or external object")
        return self


class RevisionCreateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    base_revision_id: str
    content: dict[str, Any]
    claim_links: list[dict[str, str]] = Field(default_factory=list, max_length=500)


class ArtifactValidateRequest(StrictModel):
    revision_id: str


class ReviewCandidateRequest(StrictModel):
    expected_version: int = Field(ge=0)
    revision_id: str
    rationale: str = Field(min_length=1, max_length=4000)


class ReviewDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    decision: Literal["return", "approve"]
    rationale: str = Field(min_length=1, max_length=4000)


class DiffOperationRequest(StrictModel):
    ordinal: int = Field(ge=1)
    op: Literal["add", "replace", "remove"]
    path: str = Field(min_length=2, max_length=255)
    old_value_hash: str | None = None
    proposed_value: Any = None
    claim_refs: list[str] = Field(default_factory=list, max_length=100)
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    rationale: str = Field(min_length=1, max_length=4000)
    risk: Literal["low", "medium", "high", "unknown"] = "unknown"


class DiffCreateRequest(StrictModel):
    target_type: Literal["task", "request", "goal"]
    target_id: str
    base_version: int = Field(ge=0)
    base_digest: str
    source_revision_id: str
    source_revision_digest: str
    operations: list[DiffOperationRequest] = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None


class DiffOperationDecisionRequest(StrictModel):
    expected_version: int = Field(ge=0)
    decision: Literal["accept", "reject"]
    rationale: str = Field(min_length=1, max_length=4000)


class DiffRebaseRequest(StrictModel):
    expected_version: int = Field(ge=0)


class ApplyIntentRequest(StrictModel):
    expected_version: int = Field(ge=0)


class CursorPage(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = None


def bounded_json(value: Any, max_bytes: int) -> Any:
    import json

    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > max_bytes:
        raise ValueError("JSON payload exceeds configured limit")
    return value
