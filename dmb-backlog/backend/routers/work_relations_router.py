"""Typed dependencies and link-only external execution. Never fetches arbitrary URLs."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, HttpUrl
from sqlalchemy import text
from sqlalchemy.orm import Session
from auth import get_current_user, require_non_business_customer_access, can_access_task
from database import get_db
from models import User, Task, WorkDependency, MajorExternalLink, WorkHistory
from work_contract import Contract, Version
from services import work_tasks as work

router = APIRouter(dependencies=[Depends(require_non_business_customer_access)])


class Target(Contract):
    kind: Literal['major', 'work']
    id: int = Field(gt=0)


class DependencyCreate(Contract):
    source: Target
    target: Target
    source_version: int = Field(ge=0)


class Remove(Version):
    reason: str = Field(min_length=1, max_length=5000)


class External(Contract):
    url: HttpUrl


def target_row(db, target, user, edit=False):
    if target.kind == 'work':
        row = work.get_work(db, target.id, user)
        if edit: work.require(work.editor(user, row.execution_team_id))
        return row
    row = db.get(Task, target.id)
    if not row or row.is_deleted or not can_access_task('read', row, user):
        raise HTTPException(404, 'Связанная работа недоступна')
    if edit: work.require(can_access_task('edit', row, user))
    return row


def ends(row):
    return (('major', row.source_major_id) if row.source_major_id else ('work', row.source_work_id),
            ('major', row.target_major_id) if row.target_major_id else ('work', row.target_work_id))


def would_cycle(edges, source, target):
    pending, seen = [target], set()
    while pending:
        current = pending.pop()
        if current == source: return True
        if current in seen: continue
        seen.add(current)
        pending.extend(b for a, b in edges if a == current)
    return False


def serialize_graph(db):
    # A single cross-worker transaction lock protects both create and deactivate.
    # This feature is PostgreSQL-only; do not pretend SQLite offers equivalent locking.
    if db.bind.dialect.name != 'postgresql':
        raise HTTPException(503, 'Изменение зависимостей требует PostgreSQL')
    db.execute(text('SELECT pg_advisory_xact_lock(18001642)'))


@router.post('/work-dependencies')
def create(body: DependencyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    serialize_graph(db)
    source = target_row(db, body.source, user, edit=True)
    target_row(db, body.target, user)
    if source.version != body.source_version: raise HTTPException(409, 'Работа изменена')
    a, b = (body.source.kind, body.source.id), (body.target.kind, body.target.id)
    edges = [ends(x) for x in db.query(WorkDependency).filter_by(is_active=True)]
    if (a, b) in edges: raise HTTPException(409, 'Зависимость уже существует')
    if would_cycle(edges, a, b): raise HTTPException(422, 'Зависимость создаёт цикл')
    values = {f'source_{body.source.kind}_id': body.source.id, f'target_{body.target.kind}_id': body.target.id}
    row = WorkDependency(**values, created_by=user.id, version=1, is_active=True, reason='')
    db.add(row)
    if body.source.kind == 'work':
        db.add(WorkHistory(work_task_id=source.id, actor_id=user.id, action='dependency_added',
                           version=source.version, before={}, after={}, reason='Добавлена зависимость'))
    db.commit()
    return {'id': row.id, 'version': row.version}


@router.get('/work-dependencies/{kind}/{target_id}')
def relations(kind: Literal['major', 'work'], target_id: int,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target_row(db, Target(kind=kind, id=target_id), user)
    rows = db.query(WorkDependency).filter(getattr(WorkDependency, f'source_{kind}_id') == target_id,
                                         WorkDependency.is_active.is_(True))
    result = []
    for row in rows:
        _, (target_kind, id) = ends(row)
        try: other = target_row(db, Target(kind=target_kind, id=id), user)
        except HTTPException: continue
        result.append({'id': row.id, 'version': row.version, 'kind': target_kind, 'target_id': id,
                       'title': other.title, 'public_id': other.public_id})
    return result


@router.post('/work-dependencies/{dependency_id}/deactivate')
def deactivate(dependency_id: int, body: Remove, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    serialize_graph(db)
    row = db.get(WorkDependency, dependency_id)
    if not row: raise HTTPException(404, 'Зависимость недоступна')
    (kind, id), _ = ends(row)
    source = target_row(db, Target(kind=kind, id=id), user, edit=True)
    if row.version != body.version or not row.is_active: raise HTTPException(409, 'Зависимость изменена')
    row.is_active = False; row.version += 1; row.reason = body.reason
    if kind == 'work':
        db.add(WorkHistory(work_task_id=id, actor_id=user.id, action='dependency_removed',
                           version=source.version, before={}, after={}, reason=body.reason))
    db.commit()
    return {'id': row.id, 'version': row.version, 'is_active': False}


@router.get('/tasks/{task_id}/external-links')
def external_links(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target_row(db, Target(kind='major', id=task_id), user)
    return [{'id': x.id, 'url': x.url, 'version': x.version, 'sync_state': 'link_only',
             'status': None, 'last_successful_sync': None}
            for x in db.query(MajorExternalLink).filter_by(major_task_id=task_id)]


@router.post('/tasks/{task_id}/external-links')
def external_link(task_id: int, body: External, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target_row(db, Target(kind='major', id=task_id), user, edit=True)
    if body.url.username or body.url.password: raise HTTPException(422, 'Не включайте реквизиты доступа в ссылку')
    url = str(body.url)
    if len(url) > 2000: raise HTTPException(422, 'Ссылка слишком длинная')
    existing = db.query(MajorExternalLink).filter_by(major_task_id=task_id, url=url).first()
    if not existing:
        existing = MajorExternalLink(major_task_id=task_id, url=url, created_by=user.id, version=1)
        db.add(existing); db.commit()
    return {'id': existing.id, 'version': existing.version, 'sync_state': 'link_only', 'url': existing.url}


@router.post('/tasks/{task_id}/external-refresh')
def external_refresh(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target_row(db, Target(kind='major', id=task_id), user, edit=True)
    raise HTTPException(409, 'Подключение к внешнему трекеру не настроено. Доступны только ссылки.')
