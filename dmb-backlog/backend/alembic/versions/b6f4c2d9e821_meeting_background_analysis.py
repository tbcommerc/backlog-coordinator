"""Durable meeting analysis state; DDL only, no protected data writes."""
from alembic import op
import sqlalchemy as sa

revision = "b6f4c2d9e821"
down_revision = "a1b2c3d4e517"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("meeting_captures", sa.Column("analysis_status", sa.String(16), nullable=False, server_default="idle"))
    op.add_column("meeting_captures", sa.Column("analysis_run_id", sa.String(36)))
    for name in ("analysis_requested_at", "analysis_started_at", "analysis_finished_at"):
        op.add_column("meeting_captures", sa.Column(name, sa.DateTime(timezone=True)))
    op.add_column("meeting_captures", sa.Column("analysis_error_code", sa.String(32)))
    op.create_index("ix_meeting_captures_analysis_status", "meeting_captures", ["analysis_status"])


def downgrade():
    op.drop_index("ix_meeting_captures_analysis_status", table_name="meeting_captures")
    for name in ("analysis_error_code", "analysis_finished_at", "analysis_started_at", "analysis_requested_at", "analysis_run_id", "analysis_status"):
        op.drop_column("meeting_captures", name)
