"""Meeting review workspaces and confirmed actions; DDL only."""
from alembic import op
import sqlalchemy as sa

revision = "b7e3a9d1c542"
down_revision = "a6d2f8c0b431"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("meeting_captures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("meeting_date", sa.Date),
        sa.Column("transcript", sa.Text, nullable=False),
        sa.Column("items", sa.JSON, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_meeting_captures_owner_id", "meeting_captures", ["owner_id"])
    op.create_table("meeting_actions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("capture_id", sa.String(36), sa.ForeignKey("meeting_captures.id"), nullable=False),
        sa.Column("item_id", sa.String(64), nullable=False),
        sa.Column("task_id", sa.Integer, sa.ForeignKey("tasks.id")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("owner_text", sa.String(255), nullable=False),
        sa.Column("due_date", sa.Date),
        sa.Column("due_text", sa.String(255), nullable=False),
        sa.Column("quote", sa.Text, nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("capture_id", "item_id", name="uq_meeting_action_item"))
    op.create_index("ix_meeting_actions_capture_id", "meeting_actions", ["capture_id"])
    op.create_index("ix_meeting_actions_task_id", "meeting_actions", ["task_id"])


def downgrade():
    op.drop_table("meeting_actions")
    op.drop_table("meeting_captures")
