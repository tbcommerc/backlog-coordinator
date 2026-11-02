"""Pydantic schemas for the agent HTTP API."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str = ""
    message_id: str = Field(default="", max_length=64)
    message: str = Field(max_length=4000)
    context: Optional[dict] = None


class NewSessionRequest(BaseModel):
    user_id: int = 0
    context: Optional[dict] = None
    product_mode: Literal["assignment_capture", "requirement_copilot"]
    source_context: Optional[dict] = None
    linked_object: Optional[dict] = None
    idempotency_key: str = Field(default="", max_length=128)


class ResetRequest(BaseModel):
    session_id: str = ""
    user_id: int
    idempotency_key: str = Field(default="", max_length=128)


class SendForReviewRequest(BaseModel):
    session_id: str = ""
    task_id: int
    title: str = ""
    user_id: int
    expected_draft_hash: str = Field(default="", max_length=80)
    idempotency_key: str = Field(default="", max_length=128)


class ReopenReviewRequest(BaseModel):
    session_id: str = ""
    user_id: int
    comment: str = Field(default="", max_length=5000)
    idempotency_key: str = Field(default="", max_length=128)


class CancelReviewRequest(BaseModel):
    session_id: str = ""
    task_id: int
    user_id: int
    idempotency_key: str = Field(default="", max_length=128)


class EditDraftSectionRequest(BaseModel):
    session_id: str = ""
    field: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=5000)
    user_id: int
    idempotency_key: str = Field(default="", max_length=128)


class ImportRequirementDocumentRequest(BaseModel):
    session_id: str = ""
    content: str = Field(min_length=1, max_length=30000)
    user_id: int
    idempotency_key: str = Field(default="", max_length=128)


class SessionActionRequest(BaseModel):
    user_id: int
    idempotency_key: str = Field(default="", max_length=128)


class DocumentSourceInput(BaseModel):
    id: str = Field(default="", max_length=128)
    title: str = Field(default="Источник", max_length=500)
    content: str = Field(min_length=1, max_length=30000)
    source_type: Literal["text"] = "text"
    source_ref: str = Field(default="", max_length=1000)


class DocumentActionRequest(SessionActionRequest):
    session_id: str = Field(min_length=1, max_length=128)
    action: Literal["review", "draft", "create_draft", "save_sections", "propose_change", "apply_proposal", "dismiss_proposal", "resolve_finding", "add_source", "next_revision"]
    sections: dict[str, str] = Field(default_factory=dict, max_length=30)
    expected_draft_hash: str = Field(default="", max_length=80)
    instruction: str = Field(default="", max_length=5000)
    field: str = Field(default="", max_length=64)
    proposal_id: str = Field(default="", max_length=128)
    operation_ids: list[str] = Field(default_factory=list, max_length=100)
    finding_id: str = Field(default="", max_length=128)
    decision: Literal["resolved", "rejected", "deferred"] = "resolved"
    reason: str = Field(default="", max_length=5000)
    source: Optional[DocumentSourceInput] = None


class LinkObjectRequest(SessionActionRequest):
    snapshot: dict


class ProposedPatchRequest(SessionActionRequest):
    current_snapshot_fingerprint: str = Field(default="", max_length=80)


class PatchDecisionRequest(SessionActionRequest):
    operation_index: int = Field(ge=0)
    decision: Literal["accepted", "rejected"]


class AgentResponse(BaseModel):
    success: bool = True
    session_id: str = ""
    action: str = ""
    message: str = ""
    blocks: list = Field(default_factory=list)
    phase: str = ""
    slots: dict = Field(default_factory=dict)
    progress: list = Field(default_factory=list)
    draft: Optional[dict] = None
    draft_revision: str = ""
    can_generate_draft: bool = False
    history: list = Field(default_factory=list)
    quality: dict = Field(default_factory=dict)
    request_id: Optional[int] = None
    expected_slot: str = ""
    dialogue_mode: str = ""
    sources: list = Field(default_factory=list)
    product_mode: str = ""
    operator_role: str = ""
    source_context: dict = Field(default_factory=dict)
    artifact_type: str = ""
    assignment_passport: Optional[dict] = None
    linked_object: Optional[dict] = None
    proposed_patch: Optional[dict] = None
    readiness: dict = Field(default_factory=dict)
    gaps: list = Field(default_factory=list)
    conflicts: list = Field(default_factory=list)
    schema_version: int = 1
    artifact_revision_history: list = Field(default_factory=list)
    storage_version: int = 0
    artifact_id: str = ""
    document_review: dict = Field(default_factory=dict)
    document_findings: list = Field(default_factory=list)
    document_proposals: list = Field(default_factory=list)
    document_sources: list = Field(default_factory=list)
    document_generation: dict = Field(default_factory=dict)


class ConfigResponse(BaseModel):
    provider: str = ""
    provider_available: bool = False
    dialogue_engine: str = ""
    intents: dict = Field(default_factory=dict)
    kb_stats: dict = Field(default_factory=dict)
    mcp_servers: list = Field(default_factory=list)
    tools: list = Field(default_factory=list)
    assistant_version: str = "v2"
    enabled: bool = False
    product_modes: list[str] = Field(default_factory=list)
    prompt_set_version: str = ""
