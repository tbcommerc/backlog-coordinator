"""SQL expressions for same-quarter predicates, counts and stable pagination."""
from sqlalchemy import and_, or_, case, select, literal, exists, text, Numeric
from metric_models import Metric, MetricPeriod as P
from metric_quarterly_models import FactRevision as F
from services.metric_rules import today


# Correlated schedule slots: anchor-relative calendar addition preserves month-end.
# No measured values are materialized by the registry predicate.
OVERDUE = text("""EXISTS (
 SELECT 1 FROM generate_series(0, 365) AS slot(i)
 CROSS JOIN LATERAL (SELECT CASE
   WHEN kr_periods.cadence = 'monthly' THEN (kr_periods.first_due_date + make_interval(months => i))::date
   WHEN kr_periods.cadence = 'quarterly' THEN (kr_periods.first_due_date + make_interval(months => i * 3))::date
   ELSE kr_periods.first_due_date + i * CASE kr_periods.cadence WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE kr_periods.interval_days END
 END AS due) d
 WHERE d.due < :business_today AND d.due <= kr_periods.end_date
 AND d.due > COALESCE((SELECT max(pr.end_date) FROM kr_pause_intervals pr WHERE pr.metric_id=kr_metrics.id),kr_periods.start_date - 1)
 AND NOT EXISTS (SELECT 1 FROM kr_pause_intervals pi WHERE pi.metric_id = kr_metrics.id
   AND pi.start_date <= d.due AND (pi.end_date IS NULL OR pi.end_date >= d.due))
 AND NOT EXISTS (SELECT 1 FROM kr_measurements mm WHERE mm.period_id = kr_periods.id
   AND mm.measured_on <= d.due AND mm.measured_on > CASE WHEN i = 0 THEN kr_periods.start_date - 1
   WHEN kr_periods.cadence = 'monthly' THEN (kr_periods.first_due_date + make_interval(months => i - 1))::date
   WHEN kr_periods.cadence = 'quarterly' THEN (kr_periods.first_due_date + make_interval(months => (i - 1) * 3))::date
   ELSE kr_periods.first_due_date + (i - 1) * CASE kr_periods.cadence WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 ELSE kr_periods.interval_days END END)
)""").bindparams(business_today=today())


def achieved():
    return case((P.result_type=='range',and_(F.value>=P.target,F.value<=P.upper)),(P.direction=='down',F.value<=P.target),else_=F.value>=P.target)


def progress():
    from sqlalchemy import func
    return case((P.result_type=='volume',F.value/func.nullif(P.target,0)*100),
                (P.result_type=='change',(F.value-P.baseline)/func.nullif(P.target-P.baseline,0)*100),else_=None)


def attention_conditions():
    at=today()
    return {
        'missing_fact':and_(P.state=='active',P.start_date<=at,P.current_fact_revision_id.is_(None)),
        'awaiting_close':and_(P.state=='active',P.end_date<at),
        'not_achieved':and_(P.state=='completed',F.id.isnot(None),~achieved()),
        'overdue':and_(Metric.lifecycle_state=='tracking',P.state=='active',P.start_date<=at,P.cadence!='none',OVERDUE.bindparams(business_today=at))}


def predicate(year,quarter,view,states,attention=None):
    at=today()
    clauses=[P.metric_id==Metric.id,P.model_version=='quarterly_v2',P.calendar_year==year]
    if view=='quarter':clauses.append(P.quarter==quarter)
    if states:clauses.append(P.state.in_(states))
    if attention:
        attention_clauses=attention_conditions()
        clauses.append(or_(*(attention_clauses[a] for a in attention)))
    return select(P.id).outerjoin(F,F.id==P.current_fact_revision_id).where(*clauses).correlate(Metric).exists()


def progress_order(year,quarter):
    return select(progress()).select_from(P).outerjoin(F,F.id==P.current_fact_revision_id).where(P.metric_id==Metric.id,P.calendar_year==year,P.quarter==quarter).correlate(Metric).scalar_subquery().desc().nullslast()


def due_order(year,quarter,view):
    from sqlalchemy import func,literal_column
    due_sql=OVERDUE.text.replace('EXISTS (\n SELECT 1 FROM generate_series','(SELECT min(d.due) FROM generate_series',1).replace('d.due < :business_today AND ','')
    clauses=[P.metric_id==Metric.id,P.calendar_year==year,P.state=='active',P.cadence!='none',P.start_date<=today(),Metric.lifecycle_state=='tracking']
    if view=='quarter':clauses.append(P.quarter==quarter)
    return select(func.min(literal_column(due_sql))).select_from(P).where(*clauses).correlate(Metric).scalar_subquery().asc().nullslast()
