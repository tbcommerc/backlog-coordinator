"""Remove the retired work-task obstacle attribute."""
from alembic import op
import sqlalchemy as sa

revision = 'a9e234fa5163'
down_revision = 'f8d123e94052'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('work_tasks', 'blocked_reason')


def downgrade():
    # Removed values cannot be reconstructed from a schema downgrade.
    op.add_column('work_tasks', sa.Column('blocked_reason', sa.Text(), nullable=True))
