"""Explicit retry ancestry; nullable technical metadata, no product updates."""
from alembic import op
from sqlalchemy import Column, String, inspect

revision = '20261104_02'
down_revision = '20261104_01'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name']:column for column in inspect(op.get_bind()).get_columns('agent_runs')}
    if 'retry_of' in columns:
        column = columns['retry_of']
        if not isinstance(column['type'],String) or column['type'].length!=36 or not column['nullable']:
            raise RuntimeError('unexpected_retry_link_schema')
        return
    op.add_column('agent_runs',Column('retry_of',String(36),nullable=True))


def downgrade():
    raise RuntimeError('Use a verified compatible rollback; retry history is not discarded automatically')
