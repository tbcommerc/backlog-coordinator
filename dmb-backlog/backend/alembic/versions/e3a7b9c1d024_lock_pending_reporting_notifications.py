"""Keep pending reporting notifications unread until their action is complete.

This migration repairs ordinary notification inbox rows only. It does not touch
users, roles, teams, role assignments, or reference data.
"""
from alembic import op
import sqlalchemy as sa


revision = "e3a7b9c1d024"
down_revision = "e3b7c9d1f204"
branch_labels = None
depends_on = None


def upgrade():
    notifications = sa.table(
        "notifications",
        sa.column("category", sa.String()),
        sa.column("is_read", sa.Boolean()),
        sa.column("read_at", sa.DateTime()),
        sa.column("is_resolved", sa.Boolean()),
    )
    op.execute(
        notifications.update().where(
            notifications.c.category == "reporting",
            notifications.c.is_resolved.is_(False),
        ).values(is_read=False, read_at=None)
    )


def downgrade():
    # The previous read state cannot be reconstructed safely.
    pass
