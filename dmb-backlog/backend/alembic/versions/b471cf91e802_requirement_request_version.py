"""add optimistic-lock version to requirement requests

Revision ID: b471cf91e802
Revises: 3a886fb49c17
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b471cf91e802"
down_revision: Union[str, None] = "3a886fb49c17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requirement_requests",
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.alter_column("requirement_requests", "version", server_default=None)


def downgrade() -> None:
    op.drop_column("requirement_requests", "version")
