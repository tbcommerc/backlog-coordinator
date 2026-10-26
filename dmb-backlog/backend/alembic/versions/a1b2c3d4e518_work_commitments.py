"""Version accepted results independently from comments and other activity."""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e518'
down_revision = 'a1b2c3d4e517'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_tasks', sa.Column('result_revision', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('work_tasks', sa.Column('return_reason', sa.Text(), nullable=True))
    op.add_column('work_resolutions', sa.Column('confirmed_work_revisions', sa.JSON(), nullable=True))
    # Older confirmations have no result baseline and must be verified explicitly.
    # Never infer a human decision from the current status or backfill protected data.


def downgrade():
    raise RuntimeError('Preserve result confirmations; destructive downgrade is disabled')
