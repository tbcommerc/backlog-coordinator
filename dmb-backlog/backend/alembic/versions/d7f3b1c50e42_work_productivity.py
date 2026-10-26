"""Priority, versioned checklist and personal work templates."""
from alembic import op
import sqlalchemy as sa

revision = 'd7f3b1c50e42'
down_revision = 'c6e2a9b40d31'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_tasks', sa.Column('priority', sa.String(10), nullable=False, server_default='normal'))
    op.add_column('work_tasks', sa.Column('checklist', sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.create_check_constraint('ck_work_priority', 'work_tasks', "priority IN ('low','normal','high','urgent')")
    op.create_index('ix_work_tasks_priority', 'work_tasks', ['priority'])
    op.create_table('work_task_templates',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('version > 0', name='ck_work_template_version'))
    op.create_index('ix_work_task_templates_owner_id', 'work_task_templates', ['owner_id'])


def downgrade():
    raise RuntimeError('Preserve task checklists and personal templates; destructive downgrade is disabled')
