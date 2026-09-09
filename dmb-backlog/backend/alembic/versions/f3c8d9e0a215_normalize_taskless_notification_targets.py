"""Normalize unrecoverable taskless legacy notification targets."""
from alembic import op
import sqlalchemy as sa


revision = "f3c8d9e0a215"
down_revision = "f2b7c8d9e104"
branch_labels = None
depends_on = None


def upgrade():
    notifications = sa.table(
        "notifications",
        sa.column("task_id", sa.Integer()),
        sa.column("category", sa.String()),
        sa.column("action_url", sa.String()),
    )
    op.execute(
        notifications.update().where(
            notifications.c.task_id.is_(None),
            notifications.c.category.in_(("assignment", "mention", "comment")),
            notifications.c.action_url.in_(("#/backlog", "/backlog", "#/backlog/", "/backlog/")),
        ).values(action_url="#/notifications")
    )


def downgrade():
    # The exact original task context does not exist, so restoring a false target
    # would intentionally reintroduce the broken navigation.
    pass
