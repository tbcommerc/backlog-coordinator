"""Allow metrics without a reporting schedule; preserve all existing rows."""
from alembic import op

revision = 'e7c012d83f41'
down_revision = 'd6b901c72e30'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_kr_period_cadence', 'kr_periods', type_='check')
    op.create_check_constraint('ck_kr_period_cadence', 'kr_periods',
                               "cadence IN ('none','daily','weekly','monthly','quarterly','interval')")


def downgrade():
    raise RuntimeError('Use a compatible application rollback; manual schedules and history must be retained')
