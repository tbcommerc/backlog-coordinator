"""normalize effort cost units and cost/value ratio

Revision ID: d4a2f19c7b80
Revises: c7d9e2a41f30
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4a2f19c7b80"
down_revision: Union[str, None] = "c7d9e2a41f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    tasks = sa.table(
        "tasks",
        sa.column("id", sa.Integer()),
        sa.column("effort_rub", sa.Numeric(18, 2)),
        sa.column("financial_effect", sa.Numeric(18, 2)),
        sa.column("cv", sa.Float()),
    )

    rows = bind.execute(sa.select(
        tasks.c.id,
        tasks.c.effort_rub,
        tasks.c.financial_effect,
    )).mappings().all()

    for row in rows:
        raw_cost = row["effort_rub"]
        cost = float(raw_cost) if raw_cost is not None else None
        value_mln = float(row["financial_effect"]) if row["financial_effect"] is not None else None

        # Historical rows used million RUB despite the column contract being RUB.
        # A workday costs at least thousands of RUB, so positive sub-1000 values
        # are the legacy million-RUB representation discovered in the dataset.
        if cost is not None and 0 < cost < 1000:
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
    # Unit normalization is intentionally not reversed: after the upgrade every
    # row follows the documented RUB contract and new rows use the same unit.
    pass
