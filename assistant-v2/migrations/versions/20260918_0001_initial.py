"""Initial isolated Assistant V2 schema.

Revision ID: 20260918_0001
Revises: None
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260918_0001"
down_revision = None
branch_labels = None
depends_on = None


def _id() -> sa.Column:
    return sa.Column("id", sa.String(36), primary_key=True)


def _created_at() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)


def upgrade() -> None:
    op.create_table(
        "need_cases",
        _id(),
        sa.Column("case_number", sa.String(32), nullable=False, unique=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("data_classification", sa.String(24), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("current_revision_id", sa.String(36)),
        sa.Column("parent_case_id", sa.String(36), sa.ForeignKey("need_cases.id")),
        sa.Column("passport_json", sa.JSON(), nullable=False),
        sa.Column("potentially_stale", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_need_cases_status_updated", "need_cases", ["status", "updated_at"])
    op.create_table(
        "case_revisions",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("base_revision_id", sa.String(36)),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("digest", sa.String(80), nullable=False),
        sa.Column("digest_algorithm", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
        sa.UniqueConstraint("case_id", "revision_no", name="uq_case_revision_no"),
    )
    op.create_index("ix_case_revisions_case_id", "case_revisions", ["case_id"])
    op.create_table(
        "case_participants",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("subject_type", sa.String(32), nullable=False),
        sa.Column("subject_id", sa.String(128), nullable=False),
        sa.Column("subject_snapshot", sa.JSON(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        _created_at(),
        sa.UniqueConstraint("case_id", "subject_type", "subject_id", "role", "active", name="uq_case_participant_active"),
    )
    op.create_index("ix_case_participants_case_id", "case_participants", ["case_id"])
    op.create_table(
        "source_artifacts",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("origin_type", sa.String(32), nullable=False),
        sa.Column("channel", sa.String(64), nullable=False),
        sa.Column("mime_type", sa.String(128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("digest", sa.String(80), nullable=False),
        sa.Column("digest_algorithm", sa.String(32), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("supersedes_id", sa.String(36), sa.ForeignKey("source_artifacts.id")),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
    )
    op.create_index("ix_sources_case_captured", "source_artifacts", ["case_id", "captured_at"])
    op.create_table(
        "source_fragments",
        _id(),
        sa.Column("source_id", sa.String(36), sa.ForeignKey("source_artifacts.id"), nullable=False),
        sa.Column("locator_type", sa.String(32), nullable=False),
        sa.Column("start_offset", sa.Integer()),
        sa.Column("end_offset", sa.Integer()),
        sa.Column("selector", sa.String(255), nullable=False),
        sa.Column("text_digest", sa.String(80), nullable=False),
        sa.Column("excerpt", sa.Text()),
        sa.UniqueConstraint("source_id", "locator_type", "selector", name="uq_source_fragment_locator"),
    )
    op.create_index("ix_source_fragments_source_id", "source_fragments", ["source_id"])
    op.create_table(
        "claims",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("path", sa.String(255)),
        sa.Column("claim_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("confirmation_level", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float()),
        sa.Column("author_type", sa.String(32), nullable=False),
        sa.Column("author_id", sa.String(64)),
        sa.Column("supersedes_id", sa.String(36), sa.ForeignKey("claims.id")),
        sa.Column("created_revision_id", sa.String(36)),
        _created_at(),
    )
    op.create_index("ix_claims_case_type_status", "claims", ["case_id", "claim_type", "status"])
    op.create_table(
        "claim_evidence",
        _id(),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id"), nullable=False),
        sa.Column("source_fragment_id", sa.String(36), sa.ForeignKey("source_fragments.id"), nullable=False),
        sa.Column("evidence_role", sa.String(24), nullable=False),
        sa.UniqueConstraint("claim_id", "source_fragment_id", "evidence_role", name="uq_claim_evidence"),
    )
    op.create_table(
        "artifacts",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("artifact_type", sa.String(48), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("current_revision_id", sa.String(36)),
        sa.Column("approved_revision_id", sa.String(36)),
        sa.Column("potentially_stale", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_artifacts_case_type_status", "artifacts", ["case_id", "artifact_type", "status"])
    op.create_table(
        "artifact_revisions",
        _id(),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("base_revision_id", sa.String(36)),
        sa.Column("schema_version", sa.String(48), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("digest", sa.String(80), nullable=False),
        sa.Column("digest_algorithm", sa.String(32), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
        sa.UniqueConstraint("artifact_id", "revision_no", name="uq_artifact_revision_no"),
        sa.UniqueConstraint("artifact_id", "digest", name="uq_artifact_revision_digest"),
    )
    op.create_index("ix_artifact_revisions_artifact_id", "artifact_revisions", ["artifact_id"])
    op.create_table(
        "revision_claims",
        _id(),
        sa.Column("revision_id", sa.String(36), sa.ForeignKey("artifact_revisions.id"), nullable=False),
        sa.Column("claim_id", sa.String(36), sa.ForeignKey("claims.id"), nullable=False),
        sa.Column("usage_path", sa.String(255), nullable=False),
        sa.Column("usage_type", sa.String(32), nullable=False),
        sa.UniqueConstraint("revision_id", "claim_id", "usage_path", name="uq_revision_claim_path"),
    )
    op.create_table(
        "gaps",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id")),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id")),
        sa.Column("rule_id", sa.String(64), nullable=False),
        sa.Column("path", sa.String(255), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("owner_snapshot", sa.JSON()),
        sa.Column("next_step", sa.Text()),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index("ix_gaps_open", "gaps", ["case_id", "artifact_id", "severity", "status"])
    op.create_table(
        "conflicts",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id")),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id")),
        sa.Column("left_ref", sa.String(128), nullable=False),
        sa.Column("right_ref", sa.String(128), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("resolution_decision_id", sa.String(36)),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index("ix_conflicts_unresolved", "conflicts", ["case_id", "artifact_id", "severity", "status"])
    op.create_table(
        "decision_records",
        _id(),
        sa.Column("aggregate_type", sa.String(48), nullable=False),
        sa.Column("aggregate_id", sa.String(36), nullable=False),
        sa.Column("decision_type", sa.String(48), nullable=False),
        sa.Column("actor_json", sa.JSON(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("target_refs", sa.JSON(), nullable=False),
        sa.Column("before_digest", sa.String(80)),
        sa.Column("after_digest", sa.String(80)),
        sa.Column("idempotency_key", sa.String(64)),
        _created_at(),
    )
    op.create_index("ix_decision_records_aggregate_id", "decision_records", ["aggregate_id"])
    op.create_table(
        "external_object_links",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id")),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id")),
        sa.Column("system", sa.String(32), nullable=False),
        sa.Column("object_type", sa.String(32), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("snapshot_version", sa.Integer(), nullable=False),
        sa.Column("snapshot_digest", sa.String(80), nullable=False),
        sa.Column("display_snapshot", sa.JSON(), nullable=False),
        sa.Column("access_checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("system", "object_type", "external_id", "active", name="uq_external_active_link"),
    )
    op.create_table(
        "proposed_diffs",
        _id(),
        sa.Column("target_system", sa.String(32), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("target_link_id", sa.String(36), sa.ForeignKey("external_object_links.id")),
        sa.Column("source_revision_id", sa.String(36), sa.ForeignKey("artifact_revisions.id"), nullable=False),
        sa.Column("source_revision_digest", sa.String(80), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("base_digest", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("rebased_from_id", sa.String(36), sa.ForeignKey("proposed_diffs.id")),
    )
    op.create_index("ix_diffs_target_status", "proposed_diffs", ["target_type", "target_id", "status"])
    op.create_table(
        "diff_operations",
        _id(),
        sa.Column("diff_id", sa.String(36), sa.ForeignKey("proposed_diffs.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("op", sa.String(16), nullable=False),
        sa.Column("path", sa.String(255), nullable=False),
        sa.Column("old_value_hash", sa.String(80)),
        sa.Column("proposed_value", sa.JSON()),
        sa.Column("claim_refs", sa.JSON(), nullable=False),
        sa.Column("evidence_refs", sa.JSON(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("risk", sa.String(24), nullable=False),
        sa.Column("decision_status", sa.String(24), nullable=False),
        sa.Column("decision_record_id", sa.String(36), sa.ForeignKey("decision_records.id")),
        sa.UniqueConstraint("diff_id", "ordinal", name="uq_diff_operation_ordinal"),
    )
    op.create_index("ix_diff_operations_diff_id", "diff_operations", ["diff_id"])
    op.create_table(
        "messages",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("actor_type", sa.String(32), nullable=False),
        sa.Column("actor_id", sa.String(64)),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("body_digest", sa.String(80), nullable=False),
        sa.Column("message_id", sa.String(64), nullable=False),
        _created_at(),
        sa.UniqueConstraint("case_id", "message_id", name="uq_case_message_id"),
    )
    op.create_index("ix_messages_case_id", "messages", ["case_id"])
    op.create_table(
        "agent_runs",
        _id(),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("need_cases.id"), nullable=False),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("artifacts.id")),
        sa.Column("revision_id", sa.String(36)),
        sa.Column("message_id", sa.String(64), nullable=False),
        sa.Column("input_revision_digest", sa.String(80), nullable=False),
        sa.Column("mode", sa.String(48), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("prompt_version", sa.String(48), nullable=False),
        sa.Column("policy_version", sa.String(48), nullable=False),
        sa.Column("schema_version", sa.String(48), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("token_metadata", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("case_id", "message_id", "input_revision_digest", name="uq_agent_run_input"),
    )
    op.create_table(
        "review_gates",
        _id(),
        sa.Column("artifact_revision_id", sa.String(36), sa.ForeignKey("artifact_revisions.id"), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("reviewer_snapshot", sa.JSON()),
        sa.Column("findings_digest", sa.String(80)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("artifact_revision_id", "active", name="uq_review_gate_active"),
    )
    op.create_table(
        "audit_events",
        _id(),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("actor_json", sa.JSON(), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("aggregate_type", sa.String(48), nullable=False),
        sa.Column("aggregate_id", sa.String(36), nullable=False),
        sa.Column("aggregate_version", sa.Integer()),
        sa.Column("before_digest", sa.String(80)),
        sa.Column("after_digest", sa.String(80)),
        sa.Column("refs_json", sa.JSON(), nullable=False),
        sa.Column("origin", sa.String(24), nullable=False),
        sa.Column("guard_result", sa.String(24), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=False),
        _created_at(),
    )
    op.create_index("ix_audit_request", "audit_events", ["request_id"])
    op.create_index("ix_audit_trace", "audit_events", ["trace_id"])
    op.create_index("ix_audit_aggregate", "audit_events", ["aggregate_type", "aggregate_id", "created_at"])
    op.create_table(
        "idempotency_records",
        _id(),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("request_hash", sa.String(80), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("resource_ref", sa.String(128)),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("operation", "actor_id", "key", name="uq_idempotency_operation_actor_key"),
    )
    op.create_table(
        "outbox_events",
        _id(),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("aggregate_type", sa.String(48), nullable=False),
        sa.Column("aggregate_id", sa.String(36), nullable=False),
        sa.Column("aggregate_version", sa.Integer(), nullable=False),
        sa.Column("payload_min", sa.JSON(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("dead_lettered_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(64)),
    )
    op.create_index("ix_outbox_pending", "outbox_events", ["processed_at", "dead_lettered_at", "available_at"])


def downgrade() -> None:
    for table in (
        "outbox_events",
        "idempotency_records",
        "audit_events",
        "review_gates",
        "agent_runs",
        "messages",
        "diff_operations",
        "proposed_diffs",
        "external_object_links",
        "decision_records",
        "conflicts",
        "gaps",
        "revision_claims",
        "artifact_revisions",
        "artifacts",
        "claim_evidence",
        "claims",
        "source_fragments",
        "source_artifacts",
        "case_participants",
        "case_revisions",
        "need_cases",
    ):
        op.drop_table(table)
