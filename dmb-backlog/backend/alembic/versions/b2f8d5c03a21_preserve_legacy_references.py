"""preserve orphaned legacy references during SQLite migration

Revision ID: b2f8d5c03a21
Revises: a1e7c4b92f10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2f8d5c03a21"
down_revision: Union[str, Sequence[str], None] = "a1e7c4b92f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table_name in ("audit_log", "task_comments", "task_history", "tasks"):
        op.add_column(table_name, sa.Column("legacy_references", sa.JSON(), nullable=True))
    op.alter_column("task_comments", "user_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("task_comments", "user_id", existing_type=sa.Integer(), nullable=False)
    for table_name in ("tasks", "task_history", "task_comments", "audit_log"):
        op.drop_column(table_name, "legacy_references")
