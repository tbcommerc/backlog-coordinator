"""add progress column required by the Tag model

Revision ID: c7d9e2a41f30
Revises: b2f8d5c03a21
Create Date: 2026-08-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d9e2a41f30"
down_revision: Union[str, None] = "b2f8d5c03a21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("progress", sa.Integer(), nullable=True, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("tags", "progress")
