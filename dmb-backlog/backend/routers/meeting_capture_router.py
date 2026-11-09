"""Private meeting workspaces; confirmation is the only action-creation path."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (get_current_user, require_non_business_customer_access,
                  get_task_action_scope, task_read_scope_clause, can_access_task)
from database import get_db, db_lower
from models import MeetingCapture, MeetingAction, Task, User
from meeting_contract import MeetingDraft, MeetingItem, DraftUpdate, VersionRequest, confirmed_items
from services.meeting_matching import rank_tasks, terms
from services.meeting_analysis import ACTIVE, analysis_info

router = APIRouter(dependencies=[Depends(require_non_business_customer_access)])


def editor(user=Depends(get_current_user)):
    scope = get_task_action_scope(user, "edit")
    if scope == "none" or (scope == "team" and user.team_id is None):
        raise HTTPException(403, "Для работы с поручениями требуется право редактирования задач")
    return user


def owned(db, capture_id, user):
    row = db.query(MeetingCapture).filter_by(id=str(capture_id), owner_id=user.id).first()
    if row is None:
        raise HTTPException(404, "Разбор встречи не найден")
    return row


def task_scope(db, user):
    query = db.query(Task).filter(task_read_scope_clause(user, Task), Task.is_deleted.is_(False))
    if get_task_action_scope(user, "edit") != "all":
        query = query.filter(Task.team_id == user.team_id)
    return query


def validate_links(db, user, items):
    for task_id in {item.task_id for item in items if item.task_id is not None}:
        task = db.query(Task).filter_by(id=task_id).first()
        if task is None or task.is_deleted or not can_access_task("read", task, user) or not can_access_task("edit", task, user):
            raise HTTPException(403, "Выбранная крупная задача недоступна. Измените привязку.")


def snapshot(db, row, user):
    data = {key: getattr(row, key) for key in
            ("id", "title", "meeting_date", "transcript", "items", "version", "status", "updated_at")}
    ids = {item.get("task_id") for item in row.items if item.get("task_id")}
    data["links"] = [{"id": task.id, "public_id": task.public_id, "title": task.title}
                     for task in task_scope(db, user).filter(Task.id.in_(ids)).all()] if ids else []
    data["saved_count"] = db.query(MeetingAction).filter_by(capture_id=row.id).count()
    return {**data, **analysis_info(row)}


def change_draft(db, row, version, values):
    count = db.query(MeetingCapture).filter_by(id=row.id, owner_id=row.owner_id,
        version=version, status="draft").filter(~MeetingCapture.analysis_status.in_(ACTIVE)).update({**values, "version": version + 1,
            "updated_at": datetime.now(timezone.utc)}, synchronize_session=False)
    if count != 1:
        db.rollback()
        raise HTTPException(409, "Разбор изменён или уже сохранён. Откройте его заново из истории.")


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db), user: User = Depends(editor)):
    rows = db.query(MeetingCapture).filter_by(owner_id=user.id).order_by(MeetingCapture.updated_at.desc()).limit(100).all()
    return [{"id": row.id, "title": row.title, "status": row.status, "updated_at": row.updated_at,
             "item_count": len(row.items), **analysis_info(row)} for row in rows]


@router.post("/sessions/{capture_id}")
def create_session(capture_id: UUID, req: MeetingDraft, db: Session = Depends(get_db), user: User = Depends(editor)):
    existing = db.query(MeetingCapture).filter_by(id=str(capture_id)).first()
    if existing:
        return snapshot(db, owned(db, capture_id, user), user)
    validate_links(db, user, req.items)
    row = MeetingCapture(id=str(capture_id), owner_id=user.id, **req.model_dump(exclude={"items"}),
                         items=[item.model_dump(mode="json") for item in req.items], version=1, status="draft")
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return snapshot(db, owned(db, capture_id, user), user)
    db.refresh(row)
    return snapshot(db, row, user)


@router.get("/sessions/{capture_id}")
def get_session(capture_id: UUID, db: Session = Depends(get_db), user: User = Depends(editor)):
    return snapshot(db, owned(db, capture_id, user), user)


@router.get("/sessions/{capture_id}/status")
def analysis_status(capture_id: UUID, db: Session = Depends(get_db), user: User = Depends(editor)):
    row = owned(db, capture_id, user)
    return {"id": row.id, "version": row.version, "status": row.status, **analysis_info(row)}


@router.put("/sessions/{capture_id}")
def update_session(capture_id: UUID, req: DraftUpdate, db: Session = Depends(get_db), user: User = Depends(editor)):
    row = owned(db, capture_id, user)
    validate_links(db, user, req.items)
    values = req.model_dump(exclude={"version", "items"})
    values["items"] = [item.model_dump(mode="json") for item in req.items]
    if req.transcript != row.transcript or req.meeting_date != row.meeting_date:
        values.update(analysis_status="idle", analysis_run_id=None, analysis_requested_at=None,
            analysis_started_at=None, analysis_finished_at=None, analysis_error_code=None)
    change_draft(db, row, req.version, values)
    db.commit()
    db.refresh(row)
    return snapshot(db, row, user)


@router.post("/sessions/{capture_id}/analyze", status_code=202)
def analyze_session(capture_id: UUID, req: VersionRequest, db: Session = Depends(get_db), user: User = Depends(editor)):
    row = owned(db, capture_id, user)
    if row.analysis_status in (*ACTIVE, "completed"):
        return snapshot(db, row, user)  # Lost responses and repeated clicks never enqueue again.
    if row.status != "draft" or row.version != req.version:
        raise HTTPException(409, "Разбор изменён. Откройте его заново из истории.")
    if row.items:
        raise HTTPException(409, "Разбор уже содержит пункты. Повторный анализ может затереть правки; создайте новый разбор.")
    if not row.transcript.strip():
        raise HTTPException(422, "Добавьте текст расшифровки")
    prior_operation_id = row.analysis_run_id if row.analysis_backend == "meeting-analyzer" and row.analysis_status in ("failed","cancelled") else None
    prior_service_run_id = row.analysis_service_run_id if prior_operation_id else None
    try:
        from config import settings
        operation_id, requested_at = str(uuid4()), datetime.now(timezone.utc)
        change_draft(db, row, req.version, {"analysis_status": "queued", "analysis_run_id": operation_id,
            "analysis_backend": "meeting-analyzer" if settings.MEETING_ANALYZER_ENABLED else "legacy",
            "analysis_service_run_id": None, "analysis_ack_pending": False,
            "analysis_requested_at": requested_at, "analysis_started_at": None,
            "analysis_finished_at": None, "analysis_error_code": None})
    except HTTPException:
        db.refresh(row)
        if row.analysis_status in (*ACTIVE, "completed"):
            return snapshot(db, row, user)
        raise
    if settings.MEETING_ANALYZER_ENABLED:
        from services.meeting_service_delivery import create_intent
        create_intent(db, {"id": row.id, "owner_id": row.owner_id, "transcript": row.transcript,
            "meeting_date": row.meeting_date, "version": req.version + 1,
            "analysis_run_id": operation_id, "analysis_requested_at": requested_at,
            "retry_operation_id": prior_operation_id, "retry_service_run_id": prior_service_run_id})
    db.commit()
    db.refresh(row)
    return snapshot(db, row, user)


@router.get("/tasks")
def search_tasks(q: str = Query(min_length=2, max_length=255), db: Session = Depends(get_db), user: User = Depends(editor)):
    pattern = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = task_scope(db, user).filter(or_(db_lower(Task.title).like(pattern, escape="\\"),
        db_lower(Task.public_id).like(pattern, escape="\\"))).order_by(Task.id.desc()).limit(20).all()
    return [{"id": row.id, "public_id": row.public_id, "title": row.title} for row in rows]


@router.post("/suggestions")
def suggest_tasks(req: MeetingItem, db: Session = Depends(get_db), user: User = Depends(editor)):
    tokens = sorted(terms(req.title + " " + req.description))[:30]
    if not tokens:
        return []
    clauses = [or_(db_lower(Task.title).contains(token), db_lower(Task.description).contains(token)) for token in tokens]
    rows = task_scope(db, user).filter(or_(*clauses)).order_by(Task.id.desc()).limit(500).all()
    return rank_tasks(req.title + " " + req.description, rows)


@router.post("/sessions/{capture_id}/confirm")
def confirm_session(capture_id: UUID, req: VersionRequest, db: Session = Depends(get_db), user: User = Depends(editor)):
    row = owned(db, capture_id, user)
    if row.status == "saved":
        return snapshot(db, row, user)  # Retry after response loss is safe.
    if row.analysis_status in ACTIVE:
        raise HTTPException(409, "Анализ ещё выполняется. Дождитесь результата.")
    draft = MeetingDraft(title=row.title, meeting_date=row.meeting_date, transcript=row.transcript, items=row.items)
    try:
        items = confirmed_items(draft)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    validate_links(db, user, items)
    change_draft(db, row, req.version, {"status": "saved"})
    for item in items:
        values = item.model_dump(exclude={"id", "selected", "link_choice"})
        db.add(MeetingAction(capture_id=row.id, item_id=item.id, **values))
    db.commit()  # Status and all actions commit atomically.
    db.refresh(row)
    return snapshot(db, row, user)
