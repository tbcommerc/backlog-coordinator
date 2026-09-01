"""restore legacy story progress for lossless PostgreSQL migration

Revision ID: a1e7c4b92f10
Revises: f8a0c3d1e942
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1e7c4b92f10"
down_revision: Union[str, Sequence[str], None] = "f8a0c3d1e942"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stories",
        sa.Column("progress", sa.Integer(), nullable=True, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("stories", "progress")
