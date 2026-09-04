"""API календаря отчётных встреч и статусов задач."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import authorize_task, check_permission, get_current_user, require_permission
from database import get_db
from models import ReportingMeeting, ReportingMeetingHistory, Task, TaskReportingStatus, User
from reporting_meetings import (
    MEETING_KINDS,
    cancel_meeting,
    complete_meeting,
    create_meeting_instance,
    current_meeting,
    ensure_reporting_schedule,
    meeting_to_dict,
    save_task_reporting_status,
    schedule_meeting,
    task_reporting_context,
    validate_meeting_kind,
)


router = APIRouter()
task_router = APIRouter()


def _can_fill_status(user: User, task: Task) -> bool:
    """Статусы заполняют назначенные PO/PL/CL ответственной команды."""
    team = task.team
    return bool(team and user.id in {team.po_id, team.pl_id, team.cl_id})


class MeetingDateCommand(BaseModel):
    scheduled_date: date
    reason: Optional[str] = Field(None, max_length=2000)
    version: Optional[int] = Field(None, ge=0)


class MeetingCreateCommand(BaseModel):
    kind: str
    scheduled_date: date


class MeetingCancelCommand(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    version: Optional[int] = Field(None, ge=0)


class MeetingCompleteCommand(BaseModel):
    version: Optional[int] = Field(None, ge=0)
    force: bool = False


class ReportingStatusUpdate(BaseModel):
    text: Optional[str] = Field(None, max_length=5000)
    did_demo: bool = False
    version: Optional[int] = Field(None, ge=0)


def _meeting_or_404(db: Session, meeting_id: int) -> ReportingMeeting:
    meeting = db.query(ReportingMeeting).filter(ReportingMeeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Отчётная встреча не найдена")
    return meeting


def _history_to_dict(row: ReportingMeetingHistory) -> dict:
    return {
        "id": row.id,
        "action": row.action,
        "old_state": row.old_state,
        "new_state": row.new_state,
        "old_date": row.old_date.isoformat() if row.old_date else None,
        "new_date": row.new_date.isoformat() if row.new_date else None,
        "reason": row.reason,
        "changed_at": row.changed_at.isoformat() if row.changed_at else None,
        "changed_by_name": row.changer.name if row.changer else None,
    }


def _meeting_with_history(db: Session, meeting: ReportingMeeting) -> dict:
    result = meeting_to_dict(db, meeting)
    rows = sorted(
        meeting.history or [],
        key=lambda row: ((row.changed_at.isoformat() if row.changed_at else ""), row.id or 0),
        reverse=True,
    )
    result["history"] = [_history_to_dict(row) for row in rows]
    return result


def _commit_or_http(db: Session, operation):
    try:
        result = operation()
        db.commit()
        db.refresh(result)
        return result
    except RuntimeError as exc:
        db.rollback()
        if str(exc) == "version_conflict":
            raise HTTPException(status_code=409, detail="Данные встречи были изменены другим пользователем")
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("")
def list_reporting_meetings(
    kind: Optional[str] = Query(None),
    include_closed: bool = Query(True),
    state: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ensure_reporting_schedule(db)
    query = db.query(ReportingMeeting)
    if kind:
        try:
            query = query.filter(ReportingMeeting.kind == validate_meeting_kind(kind))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if not include_closed:
        query = query.filter(ReportingMeeting.state.in_(("date_pending", "planned")))
    if state:
        states = {item.strip() for item in state.split(",") if item.strip()}
        unknown = states.difference({"date_pending", "planned", "held", "cancelled"})
        if unknown:
            raise HTTPException(status_code=400, detail="Неизвестное состояние отчётной встречи")
        query = query.filter(ReportingMeeting.state.in_(states))
    if date_from:
        query = query.filter(ReportingMeeting.scheduled_date >= date_from)
    if date_to:
        query = query.filter(ReportingMeeting.scheduled_date <= date_to)
    meetings = query.all()
    db.commit()
    meetings.sort(key=lambda item: (item.scheduled_date is None, item.scheduled_date or date.max, item.id))
    return {
        "items": [_meeting_with_history(db, meeting) for meeting in meetings],
        "can_manage": check_permission(current_user, "admin", "full"),
        "can_prepare": check_permission(current_user, "admin", "full"),
    }


@router.get("/{meeting_id}/history")
def get_reporting_meeting_history(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    meeting = _meeting_or_404(db, meeting_id)
    rows = db.query(ReportingMeetingHistory).filter(
        ReportingMeetingHistory.meeting_id == meeting.id
    ).order_by(ReportingMeetingHistory.changed_at.desc(), ReportingMeetingHistory.id.desc()).all()
    return {
        "meeting": meeting_to_dict(db, meeting),
        "items": [_history_to_dict(row) for row in rows],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_reporting_meeting(
    payload: MeetingCreateCommand,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full")),
):
    result = _commit_or_http(db, lambda: create_meeting_instance(
        db,
        payload.kind,
        payload.scheduled_date,
        user_id=current_user.id,
    ))
    return meeting_to_dict(db, result)


@router.get("/{meeting_id}/preparation")
def get_reporting_meeting_preparation(
    meeting_id: int,
    missing_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full")),
):
    meeting = _meeting_or_404(db, meeting_id)
    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    rows = {row.task_id: row for row in db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == meeting.id
    ).all()}
    items = []
    for task in tasks:
        row = rows.get(task.id)
        filled = bool(row and str(row.status_text or "").strip())
        if missing_only and filled:
            continue
        items.append({
            "task_id": task.id,
            "public_id": task.public_id or str(task.id),
            "title": task.title,
            "team_id": task.team_id,
            "team_name": task.team.name if task.team else None,
            "text": row.status_text if row else "",
            "did_demo": bool(row.did_demo) if row else False,
            "version": row.version or 0 if row else 0,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
            "updated_by_name": row.updater.name if row and row.updater else None,
            "revisions": [{
                "id": revision.id,
                "old_text": revision.old_text or "",
                "new_text": revision.new_text or "",
                "changed_at": revision.changed_at.isoformat() if revision.changed_at else None,
                "changed_by_name": revision.changer.name if revision.changer else None,
            } for revision in sorted((row.revisions if row else []), key=lambda item: item.id, reverse=True)],
            "filled": filled,
            "can_edit": False,
        })
    items.sort(key=lambda item: (item["filled"], item["team_name"] or "", item["public_id"]))
    return {"meeting": meeting_to_dict(db, meeting), "items": items}


@router.post("/{meeting_id}/schedule")
def assign_or_reschedule_meeting(
    meeting_id: int,
    payload: MeetingDateCommand,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full")),
):
    meeting = _meeting_or_404(db, meeting_id)
    result = _commit_or_http(db, lambda: schedule_meeting(
        db,
        meeting,
        payload.scheduled_date,
        reason=payload.reason,
        user_id=current_user.id,
        submitted_version=payload.version,
    ))
    return meeting_to_dict(db, result)


@router.post("/{meeting_id}/complete")
def mark_meeting_completed(
    meeting_id: int,
    payload: MeetingCompleteCommand,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full")),
):
    meeting = _meeting_or_404(db, meeting_id)
    result = _commit_or_http(db, lambda: complete_meeting(
        db,
        meeting,
        user_id=current_user.id,
        submitted_version=payload.version,
        force=payload.force,
    ))
    return meeting_to_dict(db, result)


@router.post("/{meeting_id}/cancel")
def mark_meeting_cancelled(
    meeting_id: int,
    payload: MeetingCancelCommand,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full")),
):
    meeting = _meeting_or_404(db, meeting_id)
    result = _commit_or_http(db, lambda: cancel_meeting(
        db,
        meeting,
        reason=payload.reason,
        user_id=current_user.id,
        submitted_version=payload.version,
    ))
    return meeting_to_dict(db, result)


@task_router.get("/{task_id}/reporting-statuses/context")
def get_task_reporting_context(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    authorize_task("read", task, current_user)
    can_fill = _can_fill_status(current_user, task)
    result = task_reporting_context(db, task, can_fill)
    db.commit()
    return result


@task_router.put("/{task_id}/reporting-statuses/{meeting_id}")
def update_task_reporting_status(
    task_id: int,
    meeting_id: int,
    payload: ReportingStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if not _can_fill_status(current_user, task):
        raise HTTPException(status_code=403, detail="Отчётный статус заполняют участники ответственной команды")
    meeting = _meeting_or_404(db, meeting_id)
    expected = current_meeting(db, meeting.kind)
    if not expected or expected.id != meeting.id:
        raise HTTPException(status_code=409, detail="Эта встреча больше не является ближайшей для заполнения")
    try:
        row = save_task_reporting_status(
            db,
            task=task,
            meeting=meeting,
            status_text=payload.text,
            did_demo=payload.did_demo,
            submitted_version=payload.version,
            user_id=current_user.id,
        )
        db.commit()
        db.refresh(row)
    except RuntimeError as exc:
        db.rollback()
        if str(exc) == "version_conflict":
            current = db.query(TaskReportingStatus).filter(
                TaskReportingStatus.meeting_id == meeting_id,
                TaskReportingStatus.task_id == task_id,
            ).first()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Статус изменён другим пользователем",
                    "current_text": current.status_text if current else None,
                    "current_version": current.version if current else 0,
                },
            )
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "id": row.id,
        "meeting_id": row.meeting_id,
        "task_id": row.task_id,
        "text": row.status_text or "",
        "did_demo": bool(row.did_demo),
        "source": row.source,
        "version": row.version or 0,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
