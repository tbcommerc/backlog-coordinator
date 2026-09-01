"""multi-user hardening for reports, audit and outbox

Revision ID: e4c19b7a2d65
Revises: d9134f28a6bc
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4c19b7a2d65"
down_revision: Union[str, None] = "d9134f28a6bc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.add_column(
        "reports",
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "event_outbox",
        sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_event_outbox_dead_lettered_at",
        "event_outbox",
        ["dead_lettered_at"],
    )
    op.add_column(
        "audit_log",
        sa.Column("request_id", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_audit_log_request_id", "audit_log", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_request_id", table_name="audit_log")
    op.drop_column("audit_log", "request_id")
    op.drop_index("ix_event_outbox_dead_lettered_at", table_name="event_outbox")
    op.drop_column("event_outbox", "dead_lettered_at")
    op.drop_column("reports", "version")
    op.drop_column("reports", "updated_at")
