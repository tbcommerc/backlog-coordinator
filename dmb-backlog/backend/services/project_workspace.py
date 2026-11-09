"""Read-only project directions, current planning and period evidence.

Task/WorkTask/Metric retain their own lifecycle. A project has no computed
completion percentage. Every work-derived projection applies its source ACL.
"""
import re
import json
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, or_, cast, String
from sqlalchemy.orm import joinedload

from auth import task_read_scope_clause
from models import Project, Task, TaskStatus, TaskHistory, Deadline, WorkTask, Team, User
from metric_models import Metric, MetricPeriod, MetricMeasurement
from services.work_query import Selection, Filters
from services.metric_rules import summarize, today

MOSCOW = ZoneInfo('Europe/Moscow')


def period_bounds(year, quarter=0):
    start = date(year, quarter * 3 - 2 if quarter else 1, 1)
    end = date(year + 1, 1, 1) if quarter in (0, 4) else date(year, quarter * 3 + 1, 1)
    return start, end


def deadline_slots(code, name):
    """Annual horizons are separate from quarters; never infer Q4 for them."""
    for raw in (name, code):
        value = str(raw or '').upper().replace('_', ' ').strip()
        pairs = re.findall(r'(?:([1-4])\s*Q|Q\s*([1-4]))\s*(20\d{2})(?!\d)', value)
        if pairs:
            return {(int(y), int(a or b)) for a, b, y in pairs}
        annual = re.fullmatch(r'(?:(?:Y|YEAR)\s*)?(20\d{2})(?:\s*Г(?:ОД)?\.?)?', value)
        if annual:
            return {(int(annual[1]), 0)}
    return set()


def task_scope(db, user, project_id):
    return db.query(Task).filter((Task.project_id.in_(project_id) if isinstance(project_id,list) else Task.project_id == project_id), Task.is_deleted.is_(False),
                                 task_read_scope_clause(user, Task))


def work_scope(db, user, project_id):
    return Selection(db, user, Filters(view='all', status='', effective_project_id=project_id))


def project(db, project_id):
    row = db.query(Project).options(joinedload(Project.status), joinedload(Project.pl)).filter(Project.id == project_id).first()
    if not row:
        raise HTTPException(404, 'Проект недоступен')
    return row


def passport(row):
    return dict(id=row.id, code=row.code, name=row.name, description=row.description,
                status=row.status.name if row.status else None,
                responsible=row.pl.name if row.pl else None, created_at=row.created_at)


def catalogue(db, user, q='', page=1, team='', owner=''):
    query = db.query(Project).options(joinedload(Project.status), joinedload(Project.pl))
    if q.strip():
        pattern = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.filter(or_(Project.name.ilike(pattern, escape='\\'), Project.code.ilike(pattern, escape='\\')))
    all_projects=query.all()
    from services.project_management import task_rows
    projected=task_rows(db,user,[p.id for p in all_projects])
    options=dict(teams=sorted({r['team'] for r in projected if r.get('team')}),owners=sorted({p.pl.name for p in all_projects if p.pl}))
    if team:
        query=query.filter(Project.id.in_({r['project_id'] for r in projected if r.get('team')==team}))
    if owner:
        query=query.filter(Project.pl.has(User.name==owner))
    total = query.count()
    page = min(page, max(1, (total + 23) // 24))
    rows = query.order_by(Project.name, Project.id).offset((page - 1) * 24).limit(24).all()
    ids = [x.id for x in rows]
    counts = dict(db.query(Task.project_id, func.count(Task.id)).filter(Task.project_id.in_(ids),
        Task.is_deleted.is_(False), task_read_scope_clause(user, Task)).group_by(Task.project_id).all())
    def signals(project_id):
        tasks=[r for r in projected if r['project_id']==project_id]
        future=sorted(r['milestone_on'] for r in tasks if r['is_milestone'] and r['milestone_on'] and r['milestone_on']>=today() and r['status_code']!='done')
        return dict(overdue=sum('overdue' in r['issues'] for r in tasks), next_milestone=future[0] if future else None)
    return dict(items=[{**passport(x), 'backlog_count': counts.get(x.id, 0), **signals(x.id)} for x in rows], total=total, page=page,filter_options=options)


def deadlines(db):
    return {x.id: dict(name=x.name, slots=deadline_slots(x.code, x.name)) for x in db.query(Deadline).all()}


def workspace(db, user, project_id, year):
    row = project(db, project_id)
    tasks = task_scope(db, user, project_id)
    refs = deadlines(db)
    groups = tasks.with_entities(Task.deadline_id, func.count(Task.id)).group_by(Task.deadline_id).all()
    years = {today().year, today().year + 1, year}
    plan = {str(q): 0 for q in range(1, 5)} | {'annual': 0, 'unplanned': 0}
    for deadline_id, count in groups:
        slots = refs.get(deadline_id, {}).get('slots', set())
        years.update(y for y, _ in slots)
        if not slots:
            plan['unplanned'] += count
        for y, q in slots:
            if y == year:
                plan[str(q) if q else 'annual'] += count
    work = work_scope(db, user, project_id)
    _, summary = work.aggregates()
    metric_query = db.query(Metric).filter(Metric.project_id == project_id, Metric.is_archived.is_(False), task_read_scope_clause(user, Metric))
    team_ids = {x[0] for x in tasks.with_entities(Task.team_id).distinct()}
    team_ids.update(x[0] for x in work.query.with_entities(WorkTask.execution_team_id).distinct())
    team_ids.update(x[0] for x in metric_query.with_entities(Metric.team_id).distinct())
    teams = [dict(id=x.id, name=x.name) for x in db.query(Team).filter(Team.id.in_(team_ids)).order_by(Team.name)]
    return dict(project=passport(row), year=year, years=sorted(years), plan=plan, teams=teams,
                backlog_total=tasks.count(), work=summary, metrics_total=metric_query.count())


def task_row(row):
    return dict(id=row.id, project_id=row.project_id, public_id=row.public_id, title=row.title,
                status=row.status.name if row.status else None, status_code=row.status.code if row.status else None,
                team=row.team.name if row.team else None, owner=row.owner.name if row.owner else None,
                deadline=row.deadline.name if row.deadline else None,
                priority=row.priority.name if row.priority else None, progress=row.progress)


def task_options(query):
    return query.options(*(joinedload(x) for x in (Task.status, Task.team, Task.owner, Task.deadline, Task.priority)))


def backlog(db, user, project_id, year, bucket='all', q='', state='all', page=1):
    project(db, project_id)
    query = task_scope(db, user, project_id)
    refs = deadlines(db)
    if bucket != 'all':
        if bucket == 'unplanned':
            known = [id for id, item in refs.items() if item['slots']]
            query = query.filter(or_(Task.deadline_id.is_(None), Task.deadline_id.notin_(known)))
        else:
            slot = 0 if bucket == 'annual' else int(bucket)
            ids = [id for id, item in refs.items() if (year, slot) in item['slots']]
            query = query.filter(Task.deadline_id.in_(ids))
    if q.strip():
        pattern = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.filter(or_(Task.title.ilike(pattern, escape='\\'), Task.public_id.ilike(pattern, escape='\\')))
    if state != 'all':
        closed = db.query(TaskStatus.id).filter(TaskStatus.code.in_(['done', 'rejected', 'irrelevant']))
        query = query.filter(Task.status_id.in_(closed) if state == 'closed' else or_(Task.status_id.is_(None), Task.status_id.notin_(closed)))
    total = query.count()
    page = min(page, max(1, (total + 29) // 30))
    rows = task_options(query).order_by(Task.id.desc()).offset((page - 1) * 30).limit(30).all()
    return dict(items=[task_row(x) for x in rows], total=total, page=page)


def results(db, user, project_id, year, quarter=0, kind='work', page=1):
    project(db, project_id)
    start, end = period_bounds(year, quarter)
    start_at, end_at = [datetime.combine(x, datetime.min.time(), MOSCOW).astimezone(timezone.utc) for x in (start, end)]
    tasks = task_scope(db, user, project_id)
    if kind == 'work':
        query = work_scope(db, user, project_id).query.filter(WorkTask.status == 'done', WorkTask.completed_at >= start_at, WorkTask.completed_at < end_at)
        total = query.count()
        rows = query.order_by(WorkTask.completed_at.desc(), WorkTask.id.desc()).offset((page - 1) * 30).limit(30).all()
        items = [dict(id=x.id, title=x.title, completed_at=x.completed_at, result=x.result_text) for x in rows]
    elif kind in ('backlog', 'moves'):
        query = db.query(TaskHistory).join(Task, Task.id == TaskHistory.task_id).filter(
            Task.id.in_(tasks.with_entities(Task.id)), TaskHistory.changed_at >= start_at, TaskHistory.changed_at < end_at)
        if kind == 'backlog':
            done = db.query(cast(TaskStatus.id, String)).filter(TaskStatus.code == 'done')
            query = query.filter(TaskHistory.field_name == 'status_id', TaskHistory.new_value.in_(done))
        else:
            query = query.filter(TaskHistory.field_name.in_(['deadline_id', 'project_plan']))
        total = query.count()
        rows = query.options(joinedload(TaskHistory.task)).order_by(TaskHistory.changed_at.desc(), TaskHistory.id.desc()).offset((page - 1) * 30).limit(30).all()
        refs = deadlines(db) if kind == 'moves' else {}
        def label(value):
            if not value or value == 'None': return 'Не указан'
            return refs.get(int(value), {}).get('name', 'Недоступный срок') if value.isdigit() else 'Недоступный срок'
        def plan_label(raw):
            try:
                value=json.loads(raw or 'null') or {}
                return f"{value.get('starts_on') or '—'} — {value.get('ends_on') or '—'}; " + ('веха' if value.get('is_milestone') else 'задача')
            except (ValueError, TypeError):
                return 'План не распознан'
        items = [dict(id=x.task_id, title=x.task.title, public_id=x.task.public_id, changed_at=x.changed_at,
                      before=(plan_label if x.field_name=='project_plan' else label)(x.old_value),
                      after=(plan_label if x.field_name=='project_plan' else label)(x.new_value),
                      reason=(json.loads(x.new_value).get('change_reason','') if x.field_name=='project_plan' and x.new_value else '')) for x in rows]
    else:
        query = db.query(MetricPeriod, Metric).join(Metric, Metric.id == MetricPeriod.metric_id).filter(
            Metric.project_id == project_id, task_read_scope_clause(user, Metric),
            MetricPeriod.start_date < end, MetricPeriod.end_date >= start)
        total = query.count()
        rows = query.order_by(Metric.title, MetricPeriod.start_date, MetricPeriod.id).offset((page - 1) * 30).limit(30).all()
        period_ids = [p.id for p, _ in rows]
        points = db.query(MetricMeasurement).filter(MetricMeasurement.period_id.in_(period_ids), MetricMeasurement.measured_on < end, MetricMeasurement.measured_on <= today()).all() if period_ids else []
        items = []
        from datetime import timedelta
        for p, m in rows:
            samples = [x for x in points if x.period_id == p.id]
            summary = summarize(p, samples, at=min(today(), end - timedelta(days=1)))
            previous = sorted((x for x in samples if x.measured_on < start), key=lambda x: (x.measured_on, x.id))
            if p.model_version == 'quarterly_v2':
                from metric_quarterly_models import FactRevision
                fact = db.get(FactRevision,p.current_fact_revision_id) if p.current_fact_revision_id else None
                # Explicit quarter facts must never be replaced by observations.
                available = fact and fact.as_of_date < end and fact.as_of_date <= today()
                summary = dict(fact=float(fact.value) if available else None, measured_on=fact.as_of_date if available else None)
                previous = []
            items.append(dict(id=m.id, title=m.title, period=p.label, unit=p.unit_snapshot or m.unit,
                target=p.target, upper=p.upper, direction=p.direction, state=p.state,
                model_version=p.model_version, previous_fact=float(previous[-1].value) if previous else None, summary=summary))
    return dict(items=items, total=total, page=page, start=start, end_exclusive=end, kind=kind)
