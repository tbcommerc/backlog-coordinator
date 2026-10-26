"""Hide status reminders for reporting meetings already marked as held.

This migration updates ordinary notification inbox rows only. It does not touch
users, roles, teams, role assignments, or reference data.
"""
from alembic import op
import sqlalchemy as sa


revision = "f4c8d0e2a135"
down_revision = "e3a7b9c1d024"
branch_labels = None
depends_on = None


def upgrade():
    meetings = sa.table(
        "reporting_meetings",
        sa.column("id", sa.Integer()),
        sa.column("state", sa.String()),
    )
    notifications = sa.table(
        "notifications",
        sa.column("group_key", sa.String()),
        sa.column("is_dismissed", sa.Boolean()),
    )
    held_group_keys = sa.select(
        sa.literal("reporting_fill_") + sa.cast(meetings.c.id, sa.String())
    ).where(meetings.c.state == "held")
    op.execute(
        notifications.update().where(
            notifications.c.group_key.in_(held_group_keys)
        ).values(is_dismissed=True)
    )


def downgrade():
    # The previous visibility state cannot be reconstructed safely.
    pass
