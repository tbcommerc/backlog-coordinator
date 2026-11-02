"""Audited customer relationship decisions, independent of execution tasks."""
from datetime import date
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm.exc import StaleDataError
from models import RequirementRequest, User, WorkResolution
from requirement_artifacts import ensure_request_history, append_status_event
from notifications import notify_request_decision, _create_notification
from services.request_state import today, effective_state, lifecycle_actions
from auth import is_customer_portal_only


class LifecycleCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['accept', 'defer', 'reconsider', 'withdraw', 'follow_up']
    version: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=2000)
    coordinator_id: int | None = Field(None, gt=0)
    next_action: str | None = Field(None, max_length=500)
    next_action_due: date | None = None


def execute(db, user, request_id, body):
    from routers.agent_router import can_review_request
    req = db.query(RequirementRequest).filter_by(id=request_id, is_deleted=False).with_for_update().first()
    if not req or not (req.user_id == user.id or can_review_request(user, req.team_id)):
        raise HTTPException(404, 'Запрос недоступен')
    if req.version != body.version: raise HTTPException(409, 'Запрос изменился. Обновите карточку')
    reviewer = can_review_request(user, req.team_id) and not is_customer_portal_only(user)
    if body.action not in lifecycle_actions(req, user, reviewer, effective_state(db, req)):
        raise HTTPException(409, 'Действие недоступно на текущем этапе')
    reason = body.reason.strip()
    if not reason: raise HTTPException(422, 'Укажите причину')
    if body.action in {'accept', 'defer', 'follow_up'}:
        if not (body.next_action or '').strip() or not body.next_action_due:
            raise HTTPException(422, 'Укажите следующий шаг и срок')
        if body.next_action_due < today(): raise HTTPException(422, 'Срок следующего шага не может быть в прошлом')
        coordinator_id = body.coordinator_id or req.coordinator_id or user.id
        coordinator = db.get(User, coordinator_id)
        if not coordinator or not coordinator.is_active or is_customer_portal_only(coordinator) or not can_review_request(coordinator, req.team_id):
            raise HTTPException(422, 'Ответственным должен быть активный участник с правом ревью этой команды')
    else:
        if body.coordinator_id or body.next_action or body.next_action_due:
            raise HTTPException(422, 'Поля сопровождения доступны только при принятии, переносе или изменении следующего шага')
    ensure_request_history(req)
    previous = req.status
    if body.action in {'accept', 'defer', 'follow_up'}:
        req.coordinator_id = coordinator_id
        req.next_action = body.next_action.strip()
        req.next_action_due = body.next_action_due
    if body.action == 'accept': req.status = 'accepted'
    elif body.action == 'defer': req.status = 'deferred'
    elif body.action == 'withdraw':
        req.status = 'withdrawn'
        req.next_action = None
        req.next_action_due = None
    elif body.action == 'reconsider':
        resolution = db.query(WorkResolution).filter_by(request_id=req.id).first()
        req.status = 'in_progress' if resolution else 'submitted'
        req.reviewer_id = None if not resolution else req.reviewer_id
        req.coordinator_id = user.id
        req.next_action = 'Повторно рассмотреть запрос и согласовать следующий шаг'
        req.next_action_due = today()
        if resolution: resolution.fulfillment = 'needs_verification'
    req.version += 1
    append_status_event(req, req.status, user, reason, metadata={'action': body.action, 'previous_status': previous,
        'coordinator_id': req.coordinator_id, 'next_action': req.next_action,
        'next_action_due': req.next_action_due.isoformat() if req.next_action_due else None})
    req.status_history = [*req.status_history[:-1], {**req.status_history[-1], 'title': {
        'accept': 'Принят в бэклог', 'defer': 'Рассмотрение отложено', 'reconsider': 'Решение направлено на пересмотр',
        'withdraw': 'Запрос отозван', 'follow_up': 'Обновлён следующий шаг'}[body.action]}]
    notify_request_decision(db, req, body.action, user.id)
    if req.coordinator_id and req.coordinator_id not in {user.id, req.user_id} and body.action in {'accept','defer','follow_up'}:
        _create_notification(db,req.coordinator_id,None,'request','Назначен следующий шаг по запросу',
            body=f'{req.next_action}. Срок: {req.next_action_due}',action_url=f'#/review/{req.id}',
            group_key=f'request-follow-up:{req.id}:{req.version}',event_type='request.follow_up.assigned')
    try: db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, 'Запрос изменился. Обновите карточку')
    return req
