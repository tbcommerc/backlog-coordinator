from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class NeedCase(Base):
    __tablename__ = "need_cases"
    __table_args__ = (Index("ix_need_cases_status_updated", "status", "updated_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    data_classification: Mapped[str] = mapped_column(String(24), nullable=False, default="synthetic")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}
    current_revision_id: Mapped[str | None] = mapped_column(String(36))
    parent_case_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("need_cases.id"))
    passport_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    potentially_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CaseRevision(Base):
    __tablename__ = "case_revisions"
    __table_args__ = (UniqueConstraint("case_id", "revision_no", name="uq_case_revision_no"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False, index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    base_revision_id: Mapped[str | None] = mapped_column(String(36))
    content_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    digest: Mapped[str] = mapped_column(String(80), nullable=False)
    digest_algorithm: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CaseParticipant(Base):
    __tablename__ = "case_participants"
    __table_args__ = (UniqueConstraint("case_id", "subject_type", "subject_id", "role", "active", name="uq_case_participant_active"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False, index=True)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    subject_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SourceArtifact(Base):
    __tablename__ = "source_artifacts"
    __table_args__ = (Index("ix_sources_case_captured", "case_id", "captured_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    origin_type: Mapped[str] = mapped_column(String(32), nullable=False)
    channel: Mapped[str] = mapped_column(String(64), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, default="text/plain")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    digest: Mapped[str] = mapped_column(String(80), nullable=False)
    digest_algorithm: Mapped[str] = mapped_column(String(32), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("source_artifacts.id"))
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SourceFragment(Base):
    __tablename__ = "source_fragments"
    __table_args__ = (UniqueConstraint("source_id", "locator_type", "selector", name="uq_source_fragment_locator"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("source_artifacts.id"), nullable=False, index=True)
    locator_type: Mapped[str] = mapped_column(String(32), nullable=False, default="characters")
    start_offset: Mapped[int | None] = mapped_column(Integer)
    end_offset: Mapped[int | None] = mapped_column(Integer)
    selector: Mapped[str] = mapped_column(String(255), nullable=False)
    text_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    excerpt: Mapped[str | None] = mapped_column(Text)


class Claim(Base):
    __tablename__ = "claims"
    __table_args__ = (Index("ix_claims_case_type_status", "case_id", "claim_type", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str | None] = mapped_column(String(255))
    claim_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="proposed")
    confirmation_level: Mapped[str] = mapped_column(String(32), nullable=False, default="unconfirmed")
    confidence: Mapped[float | None] = mapped_column(Float)
    author_type: Mapped[str] = mapped_column(String(32), nullable=False)
    author_id: Mapped[str | None] = mapped_column(String(64))
    supersedes_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("claims.id"))
    created_revision_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ClaimEvidence(Base):
    __tablename__ = "claim_evidence"
    __table_args__ = (UniqueConstraint("claim_id", "source_fragment_id", "evidence_role", name="uq_claim_evidence"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id"), nullable=False)
    source_fragment_id: Mapped[str] = mapped_column(String(36), ForeignKey("source_fragments.id"), nullable=False)
    evidence_role: Mapped[str] = mapped_column(String(24), nullable=False, default="supports")


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (Index("ix_artifacts_case_type_status", "case_id", "artifact_type", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(48), nullable=False, default="business_requirement")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="drafting")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}
    current_revision_id: Mapped[str | None] = mapped_column(String(36))
    approved_revision_id: Mapped[str | None] = mapped_column(String(36))
    potentially_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ArtifactRevision(Base):
    __tablename__ = "artifact_revisions"
    __table_args__ = (
        UniqueConstraint("artifact_id", "revision_no", name="uq_artifact_revision_no"),
        UniqueConstraint("artifact_id", "digest", name="uq_artifact_revision_digest"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(String(36), ForeignKey("artifacts.id"), nullable=False, index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    base_revision_id: Mapped[str | None] = mapped_column(String(36))
    schema_version: Mapped[str] = mapped_column(String(48), nullable=False, default="business-requirement/1.0")
    content_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    digest: Mapped[str] = mapped_column(String(80), nullable=False)
    digest_algorithm: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class RevisionClaim(Base):
    __tablename__ = "revision_claims"
    __table_args__ = (UniqueConstraint("revision_id", "claim_id", "usage_path", name="uq_revision_claim_path"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    revision_id: Mapped[str] = mapped_column(String(36), ForeignKey("artifact_revisions.id"), nullable=False)
    claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("claims.id"), nullable=False)
    usage_path: Mapped[str] = mapped_column(String(255), nullable=False)
    usage_type: Mapped[str] = mapped_column(String(32), nullable=False, default="supports")


class Gap(Base):
    __tablename__ = "gaps"
    __table_args__ = (Index("ix_gaps_open", "case_id", "artifact_id", "severity", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("need_cases.id"))
    artifact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("artifacts.id"))
    rule_id: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    owner_snapshot: Mapped[dict | None] = mapped_column(JSON)
    next_step: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}


class Conflict(Base):
    __tablename__ = "conflicts"
    __table_args__ = (Index("ix_conflicts_unresolved", "case_id", "artifact_id", "severity", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("need_cases.id"))
    artifact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("artifacts.id"))
    left_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    right_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    resolution_decision_id: Mapped[str | None] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}


class DecisionRecord(Base):
    __tablename__ = "decision_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    aggregate_type: Mapped[str] = mapped_column(String(48), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    decision_type: Mapped[str] = mapped_column(String(48), nullable=False)
    actor_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    target_refs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    before_digest: Mapped[str | None] = mapped_column(String(80))
    after_digest: Mapped[str | None] = mapped_column(String(80))
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ExternalObjectLink(Base):
    __tablename__ = "external_object_links"
    __table_args__ = (UniqueConstraint("system", "object_type", "external_id", "active", name="uq_external_active_link"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("need_cases.id"))
    artifact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("artifacts.id"))
    system: Mapped[str] = mapped_column(String(32), nullable=False, default="dmb")
    object_type: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    display_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    access_checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ProposedDiff(Base):
    __tablename__ = "proposed_diffs"
    __table_args__ = (Index("ix_diffs_target_status", "target_type", "target_id", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    target_system: Mapped[str] = mapped_column(String(32), nullable=False, default="dmb")
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_link_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("external_object_links.id"))
    source_revision_id: Mapped[str] = mapped_column(String(36), ForeignKey("artifact_revisions.id"), nullable=False)
    source_revision_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    base_version: Mapped[int] = mapped_column(Integer, nullable=False)
    base_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="proposed")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rebased_from_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("proposed_diffs.id"))


class DiffOperation(Base):
    __tablename__ = "diff_operations"
    __table_args__ = (UniqueConstraint("diff_id", "ordinal", name="uq_diff_operation_ordinal"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    diff_id: Mapped[str] = mapped_column(String(36), ForeignKey("proposed_diffs.id"), nullable=False, index=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    op: Mapped[str] = mapped_column(String(16), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    old_value_hash: Mapped[str | None] = mapped_column(String(80))
    proposed_value: Mapped[object | None] = mapped_column(JSON)
    claim_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    evidence_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    risk: Mapped[str] = mapped_column(String(24), nullable=False, default="unknown")
    decision_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    decision_record_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("decision_records.id"))


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (UniqueConstraint("case_id", "message_id", "input_revision_digest", name="uq_agent_run_input"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False)
    artifact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("artifacts.id"))
    revision_id: Mapped[str | None] = mapped_column(String(36))
    message_id: Mapped[str] = mapped_column(String(64), nullable=False)
    input_revision_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    mode: Mapped[str] = mapped_column(String(48), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(48), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(48), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(48), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    token_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("case_id", "message_id", name="uq_case_message_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("need_cases.id"), nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    body_digest: Mapped[str] = mapped_column(String(80), nullable=False)
    message_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ReviewGate(Base):
    __tablename__ = "review_gates"
    __table_args__ = (UniqueConstraint("artifact_revision_id", "active", name="uq_review_gate_active"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_revision_id: Mapped[str] = mapped_column(String(36), ForeignKey("artifact_revisions.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="in_review")
    reviewer_snapshot: Mapped[dict | None] = mapped_column(JSON)
    findings_digest: Mapped[str | None] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    __mapper_args__ = {"version_id_col": version, "version_id_generator": False}
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_request", "request_id"),
        Index("ix_audit_trace", "trace_id"),
        Index("ix_audit_aggregate", "aggregate_type", "aggregate_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(48), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(36), nullable=False)
    aggregate_version: Mapped[int | None] = mapped_column(Integer)
    before_digest: Mapped[str | None] = mapped_column(String(80))
    after_digest: Mapped[str | None] = mapped_column(String(80))
    refs_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    origin: Mapped[str] = mapped_column(String(24), nullable=False)
    guard_result: Mapped[str] = mapped_column(String(24), nullable=False, default="allowed")
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("operation", "actor_id", "key", name="uq_idempotency_operation_actor_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    operation: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    response_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    resource_ref: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (Index("ix_outbox_pending", "processed_at", "dead_lettered_at", "available_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(48), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(36), nullable=False)
    aggregate_version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_min: Mapped[dict] = mapped_column(JSON, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error_code: Mapped[str | None] = mapped_column(String(64))
