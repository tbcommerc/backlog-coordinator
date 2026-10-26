"""Backlog Assistant integration ledger only; no protected or business data changes."""
from alembic import op
import sqlalchemy as sa

revision = "e8f1b2c3d405"
down_revision = "d9a5c1f3e764"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("backlog_assistant_integration",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("subject", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("expires", sa.Float(), nullable=False))
    for column in ("kind", "subject", "expires"):
        op.create_index("ix_backlog_assistant_integration_"+column, "backlog_assistant_integration", [column])


def downgrade():
    op.drop_table("backlog_assistant_integration")
