"""Harden active notification state and repair legacy deep links.

This migration changes ordinary inbox rows only. It does not touch users,
roles, teams, assignments of roles, or reference data.
"""
from alembic import op
import sqlalchemy as sa


revision = "f2b7c8d9e104"
down_revision = "a9246d1c7e30"
branch_labels = None
depends_on = None


def upgrade():
    notifications = sa.table(
        "notifications",
        sa.column("task_id", sa.Integer()),
        sa.column("category", sa.String()),
        sa.column("action_url", sa.String()),
        sa.column("is_read", sa.Boolean()),
        sa.column("read_at", sa.DateTime()),
        sa.column("is_dismissed", sa.Boolean()),
        sa.column("is_resolved", sa.Boolean()),
        sa.column("resolved_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
    )
    generic_target = sa.or_(
        notifications.c.action_url.is_(None),
        notifications.c.action_url.in_(("#/backlog", "/backlog", "#/backlog/", "/backlog/")),
    )
    task_target = sa.literal("#/backlog?task=") + sa.cast(notifications.c.task_id, sa.String())

    op.execute(
        notifications.update().where(
            notifications.c.task_id.isnot(None),
            notifications.c.category == "assignment",
            generic_target,
        ).values(action_url=task_target)
    )
    op.execute(
        notifications.update().where(
            notifications.c.task_id.isnot(None),
            notifications.c.category.in_(("comment", "mention")),
            generic_target,
        ).values(action_url=task_target + sa.literal("&tab=com"))
    )
    op.execute(
        notifications.update().where(
            notifications.c.task_id.isnot(None),
            notifications.c.category == "reporting",
            generic_target,
        ).values(action_url=task_target + sa.literal("&tab=rep"))
    )
    op.execute(
        notifications.update().where(
            notifications.c.category == "reporting",
            notifications.c.is_resolved.is_(False),
            notifications.c.is_dismissed.is_(True),
        ).values(is_dismissed=False)
    )
    op.execute(
        notifications.update().where(
            notifications.c.category.in_(("assignment", "reporting", "mention", "comment")),
            notifications.c.is_resolved.is_(True),
            notifications.c.is_read.is_(False),
        ).values(
            is_read=True,
            read_at=sa.func.coalesce(notifications.c.resolved_at, notifications.c.created_at),
        )
    )


def downgrade():
    # The repair is intentionally irreversible: the previous generic targets and
    # contradictory inbox states cannot be reconstructed without reintroducing bugs.
    pass
