"""ACL-scoped management projections. Unknown dates are never invented."""
import json
from datetime import date, timedelta
from fastapi import HTTPException
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.exc import StaleDataError
from auth import can_access_task, authorize_task
from models import Task, ProjectTaskPlan, TaskHistory, WorkTask, User, Team
from services import project_workspace as workspace
from services.metric_rules import today

CLOSED = {'done', 'rejected', 'irrelevant'}


def task_rows(db, user, project_id, task_id=None):
    query = workspace.task_scope(db, user, project_id)
    if task_id is not None:
        query = query.filter(Task.id == task_id)
    tasks = workspace.task_options(query).options(joinedload(Task.start_shift)).order_by(Task.id).all()
    plans = {p.task_id: p for p in db.query(ProjectTaskPlan).filter(ProjectTaskPlan.task_id.in_([t.id for t in tasks])).all()}
    refs = workspace.deadlines(db)
    rows = []
    for task in tasks:
        plan = plans.get(task.id)
        spans = []
        if plan and plan.starts_on:
            spans = [dict(start=plan.starts_on, end=plan.ends_on)]
            precision = 'exact'
        else:
            for year, quarter in sorted(refs.get(task.deadline_id, {}).get('slots', set())):
                start, end = workspace.period_bounds(year, quarter)
                # A start shift is a month inside each quarter, never a date of receipt.
                shift = task.start_shift.month_number if task.start_shift else 1
                if quarter and shift in (1, 2, 3):
                    start = date(year, start.month + shift - 1, 1)
                spans.append(dict(start=start, end=end-timedelta(days=1)))
            precision = 'period' if spans else 'unknown'
        end = max((s['end'] for s in spans), default=None)
        active = (task.status.code if task.status else '') not in CLOSED
        delay = (end-plan.baseline_end).days if end and plan and plan.baseline_end else 0
        issues = []
        if active and end and end < today():
            issues.append('overdue')
        if active and delay > 0:
            issues.append('shifted')
        rows.append({**workspace.task_row(task), 'kind':'backlog', 'version':task.version or 0,
            'can_edit':can_access_task('edit', task, user), 'spans':spans, 'precision':precision,
            'starts_on':plan.starts_on if plan else None, 'ends_on':plan.ends_on if plan else None,
            'baseline_start':plan.baseline_start if plan else None, 'baseline_end':plan.baseline_end if plan else None,
            'is_milestone':bool(plan and plan.is_milestone), 'milestone_on':end if plan and plan.is_milestone else None,
            'expected_result':plan.expected_result if plan else '', 'change_reason':plan.change_reason if plan else '',
            'management_status':task.key_project_status, 'issues':issues, 'delay_days':max(0,delay)})
    return rows


def intersects(row, start, end):
    return any(span['start'] < end and span['end'] >= start for span in row['spans'])


def work_issues(db, user, project_id):
    # Reuse the canonical work selection, including parent ACL and soft deletion.
    query = workspace.work_scope(db, user, project_id).query
    rows = query.filter(WorkTask.status.notin_(['done','cancelled'])).filter(
        (WorkTask.due_date < today()) | (WorkTask.status == 'in_acceptance')).order_by(WorkTask.id).all()
    owners = {x.id:x.name for x in db.query(User).filter(User.id.in_([t.assignee_id for t in rows])).all()}
    teams = {x.id:x.name for x in db.query(Team).filter(Team.id.in_([t.execution_team_id for t in rows])).all()}
    return [dict(id=t.id, kind='work', public_id=t.public_id, title=t.title, due_date=t.due_date,
        status='На приёмке' if t.status=='in_acceptance' else 'В работе',
        issues=(['overdue'] if t.due_date and t.due_date<today() else []) + (['acceptance'] if t.status=='in_acceptance' else []),
        expected_result=t.result_text or '', change_reason='', owner=owners.get(t.assignee_id), team=teams.get(t.execution_team_id)) for t in rows]


def management(db, user, project_id, year, quarter, view='plan', horizon='period', page=1, q='', milestones=False, team='', state='', sort='start', owner=''):
    workspace.project(db, project_id)
    start,end=workspace.period_bounds(year,quarter)
    all_rows=task_rows(db,user,project_id)
    planned=[r for r in all_rows if intersects(r,start,end)]
    milestones_period=[r for r in planned if r['is_milestone'] and r['milestone_on'] and start<=r['milestone_on']<end]
    # Attention is deliberately current project-wide; not silently hidden by the report period.
    attention=[r for r in all_rows if r['issues']] + work_issues(db,user,project_id)
    def due(row):
        return row.get('due_date') or max((s['end'] for s in row.get('spans',[])),default=date.max)
    attention.sort(key=lambda r:(due(r),r['kind'],r['id']))
    for row in attention:
        row['overdue_days'] = max(0,(today()-due(row)).days) if 'overdue' in row['issues'] else 0
    options = dict(teams=sorted({r['team'] for r in all_rows if r.get('team')}),
                   owners=sorted({r['owner'] for r in all_rows if r.get('owner')}),
                   states=sorted({r['status'] for r in all_rows if r.get('status')}))
    completed=workspace.results(db,user,project_id,year,quarter,'work')
    summary=dict(planned=len(planned), milestones=len(milestones_period),
        milestones_done=sum(r['status_code']=='done' for r in milestones_period),
        attention=len(attention), completed_work=completed['total'],
        undated=sum(not r['spans'] for r in all_rows))
    if view=='deviations':
        selected=attention
    elif horizon=='all':
        selected=all_rows
    elif horizon=='undated':
        selected=[r for r in all_rows if not r['spans']]
    else:
        selected=planned
    if milestones:
        selected=[r for r in selected if r.get('is_milestone')]
    if team:
        selected=[r for r in selected if r.get('team')==team]
    if owner:
        selected=[r for r in selected if r.get('owner')==owner]
    if state:
        selected=[r for r in selected if r.get('status')==state]
    if q.strip():
        needle=q.strip().casefold()
        selected=[r for r in selected if needle in r['title'].casefold() or needle in (r['public_id'] or '').casefold()]
    ordering = (lambda r:due(r)) if sort=='due' or view=='deviations' else (lambda r:(r.get('owner') or '\uffff').casefold()) if sort=='owner' else (lambda r:r['title'].casefold()) if sort=='title' else (lambda r:min((s['start'] for s in r.get('spans',[])),default=date.max))
    selected=sorted(selected,key=lambda r:(ordering(r),r['kind'],r['id']))
    total=len(selected);page=min(page,max(1,(total+29)//30))
    spans=[s for r in selected for s in r.get('spans',[])]
    spans += [dict(start=r['baseline_start'],end=r['baseline_end']) for r in selected if r.get('baseline_start') and r.get('baseline_end')]
    chart_start=min((s['start'] for s in spans),default=start) if horizon=='all' else start
    chart_end=max((s['end'] for s in spans),default=end-timedelta(days=1)) if horizon=='all' else end-timedelta(days=1)
    return dict(items=selected[(page-1)*30:page*30],total=total,page=page,summary=summary,filter_options=options,can_edit=any(r['can_edit'] for r in all_rows),
        start=start,end_exclusive=end,today=today(),chart_start=chart_start,chart_end=chart_end,
        milestones=sorted(milestones_period,key=lambda r:(r['milestone_on'],r['id']))[:5],
        attention=attention[:5],recent_results=completed['items'][:5])


def update_plan(db,user,project_id,task_id,payload):
    task=workspace.task_scope(db,user,project_id).filter(Task.id==task_id).with_for_update().first()
    if not task:
        raise HTTPException(404,'Задача недоступна в этом проекте')
    authorize_task('edit',task,user)
    from routers.task_collaboration_router import is_task_lock_active
    if is_task_lock_active(task) and task.lock_owner_id != user.id:
        raise HTTPException(423,'Задача редактируется другим пользователем')
    if task.version != payload.version:
        raise HTTPException(409,'Задача изменена. Обновите план и повторите изменение.')
    plan=db.get(ProjectTaskPlan,task_id)
    fields=('starts_on','ends_on','is_milestone','expected_result','change_reason')
    before={f:getattr(plan,f) for f in fields} if plan else None
    if plan and plan.starts_on and (plan.starts_on!=payload.starts_on or plan.ends_on!=payload.ends_on) and not payload.change_reason.strip():
        raise HTTPException(422,'Укажите причину изменения сроков')
    if not plan:
        plan=ProjectTaskPlan(task_id=task_id);db.add(plan)
    for f in fields:
        if f == 'change_reason' and not payload.change_reason.strip() and before:
            continue
        setattr(plan,f,getattr(payload,f))
    if payload.starts_on and plan.baseline_start is None:
        plan.baseline_start=payload.starts_on;plan.baseline_end=payload.ends_on
    task.version=(task.version or 0)+1
    db.add(TaskHistory(task_id=task_id,changed_by=user.id,field_name='project_plan',
        old_value=json.dumps(before,default=str,ensure_ascii=False) if before else None,
        new_value=json.dumps({f:getattr(plan,f) for f in fields},default=str,ensure_ascii=False)))
    try:
        db.flush()
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409,'Задача изменена. Обновите план и повторите изменение.')
    return dict(task_id=task_id,version=task.version)
