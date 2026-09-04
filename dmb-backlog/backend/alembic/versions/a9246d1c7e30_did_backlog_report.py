"""DID backlog report: schema only, no reference-data seeding or backfill."""
from alembic import op
import sqlalchemy as sa

revision = "a9246d1c7e30"
down_revision = "d4a2f19c7b80"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("did_client_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("tasks", sa.Column("did_client_group_id", sa.Integer()))
    op.create_foreign_key("fk_tasks_did_client_group", "tasks", "did_client_groups", ["did_client_group_id"], ["id"])
    op.create_table("user_report_prefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("report_key", sa.String(50), nullable=False),
        sa.Column("prefs", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "report_key", name="uq_user_report_prefs"))


def downgrade():
    op.drop_table("user_report_prefs")
    op.drop_constraint("fk_tasks_did_client_group", "tasks", type_="foreignkey")
    op.drop_column("tasks", "did_client_group_id")
    op.drop_table("did_client_groups")
