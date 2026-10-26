"""Add structured snapshots for the team weekly report."""
from alembic import op
import sqlalchemy as sa


revision = "e3b7c9d1f204"
down_revision = "d2f4a6c8e013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "task_reporting_statuses",
        sa.Column("weekly_payload", sa.JSON(), nullable=True),
    )
    op.add_column(
        "task_reporting_statuses",
        sa.Column("progress_snapshot", sa.Integer(), nullable=True),
    )
    op.add_column(
        "task_reporting_statuses",
        sa.Column("task_status_snapshot", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "task_reporting_status_revisions",
        sa.Column("old_weekly_payload", sa.JSON(), nullable=True),
    )
    op.add_column(
        "task_reporting_status_revisions",
        sa.Column("new_weekly_payload", sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_column("task_reporting_status_revisions", "new_weekly_payload")
    op.drop_column("task_reporting_status_revisions", "old_weekly_payload")
    op.drop_column("task_reporting_statuses", "task_status_snapshot")
    op.drop_column("task_reporting_statuses", "progress_snapshot")
    op.drop_column("task_reporting_statuses", "weekly_payload")
