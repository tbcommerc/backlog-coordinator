"""Durable per-run meeting application receipts and acknowledgement outbox.

Revision ID: d251c98e30f7
Revises: c140b87d29e6
"""
from alembic import op
import sqlalchemy as sa

revision = "d251c98e30f7"
down_revision = "c140b87d29e6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("meeting_delivery_intents",
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("capture_id", sa.String(36), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON()),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("phase IN ('queued','unknown','resolved')", name="ck_meeting_intent_phase"))
    op.create_table("meeting_application_receipts",
        sa.Column("service_run_id", sa.String(36), primary_key=True),
        sa.Column("consumer_operation_id", sa.String(36), nullable=False),
        sa.Column("capture_id", sa.String(36), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("payload_hash", sa.String(64)),
        sa.Column("source_revision", sa.Integer()),
        sa.Column("applied_object_refs", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("committed_at", sa.DateTime(timezone=True)),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("ack_pending", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ack_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("decision IN ('pending','applied','discarded')", name="ck_meeting_receipt_decision"))
    op.create_index("ix_meeting_receipt_pending", "meeting_application_receipts", ["ack_pending", "updated_at"])
    # Existing pending acknowledgements must survive a user starting a new run.
    op.execute(sa.text("""INSERT INTO meeting_application_receipts
        (service_run_id,consumer_operation_id,capture_id,owner_id,source_hash,
         decision,ack_pending,created_at,updated_at)
        SELECT analysis_service_run_id,analysis_run_id,id,owner_id,'legacy-unavailable',
         CASE WHEN analysis_status='completed' THEN 'applied' ELSE 'discarded' END,
         true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        FROM meeting_captures WHERE analysis_backend='meeting-analyzer'
          AND analysis_ack_pending=true AND analysis_service_run_id IS NOT NULL
          AND analysis_run_id IS NOT NULL"""))


def downgrade():
    raise RuntimeError("Use a compatible rollback; application receipts must be retained")
