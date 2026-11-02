"""Typed contracts for the two Assistant V2 product modes."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..composer.schema import RequirementDraft


class ProductMode(str, Enum):
    ASSIGNMENT_CAPTURE = "assignment_capture"
    REQUIREMENT_COPILOT = "requirement_copilot"


class ProvenanceRecord(BaseModel):
    kind: Literal[
        "originator_statement",
        "operator_interpretation",
        "agent_hypothesis",
        "human_decision",
        "linked_object_snapshot",
        "knowledge_base",
        "attachment_excerpt",
    ]
    evidence: str = ""
    source_ref: str = ""
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    confirmed: bool = False
    message_id: str = ""
    revision_id: str = ""
    decision_type: str = ""

    @model_validator(mode="after")
    def hypotheses_are_never_implicitly_confirmed(self):
        if self.kind == "agent_hypothesis" and self.confirmed:
            raise ValueError("agent_hypothesis requires a separate human_decision")
        return self


class Originator(BaseModel):
    display_name: str = ""
    external_ref: Optional[str] = None


class SourceContext(BaseModel):
    source_type: Literal[
        "business_customer", "management", "meeting", "email", "messenger",
        "document", "operator", "other",
    ]
    channel: Literal["meeting", "email", "messenger", "document", "oral", "other"]
    received_at: Optional[datetime] = None
    originator: Optional[Originator] = None
    source_summary: str = Field(default="", max_length=4000)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    provenance: list[ProvenanceRecord] = Field(default_factory=list)


class LinkedObjectSnapshot(BaseModel):
    object_type: Literal["request", "task", "goal", "draft"]
    object_id: str = Field(min_length=1, max_length=128)
    source_system: str = Field(default="dmb", max_length=64)
    object_version: str = Field(min_length=1, max_length=128)
    fingerprint: str = Field(pattern=r"^sha256:[0-9a-f]{16,64}$")
    title: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=4000)
    allowed_fields: list[str] = Field(default_factory=list)
    fields: dict[str, Any] = Field(default_factory=dict)
    captured_at: datetime

    @field_validator("allowed_fields")
    @classmethod
    def normalize_allowed_fields(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip().lstrip("/") for item in value if item.strip()))


class ReadinessResult(BaseModel):
    ready: bool
    ready_for_review: Optional[bool] = None
    blocking_codes: list[str] = Field(default_factory=list)
    warning_codes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def expose_review_alias(self):
        if self.ready_for_review is None:
            self.ready_for_review = self.ready
        return self


class AssignmentPassport(BaseModel):
    schema: str = "assignment-passport.v1"
    id: str
    title: str
    operator: dict[str, Any]
    source_context: dict[str, Any]
    assignment_statement: str
    business_goal: str
    expected_result: str
    scope: dict[str, list[str]]
    constraints: list[str] = Field(default_factory=list)
    deadline_or_urgency: str = ""
    stakeholders: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    initial_risks: list[str] = Field(default_factory=list)
    source_materials: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    owner_next_step: str = ""
    assumptions: list[dict[str, Any]] = Field(default_factory=list)
    gaps: list[dict[str, Any]] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    sources: list[dict[str, Any]] = Field(default_factory=list)
    field_provenance: dict[str, dict[str, Any]] = Field(default_factory=dict)
    readiness: ReadinessResult
    next_step: str = "requirement_copilot"
    revision: int = 1
    fingerprint: str = ""
    prompt_set_version: str = ""


class BusinessRequirementDraftV2(RequirementDraft):
    model_config = ConfigDict(extra="allow")
    schema: str = "business-requirement-draft.v2"
    artifact_id: str = ""
    business_requirements: list[dict[str, Any]] = Field(default_factory=list)
    document_profile: str = "product_process_change"
    origin: dict[str, Any] = Field(default_factory=dict)
    linked_object: Optional[dict[str, Any]] = None
    business_goal: str = ""
    scope_in: list[str] = Field(default_factory=list)
    scope_out: list[str] = Field(default_factory=list)
    actors: list[str] = Field(default_factory=list)
    stakeholders: list[str] = Field(default_factory=list)
    alternative_scenarios: list[str] = Field(default_factory=list)
    exception_scenarios: list[str] = Field(default_factory=list)
    functional_requirements: list[str] = Field(default_factory=list)
    non_functional_requirements: list[str] = Field(default_factory=list)
    success_metrics: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    quality: ReadinessResult = Field(default_factory=lambda: ReadinessResult(ready=False))
    revision: int = 1
    fingerprint: str = ""
    prompt_set_version: str = ""


class ProposedPatchTarget(BaseModel):
    object_type: str
    object_id: str
    base_version: str
    base_fingerprint: str


class ProposedPatchOperation(BaseModel):
    op: Literal["add", "replace", "remove"]
    path: str
    before: Any = None
    after: Any = None
    reason: str
    status: Literal["proposed", "accepted", "rejected"] = "proposed"


class ProposedPatch(BaseModel):
    schema: str = "proposed-patch.v1"
    id: str
    session_id: str
    target: ProposedPatchTarget
    operations: list[ProposedPatchOperation] = Field(default_factory=list)
    protected_paths: list[str] = Field(default_factory=list)
    status: Literal[
        "awaiting_human_decision", "partially_decided", "accepted", "rejected", "stale"
    ] = "awaiting_human_decision"
    created_from_revision: int


class ArtifactRevision(BaseModel):
    revision: int
    artifact_type: Literal["assignment_passport", "business_requirement_v2"]
    author_kind: Literal["operator", "agent_proposal", "reviewer"]
    before_fingerprint: str = ""
    fingerprint: str
    applied_operations: list[dict[str, Any]] = Field(default_factory=list)
    artifact: dict[str, Any]
    created_at: datetime
