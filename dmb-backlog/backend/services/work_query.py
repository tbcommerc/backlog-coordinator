"""Shared ACL-aware work selection, aggregates and deterministic ordering."""
from datetime import datetime, timedelta, time, timezone
from zoneinfo import ZoneInfo
from typing import Literal
from pydantic import BaseModel, Field
from fastapi import HTTPException
from sqlalchemy import func, case, or_, cast, String, select
from auth import task_read_scope_clause, can_access_task
from models import WorkTask as W, Task, Project
from services import work_tasks as work

STATUSES = ('new', 'ready', 'in_progress', 'in_acceptance', 'done', 'cancelled')
TITLES = dict(zip(STATUSES, ('Новые', 'К исполнению', 'В работе', 'На приёмке', 'Выполнены', 'Отменённые')))
MOSCOW = ZoneInfo('Europe/Moscow')


class Filters(BaseModel):
    view: Literal['all', 'mine', 'team', 'requested', 'acceptance'] = 'mine'
    status: Literal['', 'active', 'active_done', 'new', 'ready', 'in_progress', 'in_acceptance', 'done', 'cancelled'] = 'active'
    q: str = ''
    execution_team_id: int | None = Field(None, gt=0)
    assignee_id: int | None = Field(None, gt=0)
    major_task_id: int | None = Field(None, gt=0)
    direct_project_id: int | None = Field(None, gt=0)
    effective_project_id: int | None = Field(None, gt=0)
    work_direction: Literal['product', 'organizational'] | None = None
    priority: Literal['low', 'normal', 'high', 'urgent'] | None = None
    done_period: Literal['all', '7d', '30d'] = 'all'
    overdue: bool = False
    blocked: bool = False
    unassigned: bool = False
    focus: Literal['', 'today', 'overdue', 'blocked'] = ''
    sort: Literal['attention', 'priority', 'due', 'newest'] = 'attention'


class Selection:
    def __init__(self, db, user, filters, now=None):
        self.now = now or datetime.now(MOSCOW)
        self.today = self.now.astimezone(MOSCOW).date()
        self.filters = filters
        f = filters
        query = db.query(W).filter(W.is_deleted.is_(False), work.read_scope(user))
        if f.major_task_id:
            parent = db.get(Task, f.major_task_id)
            if not parent or parent.is_deleted or not can_access_task('read', parent, user):
                raise HTTPException(404, {'code':'context_unavailable', 'message':'Контекст недоступен'})
        for key in ('execution_team_id','assignee_id','major_task_id','direct_project_id','work_direction','priority'):
            value = getattr(f, key)
            if value is not None: query = query.filter(getattr(W, key) == value)
        if f.effective_project_id:
            if db.get(Project, f.effective_project_id) is None:
                raise HTTPException(404, {'code':'context_unavailable', 'message':'Проект недоступен'})
            parents = select(Task.id).where(Task.project_id == f.effective_project_id,
                Task.is_deleted.is_(False), task_read_scope_clause(user, Task))
            query = query.filter(or_(W.direct_project_id == f.effective_project_id, W.major_task_id.in_(parents)))
        if f.q.strip():
            pattern = '%' + f.q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
            query = query.filter(or_(W.title.ilike(pattern, escape='\\'),
                ('WRK-' + cast(W.id, String)).ilike(pattern, escape='\\')))
        self.active = W.status.notin_(['done','cancelled'])
        self.late = self.active & (W.due_date < self.today)
        self.blocked = self.active & W.blocked_reason.isnot(None) & (W.blocked_reason != '')
        self.unassigned = self.active & W.assignee_id.is_(None)
        if f.status == 'active': query = query.filter(self.active)
        elif f.status == 'active_done': query = query.filter(W.status != 'cancelled')
        elif f.status: query = query.filter(W.status == f.status)
        if f.done_period != 'all':
            start = datetime.combine(self.today - timedelta(days=int(f.done_period[:-1])-1), time.min, MOSCOW).astimezone(timezone.utc)
            query = query.filter(or_(W.status != 'done', (W.completed_at >= start) & (W.completed_at <= self.now.astimezone(timezone.utc))))
        for key in ('overdue','blocked','unassigned'):
            if getattr(f, key): query = query.filter(getattr(self, 'late' if key == 'overdue' else key))
        self.collections = {'mine':W.assignee_id == user.id,
            'team':W.execution_team_id == (f.execution_team_id or user.team_id or -1),
            'requested':W.requester_id == user.id,
            'acceptance':(W.acceptor_id == user.id) & (W.status == 'in_acceptance')}
        self.base = query
        self.query = query.filter(self.collections[f.view]) if f.view in self.collections else query
        self.focus_base = self.query
        self.focus_clauses = {'today': self.active & (W.due_date == self.today), 'overdue': self.late, 'blocked': self.blocked}
        if f.focus:
            self.query = self.query.filter(self.focus_clauses[f.focus])
        self.attention = case((self.late,0),(W.status=='in_acceptance',1),(self.blocked,2),(self.unassigned,3),(self.active,4),else_=5)
        self.keys = []
        if f.sort == 'attention': self.keys.append(self.attention)
        if f.sort == 'priority': self.keys.append(case((W.priority=='urgent',0),(W.priority=='high',1),(W.priority=='normal',2),else_=3))
        if f.sort != 'newest': self.keys.append(func.coalesce(cast(W.due_date,String),'9999-12-31'))
        self.keys.append(-W.id)

    def focus_counts(self):
        values = self.focus_base.with_entities(*[func.sum(case((clause, 1), else_=0)) for clause in self.focus_clauses.values()]).one()
        return dict(zip(self.focus_clauses, [int(value or 0) for value in values]))

    def aggregates(self):
        counts = self.base.with_entities(func.count(W.id), *[func.sum(case((x,1),else_=0)) for x in self.collections.values()]).one()
        stats = self.query.with_entities(func.count(W.id), *[func.sum(case((x,1),else_=0)) for x in
            (W.status=='done',W.status=='in_acceptance',self.late,self.blocked,self.unassigned,self.active,W.assignment_state=='proposed')]).one()
        return (dict(zip(('all',*self.collections),[int(x or 0) for x in counts])),
                dict(zip(('total','done','in_acceptance','overdue','blocked','unassigned','active','proposals'),[int(x or 0) for x in stats])))

    def included(self, status):
        f = self.filters
        return ((not f.status or f.status == status or f.status == 'active' and status not in ('done','cancelled')
                 or f.status == 'active_done' and status != 'cancelled')
                and (f.view != 'acceptance' or status == 'in_acceptance'))

    def summary_states(self):
        return {key: {'state': 'included' if self.included(status) else 'filtered'}
                for key, status in [('done', 'done'), ('in_acceptance', 'in_acceptance')]}
