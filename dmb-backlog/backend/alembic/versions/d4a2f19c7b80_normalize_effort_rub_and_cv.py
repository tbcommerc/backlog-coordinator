"""normalize effort cost units and cost/value ratio

Revision ID: d4a2f19c7b80
Revises: c7d9e2a41f30
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


revision: str = "d4a2f19c7b80"
down_revision: Union[str, None] = "c7d9e2a41f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError("d4a2f19c7b80 is online-only because it records row-level provenance")
    bind = op.get_bind()
    tasks = sa.table(
        "tasks",
        sa.column("id", sa.Integer()),
        sa.column("effort_rub", sa.Numeric(18, 2)),
        sa.column("financial_effect", sa.Numeric(18, 2)),
        sa.column("cv", sa.Float()),
    )

    op.create_table(
        "effort_rub_normalization_audit",
        sa.Column("task_id", sa.Integer(), primary_key=True),
        sa.Column("old_effort_rub", sa.Numeric(18, 2), nullable=True),
        sa.Column("old_cv", sa.Float(), nullable=True),
    )
    audit = sa.table(
        "effort_rub_normalization_audit",
        sa.column("task_id", sa.Integer()),
        sa.column("old_effort_rub", sa.Numeric(18, 2)),
        sa.column("old_cv", sa.Float()),
    )
    raw_ids = context.get_x_argument(as_dictionary=True).get("effort_rub_legacy_ids", "")
    try:
        approved_ids = sorted({int(value) for value in raw_ids.split(",") if value.strip()})
    except ValueError as exc:
        raise RuntimeError("effort_rub_legacy_ids must be a comma-separated list of integer task IDs") from exc

    rows = bind.execute(sa.select(
        tasks.c.id,
        tasks.c.effort_rub,
        tasks.c.financial_effect,
        tasks.c.cv,
    )).mappings().all()

    for row in rows:
        raw_cost = row["effort_rub"]
        cost = float(raw_cost) if raw_cost is not None else None
        value_mln = float(row["financial_effect"]) if row["financial_effect"] is not None else None

        if row["id"] in approved_ids and cost is not None:
            bind.execute(audit.insert().values(
                task_id=row["id"], old_effort_rub=raw_cost, old_cv=row["cv"]
            ))
            cost = round(cost * 1_000_000, 2)

        cv = None
        if cost is not None and value_mln is not None and cost > 0 and value_mln > 0:
            cv = round(cost / (value_mln * 1_000_000), 4)

        bind.execute(
            tasks.update().where(tasks.c.id == row["id"]).values(
                effort_rub=cost,
                cv=cv,
            )
        )


def downgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError("d4a2f19c7b80 is online-only because it restores row-level provenance")
    bind = op.get_bind()
    audit = sa.table(
        "effort_rub_normalization_audit",
        sa.column("task_id", sa.Integer()),
        sa.column("old_effort_rub", sa.Numeric(18, 2)),
        sa.column("old_cv", sa.Float()),
    )
    tasks = sa.table(
        "tasks",
        sa.column("id", sa.Integer()),
        sa.column("effort_rub", sa.Numeric(18, 2)),
        sa.column("cv", sa.Float()),
    )
    for row in bind.execute(sa.select(audit)).mappings():
        bind.execute(tasks.update().where(tasks.c.id == row["task_id"]).values(
            effort_rub=row["old_effort_rub"], cv=row["old_cv"]
        ))
    op.drop_table("effort_rub_normalization_audit")
