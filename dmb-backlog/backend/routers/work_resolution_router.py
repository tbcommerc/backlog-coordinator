"""One atomic request resolution for every assistant delivery client."""
from copy import deepcopy
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from auth import get_current_user, can_access_task, is_customer_portal_only
from database import get_db
from models import RequirementRequest, WorkResolution, RequestWorkLink, WorkTask, Task, User, EventOutbox
from work_contract import Contract, WorkCreate
from schemas import TaskCreate
from services import work_tasks as work
from idempotency import reserve_idempotency
from requirement_artifacts import current_revision_history, ensure_request_history, append_status_event
from notifications import notify_request_decision

router = APIRouter()


class FulfillmentDecision(Contract):
    version: int = Field(ge=0)
    coverage: Literal['full', 'partial']
    fulfillment: Literal['not_started', 'in_progress', 'needs_verification', 'fulfilled']
    result_text: str = Field(min_length=1, max_length=10000)


class Resolution(Contract):
    version: int = Field(ge=0)
    decision: Literal['create_work', 'create_major', 'link_work', 'link_major']
    work: WorkCreate | None = None
    major: TaskCreate | None = None
    target_id: int | None = Field(None, gt=0)
    scope_text: str = Field(min_length=1, max_length=10000)
    coverage: Literal['full', 'partial']

    @model_validator(mode='after')
    def shape(self):
        expected = {'create_work': 'work', 'create_major': 'major', 'link_work': 'target_id', 'link_major': 'target_id'}[self.decision]
        if getattr(self, expected) is None or any(getattr(self, k) is not None for k in ('work', 'major', 'target_id') if k != expected):
            raise ValueError('Заполните только выбранный результат размещения')
        return self


def request_for(db, request_id, user, write=False):
    from routers.agent_router import can_review_request
    query = db.query(RequirementRequest).filter_by(id=request_id, is_deleted=False)
    if write: query = query.with_for_update()
    req = query.first()
    if not req or (not can_review_request(user, req.team_id) and (write or req.user_id != user.id)):
        raise HTTPException(404, 'Запрос недоступен')
    if write and is_customer_portal_only(user): raise HTTPException(403, 'Требуется право ревью')
    return req


def fulfillment(db, req, user):
    decision = db.query(WorkResolution).filter_by(request_id=req.id).first()
    if not decision:
        return {'coverage': 'unmapped', 'fulfillment': 'not_started', 'works': [], 'message': 'Работы по запросу ещё не размещены'}
    all_rows = db.query(RequestWorkLink).filter_by(request_id=req.id).all()
    rows = [link for link in all_rows if link.is_active]
    works = []
    revisions = {}
    for link in rows:
        target = db.get(WorkTask if link.work_task_id else Task, link.work_task_id or link.major_task_id)
        if not target or target.is_deleted: continue
        # Request owners see only the explicitly linked public result, no files, comments or other sources.
        if req.user_id != user.id:
            if link.work_task_id:
                try: work.get_work(db, target.id, user)
                except HTTPException: continue
            elif not can_access_task('read', target, user): continue
        works.append({'kind': 'work' if link.work_task_id else 'major', 'id': target.id,
                      'public_id': target.public_id, 'title': target.title,
                      'status': target.status if link.work_task_id else (
                          {'ВЫПОЛНЕНА':'done', 'ОТКЛОНЕНА':'cancelled', 'НЕ АКТУАЛЬНА':'cancelled',
                           'ПРИНЯТА В РАБОТУ':'in_progress'}.get(target.status.name if target.status else '', 'queued')),
                      'result_text': target.result_text if link.work_task_id else '',
                      'scope_text': link.scope_text, 'coverage': link.coverage})
        if link.work_task_id:
            revisions[str(target.id)] = target.result_revision
    needs_review = (len(works) != len(all_rows) or not works
        or any(x['status'] == 'cancelled' for x in works)
        or (decision.fulfillment == 'fulfilled' and any(
            x['status'] != 'done' for x in works))
        or (decision.fulfillment == 'fulfilled' and bool(revisions)
            and decision.confirmed_work_revisions != revisions))
    return {'review_decision': decision.review_decision, 'can_confirm': req.status not in {'withdrawn', 'rejected'}, 'coverage': 'partial' if needs_review else decision.coverage,
            'fulfillment': 'needs_verification' if needs_review else ('awaiting_confirmation' if decision.fulfillment != 'fulfilled' and works and all(x['status']=='done' for x in works) else decision.fulfillment),
            'result_text': decision.result_text, 'works': works, 'version': req.version,
            'legacy_supported': len(works) == 1 and works[0]['kind'] == 'major' and req.task_id == works[0]['id']}


@router.get('/requests/{request_id}/fulfillment')
def read_fulfillment(request_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return fulfillment(db, request_for(db, request_id, user), user)


@router.post('/requests/{request_id}/resolution')
def resolve(request_id: int, body: Resolution, idempotency_key: str = Header(..., min_length=8, max_length=64),
            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = request_for(db, request_id, user, write=True)
    reservation, fresh = reserve_idempotency(db, operation=f'request.resolution:{request_id}', user_id=user.id,
        request_key=idempotency_key, request_data=body.model_dump(mode='json'))
    if not fresh: return fulfillment(db, req, user)
    if req.version != body.version or db.query(WorkResolution).filter_by(request_id=req.id).first():
        raise HTTPException(409, 'Запрос уже изменён или размещён')
    if req.status != 'accepted' and (req.status != 'in_review' or req.reviewer_id != user.id):
        raise HTTPException(409, 'Сначала возьмите запрос на ревью')
    if req.task_id:
        raise HTTPException(409, 'У запроса уже есть прежнее размещение; требуется сверка')
    ensure_request_history(req)
    target, is_work = add_target(db, req, user, body)
    db.add(WorkResolution(request_id=req.id, review_decision=body.decision, decided_by=user.id,
                          coverage=body.coverage, fulfillment='not_started', result_text=''))
    # Preserve legacy FK only when representable without violating its unique constraint.
    if not is_work and not db.query(RequirementRequest).filter(RequirementRequest.task_id == target.id).first():
        req.task_id = target.id
    req.status = 'in_progress'
    req.coordinator_id = req.coordinator_id or user.id
    req.version += 1
    append_status_event(req, req.status, user, body.scope_text, metadata={'review_decision': body.decision})
    notify_request_decision(db, req, 'in_progress', user.id)
    reservation.resource_type = 'requirement'
    reservation.resource_id = req.id
    reservation.resource_version = req.version
    db.add(EventOutbox(event_type='requirement.resolved', aggregate_type='requirement', aggregate_id=req.id,
                       aggregate_version=req.version, payload={'owner_user_id': req.user_id, 'team_id': req.team_id}))
    try: db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, 'Запрос изменён другим ревьюером')
    return fulfillment(db, req, user)


@router.post('/requests/{request_id}/fulfillment')
def confirm_fulfillment(request_id: int, body: FulfillmentDecision,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = request_for(db, request_id, user, write=True)
    decision = db.query(WorkResolution).filter_by(request_id=req.id).first()
    if not decision: raise HTTPException(422, 'Сначала разместите запрос')
    if req.status in {'withdrawn', 'rejected'}: raise HTTPException(409, 'Сначала возобновите рассмотрение запроса')
    if req.version != body.version: raise HTTPException(409, 'Запрос изменён')
    # Serialize result confirmation against execution/reopening of every linked work.
    work_ids = [x.work_task_id for x in db.query(RequestWorkLink).filter_by(request_id=req.id, is_active=True).all() if x.work_task_id]
    if work_ids:
        db.query(WorkTask).filter(WorkTask.id.in_(work_ids)).order_by(WorkTask.id).with_for_update().populate_existing().all()
    summary = fulfillment(db, req, user)
    links_count = db.query(RequestWorkLink).filter_by(request_id=req.id).count()
    if body.fulfillment == 'fulfilled':
        if body.coverage != 'full' or len(summary['works']) != links_count or not summary['works']:
            raise HTTPException(422, 'Нельзя подтвердить итог без полного доступного покрытия')
        if any(x['kind'] == 'work' and x['status'] != 'done' for x in summary['works']):
            raise HTTPException(422, 'Рабочие задачи должны пройти приёмку')
        for target in summary['works']:
            if target['kind'] == 'major':
                task = db.get(Task, target['id'])
                if not task.status or task.status.name != 'ВЫПОЛНЕНА':
                    raise HTTPException(422, 'Текущие задачи должны быть выполнены')
    if decision.fulfillment == body.fulfillment and decision.coverage == body.coverage and decision.result_text == body.result_text:
        return summary
    decision.coverage = body.coverage
    decision.fulfillment = body.fulfillment
    decision.result_text = body.result_text
    decision.confirmed_work_revisions = {
        str(row.id): row.result_revision
        for row in db.query(WorkTask).filter(WorkTask.id.in_(work_ids)).all()
    } if body.fulfillment == 'fulfilled' else None
    req.version += 1
    append_status_event(req, req.status, user, body.result_text,
                        metadata={'coverage': body.coverage, 'fulfillment': body.fulfillment})
    req.status_history = [*req.status_history[:-1], {**req.status_history[-1], 'title': 'Результат запроса подтверждён' if body.fulfillment == 'fulfilled' else 'Результат запроса обновлён'}]
    if body.fulfillment == 'fulfilled':
        req.next_action = None
        req.next_action_due = None
    notify_request_decision(db, req, body.fulfillment, user.id)
    db.commit()
    return fulfillment(db, req, user)


def add_target(db, req, user, body):
    if body.decision == 'create_work':
        values = body.work.model_copy(update={'acceptance_required': True, 'acceptor_id': body.work.acceptor_id or user.id})
        target = work.create(db, user, values)
    elif body.decision == 'create_major':
        from routers.tasks_router import create_task_in_transaction
        result = create_task_in_transaction(body.major, db, user)
        target = db.get(Task, result.id)
    elif body.decision == 'link_work':
        target = work.get_work(db, body.target_id, user)
        work.require(work.editor(user, target.execution_team_id))
        if not target.acceptance_required:
            raise HTTPException(422, 'Для запроса выберите работу с обязательной приёмкой')
    else:
        target = db.get(Task, body.target_id)
        if not target or target.is_deleted or not can_access_task('read', target, user) or not can_access_task('edit', target, user):
            raise HTTPException(404, 'Задача недоступна')
    is_work = body.decision.endswith('work')
    revision = max((x.get('revision', 0) for x in current_revision_history(req)), default=0) or 1
    db.add(RequestWorkLink(request_id=req.id, work_task_id=target.id if is_work else None,
        major_task_id=None if is_work else target.id, request_revision=revision,
        requirement_snapshot=deepcopy({'title': req.title, 'description': req.description, 'draft': req.draft,
                                      'revision_history': current_revision_history(req), 'target': {'kind': 'work' if is_work else 'major', 'id': target.id, 'title': target.title}}),
        scope_text=body.scope_text, coverage=body.coverage, created_by=user.id))
    db.flush()
    return target, is_work


class SplitResolution(Contract):
    version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=10000)
    parts: list[Resolution] = Field(min_length=1, max_length=30)


@router.post('/requests/{request_id}/split')
def split_request(request_id: int, body: SplitResolution,
                  idempotency_key: str = Header(..., min_length=8, max_length=64),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    req = request_for(db, request_id, user, write=True)
    reservation, fresh = reserve_idempotency(db, operation=f'request.split:{request_id}', user_id=user.id,
        request_key=idempotency_key, request_data=body.model_dump(mode='json'))
    if not fresh: return fulfillment(db, req, user)
    if req.version != body.version: raise HTTPException(409, 'Запрос изменён')
    decision = db.query(WorkResolution).filter_by(request_id=req.id).first()
    if not decision and req.status != 'accepted' and (req.status != 'in_review' or req.reviewer_id != user.id):
        raise HTTPException(409, 'Сначала возьмите запрос на ревью')
    if req.task_id and not decision:
        raise HTTPException(409, 'Прежнее размещение требует сверки перед разбиением')
    if req.status in {'withdrawn', 'rejected'} or (not decision and req.status not in {'in_review', 'in_progress', 'accepted'}):
        raise HTTPException(409, 'Разбиение доступно на ревью или в работе')
    existing = db.query(RequestWorkLink).filter_by(request_id=req.id).all()
    keys = {('work' if x.work_task_id else 'major', x.work_task_id or x.major_task_id) for x in existing}
    for part in body.parts:
        if part.version != body.version: raise HTTPException(422, 'Версии частей должны совпадать')
        if part.decision.startswith('link'):
            key = ('work' if part.decision.endswith('work') else 'major', part.target_id)
            if key in keys: raise HTTPException(422, 'Работа уже включена в запрос')
            keys.add(key)
    if len(existing) + len(body.parts) < 2:
        raise HTTPException(422, 'Для разбиения нужны минимум две работы')
    ensure_request_history(req)
    for part in body.parts:
        add_target(db, req, user, part.model_copy(update={'coverage': 'partial'}))
    if not decision:
        decision = WorkResolution(request_id=req.id, review_decision='split', decided_by=user.id)
        db.add(decision)
    decision.review_decision = 'split'
    decision.coverage = 'partial'
    decision.fulfillment = 'needs_verification'
    decision.result_text = ''
    decision.confirmed_work_revisions = None
    req.task_id = None
    req.status = 'in_progress'
    req.coordinator_id = req.coordinator_id or user.id
    req.version += 1
    append_status_event(req, req.status, user, body.reason, metadata={'review_decision':'split', 'added_parts':len(body.parts)})
    notify_request_decision(db, req, 'in_progress', user.id)
    reservation.resource_type, reservation.resource_id, reservation.resource_version = 'requirement', req.id, req.version
    db.add(EventOutbox(event_type='requirement.resolved', aggregate_type='requirement', aggregate_id=req.id,
        aggregate_version=req.version, payload={'owner_user_id':req.user_id,'team_id':req.team_id}))
    db.commit()
    return fulfillment(db, req, user)
