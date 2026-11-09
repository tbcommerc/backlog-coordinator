"""Task-owned schedules and milestones; no reference data changes."""
from alembic import op
import sqlalchemy as sa

revision = 'b0f345ab6274'
down_revision = 'a9e234fa5163'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('project_task_plans',
        sa.Column('task_id', sa.Integer(), sa.ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('starts_on', sa.Date()), sa.Column('ends_on', sa.Date()),
        sa.Column('baseline_start', sa.Date()), sa.Column('baseline_end', sa.Date()),
        sa.Column('is_milestone', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('expected_result', sa.Text(), nullable=False, server_default=''),
        sa.Column('change_reason', sa.Text(), nullable=False, server_default=''),
        sa.CheckConstraint('(starts_on IS NULL AND ends_on IS NULL) OR (starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_on <= ends_on)', name='ck_project_plan_dates'))


def downgrade():
    op.drop_table('project_task_plans')
