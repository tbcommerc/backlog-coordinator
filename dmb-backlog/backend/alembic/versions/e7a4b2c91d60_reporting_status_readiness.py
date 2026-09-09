"""add explicit reporting status readiness

Revision ID: e7a4b2c91d60
Revises: f3c8d9e0a215
Create Date: 2026-09-07
"""
from alembic import op
import sqlalchemy as sa

revision = "e7a4b2c91d60"
down_revision = "f3c8d9e0a215"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("task_reporting_statuses", sa.Column("is_ready", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE task_reporting_statuses SET is_ready = true WHERE NULLIF(BTRIM(status_text), '') IS NOT NULL")
    op.alter_column("task_reporting_statuses", "is_ready", server_default=None)


def downgrade():
    op.drop_column("task_reporting_statuses", "is_ready")
