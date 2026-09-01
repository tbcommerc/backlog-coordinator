"""add OpenTelemetry trace id to audit log

Revision ID: f8a0c3d1e942
Revises: e4c19b7a2d65
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f8a0c3d1e942"
down_revision: Union[str, None] = "e4c19b7a2d65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_log", sa.Column("trace_id", sa.String(length=32), nullable=True))
    op.create_index("ix_audit_log_trace_id", "audit_log", ["trace_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_trace_id", table_name="audit_log")
    op.drop_column("audit_log", "trace_id")
