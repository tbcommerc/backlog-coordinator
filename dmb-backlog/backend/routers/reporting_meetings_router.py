"""API календаря отчётных встреч и статусов задач."""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import authorize_task, check_permission, get_current_user, require_permission
from database import get_db
from models import ReportingMeeting, ReportingMeetingHistory, Task, TaskReportingStatus, Team, User
from reporting_meetings import (
    MEETING_KINDS,
    active_tasks,
    can_fill_team_reporting_status,
    cancel_meeting,
    complete_meeting,
    create_meeting_instance,
    current_meeting,
    ensure_reporting_schedule,
    meeting_to_dict,
    previous_meeting,
    save_task_reporting_status,
    schedule_meeting,
    task_reporting_context,
    validate_meeting_kind,
    weekly_reporting_tasks,
)


router = APIRouter()
task_router = APIRouter()


def _can_fill_status(user: User, task: Task) -> bool:
    """Статусы заполняют администраторы или участники ответственной команды."""
    is_admin = bool(getattr(user, "role", None)) and check_permission(user, "admin", "full")
    return is_admin or can_fill_team_reporting_status(user, task.team)


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


class WeeklyStatusPayload(BaseModel):
    signal: str = Field("on_track", pattern="^(on_track|risk|blocker|decision)$")
    next_step: Optional[str] = Field(None, max_length=2000)
    next_step_due: Optional[date] = None
    decision_request: Optional[str] = Field(None, max_length=2000)


class ReportingStatusUpdate(BaseModel):
    text: Optional[str] = Field(None, max_length=5000)
    did_demo: bool = False
    is_ready: bool = False
    directorate_attention: Optional[bool] = None
    weekly: Optional[WeeklyStatusPayload] = None
    version: Optional[int] = Field(None, ge=0)


class ReportingStatusBatchItem(ReportingStatusUpdate):
    task_id: int = Field(gt=0)


class ReportingStatusBatchUpdate(BaseModel):
    items: List[ReportingStatusBatchItem] = Field(min_length=1, max_length=500)


class DirectorateAttentionUpdate(BaseModel):
    enabled: bool
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


def _reporting_status_to_dict(row: TaskReportingStatus) -> dict:
    return {
        "id": row.id,
        "meeting_id": row.meeting_id,
        "task_id": row.task_id,
        "text": row.status_text or "",
        "did_demo": bool(row.did_demo),
        "is_ready": bool(row.is_ready),
        "directorate_attention": bool(row.directorate_attention),
        "weekly": row.weekly_payload,
        "progress_snapshot": row.progress_snapshot,
        "task_status_snapshot": row.task_status_snapshot,
        "source": row.source,
        "version": row.version or 0,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _meeting_with_history(
    db: Session,
    meeting: ReportingMeeting,
    *,
    include_completeness: bool = True,
) -> dict:
    result = meeting_to_dict(db, meeting, include_completeness=include_completeness)
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
    include_completeness: bool = Query(True),
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
        "items": [
            _meeting_with_history(db, meeting, include_completeness=include_completeness)
            for meeting in meetings
        ],
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
    current_user: User = Depends(get_current_user),
):
    meeting = _meeting_or_404(db, meeting_id)
    is_admin = check_permission(current_user, "admin", "full")
    if not is_admin:
        if current_user.team_id is None:
            raise HTTPException(status_code=403, detail="Заполнение статусов доступно только участникам команды")
        team = db.query(Team).filter(Team.id == current_user.team_id).first()
        if not can_fill_team_reporting_status(current_user, team):
            raise HTTPException(status_code=403, detail="Заполнение статусов доступно PO/PL/CL и BA/участникам своей команды")
    tasks = (
        weekly_reporting_tasks(
            db,
            meeting.scheduled_date,
            team_id=None if is_admin else current_user.team_id,
        )
        if meeting.kind == "team_weekly" and meeting.scheduled_date
        else active_tasks(db, team_id=None if is_admin else current_user.team_id)
    )
    expected = current_meeting(db, meeting.kind)
    previous = previous_meeting(db, meeting.kind)
    rows = {row.task_id: row for row in db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == meeting.id
    ).all()}
    previous_rows = {row.task_id: row for row in db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == previous.id
    ).all()} if previous else {}
    items = []
    for task in tasks:
        row = rows.get(task.id)
        previous_row = previous_rows.get(task.id)
        filled = bool(row and row.is_ready)
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
            "is_ready": filled,
            "directorate_attention": bool(row.directorate_attention) if row else False,
            "weekly": (
                (row.weekly_payload if row and row.weekly_payload else {
                    "signal": "on_track",
                    "next_step": "",
                    "next_step_due": None,
                    "decision_request": "",
                })
                if meeting.kind == "team_weekly" else None
            ),
            "progress": task.progress,
            "progress_updated_at": task.progress_updated_at.isoformat() if task.progress_updated_at else None,
            "status_name": task.status.name if task.status else None,
            "priority_name": task.priority.name if task.priority else None,
            "project_name": task.project.name if task.project else None,
            "owner_name": task.owner.name if task.owner else None,
            "deadline_name": task.deadline.name if task.deadline else None,
            "previous_status": {
                "text": previous_row.status_text or "",
                "did_demo": bool(previous_row.did_demo),
                "weekly": previous_row.weekly_payload,
                "progress_snapshot": previous_row.progress_snapshot,
                "task_status_snapshot": previous_row.task_status_snapshot,
                "meeting_date": previous.scheduled_date.isoformat() if previous and previous.scheduled_date else None,
            } if previous_row else None,
            "version": row.version or 0 if row else 0,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
            "updated_by_name": row.updater.name if row and row.updater else None,
            "filled": filled,
            "can_edit": bool(
                expected
                and expected.id == meeting.id
                and meeting.state == "planned"
                and meeting.scheduled_date
                and _can_fill_status(current_user, task)
            ),
        })
    items.sort(key=lambda item: (not bool(item["previous_status"] and item["previous_status"]["text"].strip()), item["filled"], item["public_id"]))
    filled_count = sum(1 for item in items if item["filled"])
    return {
        "meeting": meeting_to_dict(db, meeting),
        "items": items,
        "summary": {
            "total_tasks": len(items),
            "filled_tasks": filled_count,
            "missing_tasks": len(items) - filled_count,
        },
        "scope": {
            "team_id": None if is_admin else current_user.team_id,
            "team_name": None if is_admin else current_user.team_name,
            "read_only": not any(item["can_edit"] for item in items),
        },
    }


@router.put("/{meeting_id}/statuses/batch")
def update_reporting_statuses_batch(
    meeting_id: int,
    payload: ReportingStatusBatchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Atomically save several task statuses for one current meeting."""
    meeting = _meeting_or_404(db, meeting_id)
    expected = current_meeting(db, meeting.kind)
    if not expected or expected.id != meeting.id:
        raise HTTPException(status_code=409, detail="Эта встреча больше не является ближайшей для заполнения")

    task_ids = [item.task_id for item in payload.items]
    if len(task_ids) != len(set(task_ids)):
        raise HTTPException(status_code=400, detail="Задача не должна повторяться в массовом запросе")
    tasks = {
        task.id: task
        for task in db.query(Task).filter(Task.id.in_(task_ids), Task.is_deleted == False).all()
    }
    missing_ids = [task_id for task_id in task_ids if task_id not in tasks]
    if missing_ids:
        raise HTTPException(status_code=404, detail={"message": "Задачи не найдены", "task_ids": missing_ids})
    denied_ids = [task_id for task_id in task_ids if not _can_fill_status(current_user, tasks[task_id])]
    if denied_ids:
        raise HTTPException(status_code=403, detail={"message": "Нет доступа к отчётным статусам", "task_ids": denied_ids})

    saved = []
    try:
        for item in payload.items:
            saved.append(save_task_reporting_status(
                db,
                task=tasks[item.task_id],
                meeting=meeting,
                status_text=item.text,
                did_demo=item.did_demo,
                is_ready=item.is_ready,
                submitted_version=item.version,
                user_id=current_user.id,
                directorate_attention=item.directorate_attention,
                weekly_payload=item.weekly.model_dump(mode="json") if item.weekly else None,
            ))
        db.commit()
        for row in saved:
            db.refresh(row)
    except RuntimeError as exc:
        db.rollback()
        if str(exc) == "version_conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Один из статусов изменён другим пользователем. Пакет не сохранён.",
            )
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    return {"items": [_reporting_status_to_dict(row) for row in saved], "saved_count": len(saved)}


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
            is_ready=payload.is_ready,
            submitted_version=payload.version,
            user_id=current_user.id,
            directorate_attention=payload.directorate_attention,
            weekly_payload=payload.weekly.model_dump(mode="json") if payload.weekly else None,
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
    return _reporting_status_to_dict(row)


@task_router.put("/{task_id}/reporting-statuses/{meeting_id}/directorate-attention")
def update_directorate_attention(
    task_id: int,
    meeting_id: int,
    payload: DirectorateAttentionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if not _can_fill_status(current_user, task):
        raise HTTPException(status_code=403, detail="Маркер меняют участники ответственной команды")
    meeting = _meeting_or_404(db, meeting_id)
    expected = current_meeting(db, meeting.kind)
    if meeting.kind != "directorate":
        raise HTTPException(status_code=400, detail="Маркер доступен только для директорской оперативки")
    if not expected or expected.id != meeting.id or meeting.state != "planned":
        raise HTTPException(status_code=409, detail="Эта встреча больше не доступна для изменения")
    row = db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == meeting.id,
        TaskReportingStatus.task_id == task.id,
    ).first()
    if not row or not row.is_ready or not str(row.status_text or "").strip():
        raise HTTPException(status_code=400, detail="Сначала заполните и подтвердите готовность статуса")
    if payload.version is not None and payload.version != (row.version or 0):
        raise HTTPException(status_code=409, detail="Статус уже изменён другим пользователем")
    row.directorate_attention = payload.enabled
    row.updated_by = current_user.id
    row.version = (row.version or 0) + 1
    db.commit()
    db.refresh(row)
    return {
        "task_id": task.id,
        "meeting_id": meeting.id,
        "directorate_attention": bool(row.directorate_attention),
        "version": row.version or 0,
    }
