"""Allow a task with only a title, without changing existing assignments.

Revision ID: d453b20d51f9
Revises: d352a19c40e8
"""
from alembic import op
import sqlalchemy as sa

revision = "d453b20d51f9"
down_revision = "d352a19c40e8"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("tasks", "team_id", existing_type=sa.Integer(), nullable=True)


def downgrade():
    # An old schema cannot represent unassigned tasks. Never invent a team or
    # delete tasks to make a downgrade fit.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM tasks WHERE team_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Downgrade requires explicitly assigning teams to all unassigned tasks")
    op.alter_column("tasks", "team_id", existing_type=sa.Integer(), nullable=False)
