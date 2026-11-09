"""Scope technical idempotency keys to their operation; preserve history."""
from alembic import op

revision = '20261104_03'
down_revision = '20261104_02'
branch_labels = None
depends_on = None


def upgrade():
    from dmb_agent_contracts.run_migration import migrate_operation_scope
    migrate_operation_scope(op.get_bind())


def downgrade():
    raise RuntimeError('Use verified compatible rollback; operation keys may overlap')
