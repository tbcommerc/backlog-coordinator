"""Expand meeting delivery metadata without altering historical runs.

Revision ID: d6b901c72e30
Revises: c4a8e2d19b70
"""
from alembic import op
import sqlalchemy as sa

revision = "d6b901c72e30"
down_revision = "c4a8e2d19b70"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meeting_captures", sa.Column("analysis_backend", sa.String(32), nullable=False, server_default="legacy"))
    op.add_column("meeting_captures", sa.Column("analysis_service_run_id", sa.String(36), nullable=True))
    op.add_column("meeting_captures", sa.Column("analysis_ack_pending", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    raise RuntimeError("Use a compatible application rollback; delivery history must be retained")
