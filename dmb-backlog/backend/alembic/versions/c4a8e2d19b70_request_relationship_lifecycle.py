"""Request follow-up ownership and next action. No reference data changes."""
from alembic import op
import sqlalchemy as sa

revision = 'c4a8e2d19b70'
down_revision = 'f9b5d3e72a64'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('requirement_requests', sa.Column('coordinator_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('requirement_requests', sa.Column('next_action', sa.String(500), nullable=True))
    op.add_column('requirement_requests', sa.Column('next_action_due', sa.Date(), nullable=True))
    op.create_index('ix_requirement_requests_coordinator_id', 'requirement_requests', ['coordinator_id'])
    op.create_index('ix_requirement_requests_next_action_due', 'requirement_requests', ['next_action_due'])


def downgrade():
    raise RuntimeError('Preserve request follow-up history; destructive downgrade is disabled')
