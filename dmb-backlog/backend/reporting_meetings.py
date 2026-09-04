"""Доменная логика отчётных встреч и статусов задач."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import (
    Notification,
    ReportingMeeting,
    ReportingMeetingHistory,
    Role,
    Task,
    TaskReportingStatus,
    TaskReportingStatusRevision,
    TaskStatus,
    Team,
    User,
)


MEETING_KINDS = ("directorate", "did", "key_projects")
MEETING_TITLES = {
    "directorate": "Директорская оперативка",
    "did": "Оперативка ДИД",
    "key_projects": "Встреча по ключевым проектам",
}
MEETING_STATES = ("date_pending", "planned", "held", "cancelled")
OPEN_MEETING_STATES = ("date_pending", "planned")
CLOSED_TASK_STATUSES = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")

LEGACY_FIELDS = {
    "directorate": ("directorate_status", "prev_directorate_status", "directorate_status_updated_at"),
    "did": ("did_status", "prev_did_status", "did_status_updated_at"),
    "key_projects": ("key_project_status", "prev_key_project_status", "key_project_status_updated_at"),
}


def validate_meeting_kind(kind: str) -> str:
    normalized = str(kind or "").strip().lower()
    if normalized not in MEETING_KINDS:
        raise ValueError("Неизвестный тип отчётной встречи")
    return normalized


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _active_tasks_query(db: Session):
    return db.query(Task).outerjoin(TaskStatus, Task.status_id == TaskStatus.id).filter(
        Task.is_deleted == False,
        or_(TaskStatus.id == None, TaskStatus.name.notin_(CLOSED_TASK_STATUSES)),
    )


def active_tasks(db: Session) -> list[Task]:
    return _active_tasks_query(db).all()


def _next_weekday(day: date, weekday: int) -> date:
    return day + timedelta(days=(weekday - day.weekday()) % 7)


def _create_meeting(
    db: Session,
    kind: str,
    occurrence_key: str,
    scheduled_date: date | None,
    *,
    created_by: int | None = None,
) -> ReportingMeeting:
    meeting = ReportingMeeting(
        kind=kind,
        occurrence_key=occurrence_key,
        scheduled_date=scheduled_date,
        original_scheduled_date=scheduled_date,
        state="planned" if scheduled_date else "date_pending",
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(meeting)
    db.flush()
    return meeting


def _ensure_directorate_meetings(db: Session, today: date, horizon_days: int) -> None:
    horizon = today + timedelta(days=horizon_days)
    meetings = db.query(ReportingMeeting).filter(
        ReportingMeeting.kind == "directorate",
        ReportingMeeting.original_scheduled_date.isnot(None),
    ).all()
    known_dates = {m.original_scheduled_date for m in meetings}
    cursor = _next_weekday(today, 0)
    while cursor <= horizon:
        if cursor not in known_dates:
            _create_meeting(db, "directorate", f"directorate-{cursor.isoformat()}", cursor)
        cursor += timedelta(days=7)


def _ensure_did_meetings(db: Session, today: date, horizon_days: int) -> None:
    meetings = db.query(ReportingMeeting).filter(ReportingMeeting.kind == "did").all()
    dated = [m for m in meetings if m.original_scheduled_date or m.scheduled_date]
    if not dated:
        if not any(m.state in OPEN_MEETING_STATES for m in meetings):
            _create_meeting(db, "did", "did-initial-date", None)
        return

    anchor = max((m.original_scheduled_date or m.scheduled_date) for m in dated)
    horizon = today + timedelta(days=horizon_days)
    known_dates = {m.original_scheduled_date or m.scheduled_date for m in dated}
    cursor = anchor + timedelta(days=14)
    while cursor <= horizon:
        if cursor not in known_dates:
            _create_meeting(db, "did", f"did-{cursor.isoformat()}", cursor)
        cursor += timedelta(days=14)


def _ensure_key_projects_meeting(db: Session) -> None:
    current = db.query(ReportingMeeting).filter(
        ReportingMeeting.kind == "key_projects",
        ReportingMeeting.state.in_(OPEN_MEETING_STATES),
    ).first()
    if current:
        return
    count = db.query(ReportingMeeting).filter(ReportingMeeting.kind == "key_projects").count()
    _create_meeting(db, "key_projects", f"key-projects-{count + 1}", None)


def _current_meeting(db: Session, kind: str) -> ReportingMeeting | None:
    meetings = db.query(ReportingMeeting).filter(
        ReportingMeeting.kind == kind,
        ReportingMeeting.state.in_(OPEN_MEETING_STATES),
    ).all()
    if not meetings:
        return None
    return min(
        meetings,
        key=lambda m: (m.scheduled_date is None, m.scheduled_date or date.max, m.id),
    )


def _previous_meeting(db: Session, kind: str) -> ReportingMeeting | None:
    meetings = db.query(ReportingMeeting).filter(
        ReportingMeeting.kind == kind,
        ReportingMeeting.state == "held",
    ).all()
    if not meetings:
        return None
    return max(meetings, key=lambda m: ((m.held_at.replace(tzinfo=None) if m.held_at else datetime.min), m.id))


def current_meeting(db: Session, kind: str) -> ReportingMeeting | None:
    return _current_meeting(db, validate_meeting_kind(kind))


def _backfill_current_legacy_statuses(db: Session) -> None:
    """Однократно переносить legacy-current в ближайшую незавершённую встречу."""
    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    for kind in MEETING_KINDS:
        meeting = _current_meeting(db, kind)
        if not meeting:
            continue
        current_field, _, _ = LEGACY_FIELDS[kind]
        existing_task_ids = {
            row[0] for row in db.query(TaskReportingStatus.task_id).filter(
                TaskReportingStatus.meeting_id == meeting.id
            ).all()
        }
        for task in tasks:
            value = getattr(task, current_field, None)
            if task.id in existing_task_ids or not str(value or "").strip():
                continue
            db.add(TaskReportingStatus(
                meeting_id=meeting.id,
                task_id=task.id,
                status_text=str(value),
                did_demo=bool(task.did_demo) if kind == "did" else False,
                source="legacy_import",
            ))
    db.flush()


def ensure_reporting_schedule(db: Session, today: date | None = None, horizon_days: int = 90) -> None:
    today = today or date.today()
    _ensure_directorate_meetings(db, today, horizon_days)
    _ensure_did_meetings(db, today, horizon_days)
    _ensure_key_projects_meeting(db)
    db.flush()
    _backfill_current_legacy_statuses(db)


def meeting_completeness(db: Session, meeting: ReportingMeeting) -> dict:
    tasks = active_tasks(db)
    task_ids = {task.id for task in tasks}
    rows = db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == meeting.id,
        TaskReportingStatus.task_id.in_(task_ids or {-1}),
    ).all()
    filled_ids = {row.task_id for row in rows if str(row.status_text or "").strip()}
    missing_teams = {}
    for task in tasks:
        if task.id in filled_ids:
            continue
        team = task.team or db.query(Team).filter(Team.id == task.team_id).first()
        if team:
            missing_teams[team.id] = {uid for uid in (team.po_id, team.pl_id, team.cl_id) if uid}
    candidate_ids = set().union(*missing_teams.values()) if missing_teams else set()
    active_ids = {
        row[0] for row in db.query(User.id).filter(
            User.id.in_(candidate_ids or {-1}), User.is_active == True
        ).all()
    }
    teams_without_recipients = {
        team_id for team_id, responsible_ids in missing_teams.items()
        if not responsible_ids.intersection(active_ids)
    }
    return {
        "total_tasks": len(tasks),
        "filled_tasks": len(filled_ids),
        "missing_tasks": max(0, len(tasks) - len(filled_ids)),
        "teams_without_recipients": len(teams_without_recipients),
    }


def meeting_to_dict(db: Session, meeting: ReportingMeeting, *, include_completeness: bool = True) -> dict:
    result = {
        "id": meeting.id,
        "kind": meeting.kind,
        "title": MEETING_TITLES[meeting.kind],
        "occurrence_key": meeting.occurrence_key,
        "scheduled_date": meeting.scheduled_date.isoformat() if meeting.scheduled_date else None,
        "original_scheduled_date": meeting.original_scheduled_date.isoformat() if meeting.original_scheduled_date else None,
        "state": meeting.state,
        "change_reason": meeting.change_reason,
        "held_at": meeting.held_at.isoformat() if meeting.held_at else None,
        "cancelled_at": meeting.cancelled_at.isoformat() if meeting.cancelled_at else None,
        "version": meeting.version or 0,
        "is_overdue": bool(
            meeting.state == "planned" and meeting.scheduled_date and meeting.scheduled_date < date.today()
        ),
    }
    if include_completeness:
        result.update(meeting_completeness(db, meeting))
    return result


def validate_completion_readiness(completeness: dict, *, force: bool) -> None:
    missing = int(completeness.get("missing_tasks") or 0)
    if missing and not force:
        raise ValueError(
            f"Не заполнено задач: {missing}. "
            "Подтвердите завершение встречи с неполными статусами"
        )


def task_reporting_context(db: Session, task: Task, can_edit: bool) -> dict:
    ensure_reporting_schedule(db)
    result = []
    for kind in MEETING_KINDS:
        current = _current_meeting(db, kind)
        previous = _previous_meeting(db, kind)
        current_status = None
        previous_status = None
        if current:
            current_status = db.query(TaskReportingStatus).filter(
                TaskReportingStatus.meeting_id == current.id,
                TaskReportingStatus.task_id == task.id,
            ).first()
        if previous:
            previous_status = db.query(TaskReportingStatus).filter(
                TaskReportingStatus.meeting_id == previous.id,
                TaskReportingStatus.task_id == task.id,
            ).first()
        current_field, previous_field, updated_field = LEGACY_FIELDS[kind]
        legacy_current = getattr(task, current_field, None) if current_status is None else None
        legacy_previous = getattr(task, previous_field, None) if previous is None else None
        result.append({
            "kind": kind,
            "title": MEETING_TITLES[kind],
            "current_meeting": meeting_to_dict(db, current, include_completeness=False) if current else None,
            "previous_meeting": meeting_to_dict(db, previous, include_completeness=False) if previous else None,
            "current_status": {
                "id": current_status.id,
                "text": current_status.status_text or "",
                "did_demo": bool(current_status.did_demo),
                "source": current_status.source,
                "version": current_status.version or 0,
                "updated_at": current_status.updated_at.isoformat() if current_status.updated_at else None,
                "updated_by_name": current_status.updater.name if current_status.updater else None,
            } if current_status else ({
                "id": None,
                "text": str(legacy_current or ""),
                "did_demo": bool(task.did_demo) if kind == "did" else False,
                "source": "legacy_task",
                "version": 0,
                "updated_at": (
                    getattr(task, updated_field).isoformat()
                    if getattr(task, updated_field, None) else None
                ),
                "updated_by_name": None,
                "legacy": True,
            } if legacy_current else None),
            "previous_status": {
                "text": previous_status.status_text or "",
                "did_demo": bool(previous_status.did_demo),
                "provided": bool(str(previous_status.status_text or "").strip()),
            } if previous_status else ({
                "text": str(legacy_previous or ""),
                "did_demo": False,
                "provided": bool(str(legacy_previous or "").strip()),
                "legacy": True,
            } if legacy_previous else None),
            "can_edit": bool(can_edit and current and current.state == "planned" and current.scheduled_date),
            "edit_reason": (
                "Ближайшая встреча ещё не создана"
                if not current else
                "Заполнение откроется после назначения даты проектным офисом"
                if current.state == "date_pending" or not current.scheduled_date else
                "Статус могут изменять только назначенные PO/PL/CL ответственной команды"
                if not can_edit else None
            ),
        })
    return {"task_id": task.id, "items": result}


def save_task_reporting_status(
    db: Session,
    *,
    task: Task,
    meeting: ReportingMeeting,
    status_text: str | None,
    did_demo: bool,
    submitted_version: int | None,
    user_id: int,
) -> TaskReportingStatus:
    if meeting.state != "planned" or not meeting.scheduled_date:
        raise ValueError("Заполнение откроется после назначения даты встречи")
    if meeting.state not in OPEN_MEETING_STATES:
        raise ValueError("Статус проведённой или отменённой встречи нельзя изменить")
    text = str(status_text or "").strip()
    if len(text) > 5000:
        raise ValueError("Отчётный статус не может быть длиннее 5000 символов")
    row = db.query(TaskReportingStatus).filter(
        TaskReportingStatus.meeting_id == meeting.id,
        TaskReportingStatus.task_id == task.id,
    ).first()
    if row and submitted_version is not None and submitted_version != (row.version or 0):
        raise RuntimeError("version_conflict")
    if row is None:
        row = TaskReportingStatus(
            meeting_id=meeting.id,
            task_id=task.id,
            created_by=user_id,
            version=0,
        )
        db.add(row)
        db.flush()
    old_text = row.status_text
    old_demo = bool(row.did_demo)
    new_demo = bool(did_demo) if meeting.kind == "did" else False
    if old_text != text or old_demo != new_demo:
        db.add(TaskReportingStatusRevision(
            reporting_status_id=row.id,
            old_text=old_text,
            new_text=text or None,
            old_did_demo=old_demo,
            new_did_demo=new_demo,
            changed_by=user_id,
        ))
        row.status_text = text or None
        row.did_demo = new_demo
        row.updated_by = user_id
        row.source = "native"
        row.version = (row.version or 0) + 1

        current_field, _, updated_field = LEGACY_FIELDS[meeting.kind]
        setattr(task, current_field, row.status_text)
        setattr(task, updated_field, _utcnow())
        if meeting.kind == "did":
            task.did_demo = new_demo
    db.flush()
    if text:
        remaining, _ = _missing_tasks_by_recipient(db, meeting)
        if user_id not in remaining:
            now = _utcnow()
            db.query(Notification).filter(
                Notification.user_id == user_id,
                Notification.group_key == f"reporting_fill_{meeting.id}",
                Notification.is_resolved == False,
            ).update({
                Notification.is_resolved: True,
                Notification.resolved_at: now,
            }, synchronize_session=False)
    return row


def _meeting_history(
    db: Session,
    meeting: ReportingMeeting,
    action: str,
    *,
    user_id: int,
    old_state: str | None = None,
    old_date: date | None = None,
    reason: str | None = None,
) -> None:
    db.add(ReportingMeetingHistory(
        meeting_id=meeting.id,
        action=action,
        old_state=old_state,
        new_state=meeting.state,
        old_date=old_date,
        new_date=meeting.scheduled_date,
        reason=reason,
        changed_by=user_id,
    ))


def _resolve_fact_notifications(db: Session, meeting_id: int) -> None:
    now = _utcnow()
    db.query(Notification).filter(
        Notification.group_key == f"reporting_fact_{meeting_id}",
        Notification.is_resolved == False,
    ).update({Notification.is_resolved: True, Notification.resolved_at: now}, synchronize_session=False)


def _resolve_meeting_notifications(db: Session, meeting_id: int) -> None:
    now = _utcnow()
    db.query(Notification).filter(
        Notification.group_key.in_((f"reporting_fact_{meeting_id}", f"reporting_fill_{meeting_id}")),
        Notification.is_resolved == False,
    ).update({Notification.is_resolved: True, Notification.resolved_at: now}, synchronize_session=False)


def schedule_meeting(
    db: Session,
    meeting: ReportingMeeting,
    new_date: date,
    *,
    reason: str | None,
    user_id: int,
    submitted_version: int | None,
) -> ReportingMeeting:
    if meeting.state not in OPEN_MEETING_STATES:
        raise ValueError("Можно назначить или перенести только незавершённую встречу")
    if submitted_version is not None and submitted_version != (meeting.version or 0):
        raise RuntimeError("version_conflict")
    old_state, old_date = meeting.state, meeting.scheduled_date
    if new_date < date.today() and new_date != old_date:
        raise ValueError("Нельзя назначить встречу на прошедшую дату")
    if meeting.kind == "did" and old_date is None and new_date.weekday() != 1:
        raise ValueError("Первую дату оперативки ДИД нужно назначить на вторник")
    if old_date is not None and new_date != old_date and not str(reason or "").strip():
        raise ValueError("Укажите причину переноса встречи")
    if meeting.original_scheduled_date is None:
        meeting.original_scheduled_date = new_date
    meeting.scheduled_date = new_date
    meeting.state = "planned"
    meeting.change_reason = str(reason or "").strip() or None
    meeting.updated_by = user_id
    meeting.version = (meeting.version or 0) + 1
    meeting.team_reminder_sent_at = None
    meeting.admin_fact_notified_at = None
    _resolve_meeting_notifications(db, meeting.id)
    _meeting_history(db, meeting, "scheduled" if old_date is None else "rescheduled", user_id=user_id, old_state=old_state, old_date=old_date, reason=reason)
    db.flush()
    ensure_reporting_schedule(db)
    return meeting


def create_meeting_instance(
    db: Session,
    kind: str,
    scheduled_date: date,
    *,
    user_id: int,
) -> ReportingMeeting:
    kind = validate_meeting_kind(kind)
    if scheduled_date < date.today():
        raise ValueError("Нельзя добавить встречу на прошедшую дату")
    if kind == "directorate" and scheduled_date.weekday() != 0:
        raise ValueError("Новая директорская оперативка должна быть в понедельник")
    if kind == "did" and scheduled_date.weekday() != 1:
        raise ValueError("Новая оперативка ДИД должна быть во вторник")
    duplicate = db.query(ReportingMeeting).filter(
        ReportingMeeting.kind == kind,
        ReportingMeeting.scheduled_date == scheduled_date,
        ReportingMeeting.state.in_(OPEN_MEETING_STATES),
    ).first()
    if duplicate:
        raise ValueError("На эту дату уже запланирована встреча выбранного типа")
    meeting = _create_meeting(
        db,
        kind,
        f"manual-{uuid4()}",
        scheduled_date,
        created_by=user_id,
    )
    _meeting_history(db, meeting, "scheduled", user_id=user_id)
    return meeting


def complete_meeting(
    db: Session,
    meeting: ReportingMeeting,
    *,
    user_id: int,
    submitted_version: int | None,
    force: bool = False,
) -> ReportingMeeting:
    current = _current_meeting(db, meeting.kind)
    if not current or current.id != meeting.id:
        raise ValueError("Сначала актуализируйте ближайшую встречу этого типа")
    if meeting.state != "planned" or not meeting.scheduled_date:
        raise ValueError("Проведённой можно отметить только назначенную встречу")
    if meeting.scheduled_date > date.today():
        raise ValueError("Будущую встречу нельзя отметить состоявшейся")
    if submitted_version is not None and submitted_version != (meeting.version or 0):
        raise RuntimeError("version_conflict")
    validate_completion_readiness(meeting_completeness(db, meeting), force=force)
    old_state = meeting.state
    meeting.state = "held"
    meeting.held_at = _utcnow()
    meeting.updated_by = user_id
    meeting.version = (meeting.version or 0) + 1
    _meeting_history(db, meeting, "completed", user_id=user_id, old_state=old_state, old_date=meeting.scheduled_date)

    rows_by_task = {
        row.task_id: row for row in db.query(TaskReportingStatus).filter(
            TaskReportingStatus.meeting_id == meeting.id
        ).all()
    }
    for task in active_tasks(db):
        row = rows_by_task.get(task.id)
        current_field, previous_field, updated_field = LEGACY_FIELDS[meeting.kind]
        setattr(task, previous_field, row.status_text if row else None)
        setattr(task, current_field, None)
        setattr(task, updated_field, None)
        if meeting.kind == "did":
            task.did_demo = False
    _resolve_meeting_notifications(db, meeting.id)
    db.flush()
    ensure_reporting_schedule(db)
    return meeting


def cancel_meeting(
    db: Session,
    meeting: ReportingMeeting,
    *,
    reason: str,
    user_id: int,
    submitted_version: int | None,
) -> ReportingMeeting:
    current = _current_meeting(db, meeting.kind)
    if not current or current.id != meeting.id:
        raise ValueError("Сначала актуализируйте ближайшую встречу этого типа")
    if meeting.state not in OPEN_MEETING_STATES:
        raise ValueError("Можно отменить только незавершённую встречу")
    if submitted_version is not None and submitted_version != (meeting.version or 0):
        raise RuntimeError("version_conflict")
    reason = str(reason or "").strip()
    if not reason:
        raise ValueError("Укажите причину отмены")
    old_state = meeting.state
    meeting.state = "cancelled"
    meeting.cancelled_at = _utcnow()
    meeting.change_reason = reason
    meeting.updated_by = user_id
    meeting.version = (meeting.version or 0) + 1
    _meeting_history(db, meeting, "cancelled", user_id=user_id, old_state=old_state, old_date=meeting.scheduled_date, reason=reason)
    _resolve_meeting_notifications(db, meeting.id)
    source_rows = db.query(TaskReportingStatus).filter(TaskReportingStatus.meeting_id == meeting.id).all()
    for source in source_rows:
        task = db.query(Task).filter(Task.id == source.task_id).first()
        if task:
            current_field, _, updated_field = LEGACY_FIELDS[meeting.kind]
            setattr(task, current_field, None)
            setattr(task, updated_field, None)
            if meeting.kind == "did":
                task.did_demo = False
    db.flush()
    ensure_reporting_schedule(db)

    next_meeting = _current_meeting(db, meeting.kind)
    if next_meeting:
        existing_task_ids = {
            row[0] for row in db.query(TaskReportingStatus.task_id).filter(
                TaskReportingStatus.meeting_id == next_meeting.id
            ).all()
        }
        for source in source_rows:
            if source.task_id in existing_task_ids or not str(source.status_text or "").strip():
                continue
            copied = TaskReportingStatus(
                meeting_id=next_meeting.id,
                task_id=source.task_id,
                status_text=source.status_text,
                did_demo=source.did_demo,
                source="carried_from_cancelled",
                carried_from_status_id=source.id,
                created_by=user_id,
                updated_by=user_id,
            )
            db.add(copied)
            task = db.query(Task).filter(Task.id == source.task_id).first()
            if task:
                current_field, _, updated_field = LEGACY_FIELDS[meeting.kind]
                setattr(task, current_field, source.status_text)
                setattr(task, updated_field, _utcnow())
                if meeting.kind == "did":
                    task.did_demo = bool(source.did_demo)
    db.flush()
    return meeting


def _subtract_workdays(day: date, count: int) -> date:
    cursor = day
    remaining = count
    while remaining:
        cursor -= timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return cursor


def reminder_date(meeting: ReportingMeeting) -> date | None:
    if not meeting.scheduled_date:
        return None
    if meeting.kind == "directorate":
        return _subtract_workdays(meeting.scheduled_date, 1)
    if meeting.kind == "did":
        return meeting.scheduled_date - timedelta(days=2)
    return meeting.scheduled_date - timedelta(days=3)


def _missing_tasks_by_recipient(db: Session, meeting: ReportingMeeting) -> tuple[dict[int, list[Task]], int]:
    tasks = active_tasks(db)
    filled_ids = {
        row.task_id for row in db.query(TaskReportingStatus).filter(
            TaskReportingStatus.meeting_id == meeting.id,
            TaskReportingStatus.status_text.isnot(None),
            TaskReportingStatus.status_text != "",
        ).all()
    }
    by_user: dict[int, list[Task]] = defaultdict(list)
    candidate_ids = set()
    tasks_by_recipient: dict[int, list[Task]] = defaultdict(list)
    missing_teams: dict[int, set[int]] = {}
    for task in tasks:
        if task.id in filled_ids:
            continue
        team = task.team or db.query(Team).filter(Team.id == task.team_id).first()
        if not team:
            continue
        responsible_ids = {user_id for user_id in (team.po_id, team.pl_id, team.cl_id) if user_id}
        missing_teams[team.id] = responsible_ids
        for user_id in responsible_ids:
            if user_id:
                candidate_ids.add(user_id)
                tasks_by_recipient[user_id].append(task)
    active_ids = {
        row[0] for row in db.query(User.id).filter(User.id.in_(candidate_ids or {-1}), User.is_active == True).all()
    }
    for user_id, user_tasks in tasks_by_recipient.items():
        if user_id in active_ids:
            by_user[user_id] = user_tasks
    teams_without_active_recipients = sum(
        1 for responsible_ids in missing_teams.values()
        if not responsible_ids.intersection(active_ids)
    )
    return by_user, teams_without_active_recipients


def _admin_user_ids(db: Session) -> list[int]:
    rows = db.query(User).join(Role, User.role_id == Role.id).filter(
        User.is_active == True,
        or_(Role.admin_access == "full", Role.name.in_(("Проектный офис (админ)", "Администратор"))),
    ).all()
    return [user.id for user in rows]


def check_reporting_meeting_notifications(db: Session, today: date | None = None) -> None:
    """Создать одно напоминание командам и один запрос админам на встречу."""
    from notifications import _send_to_users

    today = today or date.today()
    ensure_reporting_schedule(db, today=today)
    meetings = db.query(ReportingMeeting).filter(
        ReportingMeeting.state == "planned",
        ReportingMeeting.scheduled_date.isnot(None),
    ).all()
    now = _utcnow()
    for meeting in meetings:
        due = reminder_date(meeting)
        if (
            meeting.team_reminder_sent_at is None
            and due is not None
            and due <= today < meeting.scheduled_date
        ):
            recipients, teams_without_recipients = _missing_tasks_by_recipient(db, meeting)
            for user_id, tasks in recipients.items():
                already_sent = db.query(Notification.id).filter(
                    Notification.user_id == user_id,
                    Notification.group_key == f"reporting_fill_{meeting.id}",
                    Notification.is_resolved == False,
                ).first()
                if already_sent:
                    continue
                preview = ", ".join((task.public_id or str(task.id)) for task in tasks[:10])
                suffix = "" if len(tasks) <= 10 else f" и ещё {len(tasks) - 10}"
                _send_to_users(
                    db,
                    [user_id],
                    None,
                    "reporting",
                    f"Заполните статусы к встрече «{MEETING_TITLES[meeting.kind]}»",
                    body=f"Не заполнено задач: {len(tasks)}. {preview}{suffix}",
                    importance="high",
                    action_url=f"#/backlog?task={tasks[0].id}&tab=rep",
                    group_key=f"reporting_fill_{meeting.id}",
                )
            # Если у части команд пока нет активного PO/PL/CL, проверяем снова
            # на следующем запуске, но не дублируем уже созданные уведомления.
            if teams_without_recipients == 0:
                meeting.team_reminder_sent_at = now

        if meeting.admin_fact_notified_at is None and meeting.scheduled_date <= today:
            admin_ids = _admin_user_ids(db)
            if admin_ids:
                _send_to_users(
                    db,
                    admin_ids,
                    None,
                    "reporting",
                    f"Актуализируйте факт встречи «{MEETING_TITLES[meeting.kind]}»",
                    body=f"Плановая дата: {meeting.scheduled_date.strftime('%d.%m.%Y')}. Укажите: проведена, перенесена или отменена.",
                    importance="high",
                    action_url=f"#/reporting-meetings?meeting={meeting.id}",
                    group_key=f"reporting_fact_{meeting.id}",
                )
                meeting.admin_fact_notified_at = now
    db.flush()
