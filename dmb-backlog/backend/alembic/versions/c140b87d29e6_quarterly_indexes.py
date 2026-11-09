"""Index revision references for bounded lookups and temporary-data cleanup."""
from alembic import op

revision='c140b87d29e6'
down_revision='b0f345ab6274'
branch_labels=None
depends_on=None


def upgrade():
    for table,columns in {
        'kr_periods':['current_plan_revision_id','current_fact_revision_id','closure_revision_id'],
        'kr_period_fact_revisions':['source_measurement_id','previous_revision_id'],
        'kr_period_plan_revisions':['previous_revision_id'],
        'kr_period_closure_revisions':['plan_revision_id','fact_revision_id','previous_revision_id'],
        'kr_files':['measurement_id','period_id'],
        'kr_comments':['period_id'],
    }.items():
        for column in columns:op.create_index('ix_'+table+'_'+column,table,[column])


def downgrade():
    raise RuntimeError('Use compatible application rollback; retain quarterly schema')
