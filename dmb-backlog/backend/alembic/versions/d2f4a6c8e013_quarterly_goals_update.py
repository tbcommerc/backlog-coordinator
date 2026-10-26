"""Add delayed start and fact freshness for quarterly goals."""
from alembic import op
import sqlalchemy as sa


revision = "d2f4a6c8e013"
down_revision = "c1a9e8b7d602"
branch_labels = None
depends_on = None


def upgrade():
    start_shifts = op.create_table(
        "start_shifts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("month_number", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("month_number between 1 and 3", name="ck_start_shifts_month_number"),
    )
    op.bulk_insert(start_shifts, [
        {"code": "M1", "name": "С первого месяца квартала", "month_number": 1, "sort_order": 1},
        {"code": "M2", "name": "Со второго месяца квартала", "month_number": 2, "sort_order": 2},
        {"code": "M3", "name": "С третьего месяца квартала", "month_number": 3, "sort_order": 3},
    ])
    op.add_column("tasks", sa.Column("start_shift_id", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("progress_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_tasks_start_shift",
        "tasks",
        "start_shifts",
        ["start_shift_id"],
        ["id"],
    )
    op.create_index("ix_tasks_start_shift_id", "tasks", ["start_shift_id"])


def downgrade():
    op.drop_index("ix_tasks_start_shift_id", table_name="tasks")
    op.drop_constraint("fk_tasks_start_shift", "tasks", type_="foreignkey")
    op.drop_column("tasks", "progress_updated_at")
    op.drop_column("tasks", "start_shift_id")
    op.drop_table("start_shifts")
