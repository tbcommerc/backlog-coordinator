"""add meeting-scoped directorate attention marker

Revision ID: b8d4e6f2a901
Revises: e7a4b2c91d60
Create Date: 2026-09-08
"""
from alembic import op
import sqlalchemy as sa


revision = "b8d4e6f2a901"
down_revision = "e7a4b2c91d60"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "task_reporting_statuses",
        sa.Column(
            "directorate_attention",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column(
        "task_reporting_statuses",
        "directorate_attention",
        server_default=None,
    )


def downgrade():
    op.drop_column("task_reporting_statuses", "directorate_attention")
