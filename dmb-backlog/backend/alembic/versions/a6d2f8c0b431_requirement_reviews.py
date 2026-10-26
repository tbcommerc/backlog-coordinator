"""Independent human review of immutable business requirement revisions.

DDL only; no users, roles, teams, dictionaries or existing business rows change.
"""
from alembic import op
import sqlalchemy as sa

revision = "a6d2f8c0b431"
down_revision = "f4c8d0e2a135"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "requirement_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("artifact_id", sa.String(128), nullable=False),
        sa.Column("active_artifact_id", sa.String(128), nullable=True),
        sa.Column("artifact_revision", sa.Integer(), nullable=False),
        sa.Column("artifact_fingerprint", sa.String(71), nullable=False),
        sa.Column("artifact_snapshot", sa.JSON(), nullable=False),
        sa.Column("review_report", sa.JSON(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("session_id", sa.String(128), nullable=False),
        sa.Column("creator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=True),
        sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("source_request_author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("target_type", sa.String(20), nullable=True),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("source_metadata", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("submission_hash", sa.String(71), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("active_artifact_id", name="uq_requirement_review_active_artifact"),
        sa.UniqueConstraint("creator_id", "idempotency_key", name="uq_requirement_review_submission_key"),
        sa.CheckConstraint("status IN ('submitted', 'returned', 'approved', 'withdrawn')", name="ck_requirement_review_status"),
        sa.CheckConstraint("artifact_revision > 0 AND version > 0", name="ck_requirement_review_versions"),
        sa.CheckConstraint("(status = 'submitted' AND active_artifact_id IS NOT NULL AND active_artifact_id = artifact_id) OR (status <> 'submitted' AND active_artifact_id IS NULL)", name="ck_requirement_review_active"),
        sa.CheckConstraint("(target_type IS NULL AND target_id IS NULL) OR (target_type IS NOT NULL AND target_type IN ('task', 'request') AND target_id IS NOT NULL)", name="ck_requirement_review_target"),
    )
    for name in ("id", "artifact_id", "creator_id", "team_id", "reviewer_id", "status"):
        op.create_index(f"ix_requirement_reviews_{name}", "requirement_reviews", [name])
    op.create_index("ix_requirement_reviews_target", "requirement_reviews", ["target_type", "target_id"])


def downgrade():
    op.drop_table("requirement_reviews")
