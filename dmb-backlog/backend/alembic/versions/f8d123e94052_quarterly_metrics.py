"""Add quarterly storage without reinterpreting legacy data."""
from alembic import op
import sqlalchemy as sa

revision = 'f8d123e94052'
down_revision = 'e7c012d83f41'
branch_labels = None
depends_on = None


def upgrade():
    for name, typ, default in [('model_version', sa.String(16), 'legacy_v1'), ('lifecycle_state', sa.String(16), 'draft'),
                               ('annual_aggregation', sa.String(10), 'none'), ('aggregation_scale', sa.Integer(), '100'),
                               ('display_precision', sa.Integer(), '2')]:
        op.add_column('kr_metrics', sa.Column(name, typ, nullable=False, server_default=default))
    op.add_column('kr_metrics', sa.Column('preferred_result_type', sa.String(16)))
    op.add_column('kr_metrics', sa.Column('default_direction', sa.String(10)))
    op.add_column('kr_periods', sa.Column('model_version', sa.String(16), nullable=False, server_default='legacy_v1'))
    for name in ['calendar_year', 'quarter', 'current_plan_revision_id', 'current_fact_revision_id', 'closure_revision_id']:
        op.add_column('kr_periods', sa.Column(name, sa.Integer()))
    op.add_column('kr_periods', sa.Column('result_type', sa.String(16)))
    op.create_unique_constraint('uq_kr_period_quarter', 'kr_periods', ['metric_id', 'calendar_year', 'quarter'])
    op.create_check_constraint('ck_kr_quarter_calendar', 'kr_periods',
        "model_version <> 'quarterly_v2' OR (calendar_year IS NOT NULL AND quarter BETWEEN 1 AND 4 AND calendar_year = EXTRACT(YEAR FROM start_date) AND start_date = make_date(calendar_year, quarter * 3 - 2, 1) AND end_date = (start_date + interval '3 months' - interval '1 day')::date)")
    for table in ['kr_comments', 'kr_files']:
        op.add_column(table, sa.Column('period_id', sa.Integer(), sa.ForeignKey('kr_periods.id')))
    op.create_table('kr_period_plan_revisions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('period_id', sa.Integer(), sa.ForeignKey('kr_periods.id'), nullable=False),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('previous_revision_id', sa.Integer(), sa.ForeignKey('kr_period_plan_revisions.id')),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('period_id', 'revision_no', name='uq_kr_plan_revision'))
    op.create_table('kr_period_fact_revisions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('period_id', sa.Integer(), sa.ForeignKey('kr_periods.id'), nullable=False),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('previous_revision_id', sa.Integer(), sa.ForeignKey('kr_period_fact_revisions.id')),
        sa.Column('value', sa.Numeric(30, 10), nullable=False),
        sa.Column('as_of_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('source', sa.Text(), nullable=False), sa.Column('comment', sa.Text(), nullable=False), sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('source_measurement_id', sa.Integer(), sa.ForeignKey('kr_measurements.id')),
        sa.Column('source_measurement_snapshot', sa.JSON()),
        sa.Column('numerator', sa.Numeric(30, 10)), sa.Column('denominator', sa.Numeric(30, 10)),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('period_id', 'revision_no', name='uq_kr_fact_revision'))
    op.create_table('kr_period_closure_revisions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('period_id', sa.Integer(), sa.ForeignKey('kr_periods.id'), nullable=False),
        sa.Column('plan_revision_id', sa.Integer(), sa.ForeignKey('kr_period_plan_revisions.id'), nullable=False),
        sa.Column('fact_revision_id', sa.Integer(), sa.ForeignKey('kr_period_fact_revisions.id'), nullable=False),
        sa.Column('previous_revision_id', sa.Integer(), sa.ForeignKey('kr_period_closure_revisions.id')),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False), sa.Column('comment', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_kr_period_closure_revisions_period_id', 'kr_period_closure_revisions', ['period_id'])
    op.create_table('kr_year_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('metric_id', sa.Integer(), sa.ForeignKey('kr_metrics.id'), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False), sa.Column('expected_quarters', sa.JSON(), nullable=False),
        sa.Column('exclusions', sa.JSON(), nullable=False), sa.Column('aggregation', sa.String(10), nullable=False),
        sa.Column('scale', sa.Integer(), nullable=False), sa.UniqueConstraint('metric_id', 'year', name='uq_kr_year_settings'))
    op.create_table('kr_pause_intervals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('metric_id', sa.Integer(), sa.ForeignKey('kr_metrics.id'), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False), sa.Column('end_date', sa.Date()),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False), sa.Column('reason', sa.Text(), nullable=False))
    op.create_index('ix_kr_pause_intervals_metric_id', 'kr_pause_intervals', ['metric_id'])
    op.create_index('ix_kr_history_metric_created', 'kr_history', ['metric_id', 'created_at', 'id'])
    for field, table in [('current_plan_revision_id', 'kr_period_plan_revisions'), ('current_fact_revision_id', 'kr_period_fact_revisions'), ('closure_revision_id', 'kr_period_closure_revisions')]:
        op.create_foreign_key('fk_kr_period_'+field, 'kr_periods', table, [field], ['id'])


def downgrade():
    raise RuntimeError('Destructive downgrade prohibited: use compatible rollback retaining quarterly schema and revisions')
