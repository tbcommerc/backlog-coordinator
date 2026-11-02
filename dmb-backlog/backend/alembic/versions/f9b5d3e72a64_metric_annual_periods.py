"""Restore known annual periods for migrated metric KR passports."""
from alembic import op
import sqlalchemy as sa
from datetime import date
import re
revision='f9b5d3e72a64'
down_revision='e8a4c2d61f53'
branch_labels=None
depends_on=None

def upgrade():
    bind=op.get_bind()
    meta=sa.MetaData()
    metrics=sa.Table('kr_metrics',meta,autoload_with=bind)
    periods=sa.Table('kr_periods',meta,autoload_with=bind)
    deadlines=sa.Table('deadlines',meta,autoload_with=bind)
    history=sa.Table('kr_history',meta,autoload_with=bind)
    query=sa.select(metrics).where(metrics.c.legacy_task_id.isnot(None),
        ~sa.exists().where(periods.c.metric_id==metrics.c.id)).with_for_update()
    for row in bind.execute(query).mappings():
        original=row['legacy_snapshot'] or {}
        deadline=bind.execute(sa.select(deadlines.c.code).where(deadlines.c.id==original.get('deadline_id'))).scalar()
        year=re.fullmatch(r'(?:Y|YEAR)[_ -]?(20\d{2})',deadline or '',re.I)
        if not year:continue
        y=int(year[1])
        pid=bind.execute(periods.insert().values(metric_id=row['id'],label=f'{y} год',
            start_date=date(y,1,1),end_date=date(y,12,31),state='draft',
            target=original.get('metric_kr_plan'),legacy_fact=original.get('metric_kr_fact'),
            cadence='weekly',weight=original.get('assessment_weight'),forecast=original.get('completion_forecast'),
            unit_snapshot=original.get('metric_kr_unit') or '')).inserted_primary_key[0]
        bind.execute(history.insert().values(metric_id=row['id'],period_id=pid,action='migrated',
            before={},after={'period_id':pid,'year':y},reason='Годовой период из исходного срока; база и график требуют уточнения'))
        bind.execute(metrics.update().where(metrics.c.id==row['id']).values(version=row['version']+1))

def downgrade():
    raise RuntimeError('Annual metric periods must be preserved')

