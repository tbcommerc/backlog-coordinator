"""
DMB Backlog - Notification Service
Event-driven notifications + scheduled scanning
"""
import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import UUID
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import case, func as sql_func, or_

from models import (
    EventOutbox, Notification, ReportingMeeting, UserNotificationPreference, User,
    Task, format_task_public_id,
)
from event_outbox import enqueue_user_event


logger = logging.getLogger("dmb_backlog.notifications")


# ==================== CONSTANTS ====================

ACTIVE_NOTIFICATION_CATEGORIES = ("assignment", "reporting", "mention", "comment", "request", "work", "meeting_capture")
MANDATORY_NOTIFICATION_CATEGORIES = {"assignment", "reporting", "mention", "request"}
READ_LOCKED_NOTIFICATION_CATEGORY = "reporting"

EVENT_TYPES = {
    "assignment": "task.assigned",
    "reporting": "meeting.status_update.required",
    "mention": "comment.user_mentioned",
    "comment": "task.comment.added",
    "request": "request.review.updated",
}

IMPORTANCE = {
    "assignment": "high",
    "mention": "high",
    "comment": "medium",
    "reporting": "high",
    "request": "medium",
}


# ==================== PREFERENCES ====================

DEFAULT_PREFERENCES = {"comment": True}


def _positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _fallback_action_url(category: str, task_id: int | None) -> str:
    if category == "reporting":
        return "#/reporting-statuses?source=notification"
    if task_id:
        query = {"task": task_id}
        if category in {"comment", "mention"}:
            query["tab"] = "com"
        return f"#/backlog?{urlencode(query)}"
    return "#/notifications"


def normalize_notification_action_url(category: str, task_id: int | None, value: str | None) -> str:
    """Allow only application routes that are meaningful for the notification category."""
    raw = str(value or "").strip()
    target = raw[1:] if raw.startswith("#") else raw
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return _fallback_action_url(category, task_id)

    params = parse_qs(parsed.query, keep_blank_values=False)
    keys = set(params)
    if category == "meeting_capture" and parsed.path == "/meeting-capture" and keys == {"capture"} and len(params["capture"]) == 1:
        try:
            return f"#/meeting-capture?capture={UUID(params['capture'][0])}"
        except ValueError:
            return _fallback_action_url(category, task_id)
    reporting_paths = {"/reporting-statuses", "/quarterly-goals-update"}
    if category == "reporting" and parsed.path.rstrip("/") not in reporting_paths:
        return _fallback_action_url(category, task_id)
    if parsed.path.rstrip("/") == "/backlog" and keys <= {"task", "tab", "comment"}:
        route_task_id = _positive_int((params.get("task") or [None])[0])
        tab = (params.get("tab") or [None])[0]
        comment_id = _positive_int((params.get("comment") or [None])[0])
        if route_task_id and (not task_id or route_task_id == task_id) and tab in {None, "com", "rep", "log"}:
            query = {"task": route_task_id}
            if tab:
                query["tab"] = tab
            if comment_id and tab == "com":
                query["comment"] = comment_id
            return f"#/backlog?{urlencode(query)}"
    elif parsed.path.rstrip("/") == "/reporting-statuses" and category == "reporting" and keys <= {"source", "meeting_id"}:
        raw_meeting_id = (params.get("meeting_id") or [None])[0]
        meeting_id = _positive_int(raw_meeting_id)
        source = (params.get("source") or [None])[0]
        if source in {None, "notification"} and (raw_meeting_id is None or meeting_id):
            suffix = f"&meeting_id={meeting_id}" if meeting_id else ""
            return f"#/reporting-statuses?source=notification{suffix}"
    elif parsed.path.rstrip("/") == "/quarterly-goals-update" and category == "reporting" and keys <= {"source"}:
        source = (params.get("source") or [None])[0]
        if source in {None, "notification"}:
            return "#/quarterly-goals-update?source=notification"
    elif category == "request" and not keys:
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == 'review' and _positive_int(parts[1]):
            return f'#/review/{int(parts[1])}'
        if len(parts) == 3 and parts[:2] == ["customer", "request"] and _positive_int(parts[2]):
            return f"#/customer/request/{int(parts[2])}"
    elif parsed.path.rstrip("/") == "/notifications" and not params:
        return "#/notifications"
    return _fallback_action_url(category, task_id)


def notification_target(notification: Notification) -> dict:
    """Return a typed target while keeping action_url for backwards compatibility."""
    if getattr(notification, "work_task_id", None):
        return {"kind": "work", "url": f"/work-tasks/{notification.work_task_id}", "work_task_id": notification.work_task_id}
    action_url = normalize_notification_action_url(
        notification.category,
        notification.task_id,
        notification.action_url,
    )
    target = action_url[1:] if action_url.startswith("#") else action_url
    parsed = urlsplit(target)
    params = parse_qs(parsed.query)
    task_id = _positive_int((params.get("task") or [notification.task_id])[0])
    tab = (params.get("tab") or [None])[0]
    comment_id = _positive_int((params.get("comment") or [None])[0])
    meeting_id = _positive_int((params.get("meeting_id") or [None])[0])
    request_parts = parsed.path.strip("/").split("/")
    request_id = _positive_int(request_parts[2]) if len(request_parts) == 3 and request_parts[:2] == ["customer", "request"] else None
    if len(request_parts)==2 and request_parts[0]=='review': request_id=_positive_int(request_parts[1])
    if parsed.path == "/meeting-capture":
        kind = "meeting_capture"
    elif parsed.path == "/reporting-statuses":
        kind = "reporting_statuses"
    elif parsed.path == "/quarterly-goals-update":
        kind = "quarterly_goals_update"
    elif parsed.path.startswith("/customer/request/") or (parsed.path.startswith('/review/') and request_id):
        kind = "request"
    elif parsed.path == "/backlog" and tab == "com":
        kind = "task_discussion"
    elif parsed.path == "/backlog" and tab == "rep":
        kind = "task_reporting"
    elif parsed.path == "/backlog" and tab == "log":
        kind = "task_history"
    elif parsed.path == "/backlog":
        kind = "task"
    else:
        kind = "inbox"
    return {
        "kind": kind,
        "url": target,
        "task_id": task_id,
        "tab": tab if tab in {"com", "rep", "log"} else None,
        "comment_id": comment_id,
        "meeting_id": meeting_id,
        "request_id": request_id,
    }


def _get_preferences(db: Session, user_id: int) -> dict:
    pref = db.query(UserNotificationPreference).filter(
        UserNotificationPreference.user_id == user_id
    ).first()
    if not pref:
        return DEFAULT_PREFERENCES.copy()
    try:
        return json.loads(pref.preferences)
    except (json.JSONDecodeError, TypeError):
        return DEFAULT_PREFERENCES.copy()


def _is_enabled(prefs: dict, category: str) -> bool:
    if category in MANDATORY_NOTIFICATION_CATEGORIES:
        return True
    return prefs.get(category, True)


# ==================== RECIPIENT RESOLUTION ====================

def _user_can_read_task(user: User, task: Task) -> bool:
    from auth import can_access_task

    return bool(user.is_active and can_access_task("read", task, user))


def invalid_mention_user_ids(db: Session, task: Task, user_ids: list[int] | None) -> list[int]:
    """Return mentioned users that are inactive, missing, or cannot read the task."""
    requested = set(user_ids or [])
    if not requested:
        return []
    users = db.query(User).filter(User.id.in_(requested)).all()
    allowed = {user.id for user in users if _user_can_read_task(user, task)}
    return sorted(requested - allowed)


def task_comment_recipient_ids(db: Session, task: Task) -> list[int]:
    """Active readable users of the task's primary team."""
    if not task.team_id:
        return []
    users = db.query(User).filter(
        User.team_id == task.team_id,
        User.is_active == True,
    ).all()
    return [user.id for user in users if _user_can_read_task(user, task)]


# ==================== CORE CREATION ====================

def _create_notification(
    db: Session,
    user_id: int,
    task_id: int | None,
    category: str,
    title: str,
    body: str | None = None,
    importance: str | None = None,
    action_url: str | None = None,
    group_key: str | None = None,
    event_type: str | None = None,
):
    if not importance:
        importance = IMPORTANCE.get(category, "medium")
    action_url = normalize_notification_action_url(category, task_id, action_url)

    if group_key:
        existing = db.query(Notification).filter(
            Notification.user_id == user_id,
            Notification.group_key == group_key,
            Notification.is_dismissed == False,
            Notification.is_resolved == False,
        ).first()
        if existing:
            existing.title = title
            existing.body = body
            existing.task_id = task_id
            existing.category = category
            existing.importance = importance
            existing.action_url = action_url
            existing.type = event_type or EVENT_TYPES.get(category, category)
            existing.message = title[:500]
            existing.created_at = datetime.utcnow()
            existing.is_read = False
            existing.read_at = None
            existing.group_count = (existing.group_count or 1) + 1
            db.flush()
            return existing

    notif = Notification(
        user_id=user_id,
        task_id=task_id,
        type=event_type or EVENT_TYPES.get(category, category),
        message=title[:500],
        category=category,
        title=title,
        body=body,
        importance=importance,
        is_read=False,
        is_dismissed=False,
        is_resolved=False,
        action_url=action_url,
        group_key=group_key,
        group_count=1,
    )
    db.add(notif)
    db.flush()
    return notif


def _send_to_users(
    db: Session,
    user_ids: list[int],
    task_id: int | None,
    category: str,
    title: str,
    body: str | None = None,
    importance: str | None = None,
    action_url: str | None = None,
    group_key: str | None = None,
    exclude_user_ids: set[int] | None = None,
    event_type: str | None = None,
):
    excluded = exclude_user_ids or set()
    for uid in dict.fromkeys(user_ids):
        if not uid or uid in excluded:
            continue
        prefs = _get_preferences(db, uid)
        if not _is_enabled(prefs, category):
            continue
        _create_notification(
            db, uid, task_id, category, title, body,
            importance, action_url, group_key, event_type,
        )


def notify_request_decision(db: Session, request, status: str, actor_id: int | None = None):
    """Persist the customer's next action after a human review decision."""
    recipient_id = getattr(request, "user_id", None)
    if status == 'withdraw':
        recipient_id = getattr(request, 'coordinator_id', None) or getattr(request, 'reviewer_id', None) or recipient_id
    if not recipient_id or recipient_id == actor_id:
        return None
    labels = {
        "returned": ("Запрос требует уточнения", getattr(request, "reject_reason", None) or "Откройте запрос и уточните отмеченные сведения."),
        "rejected": ("Запрос отклонён", getattr(request, "reject_reason", None) or "Откройте запрос, чтобы посмотреть решение."),
        "in_progress": ("Запрос размещён в работе", "С запросом связаны работы. Их состояние и следующий шаг доступны в карточке запроса."),
        "accept": ("Запрос принят в бэклог", "Потребность принята. Срок исполнения будет согласован отдельно."),
        "defer": ("Рассмотрение запроса отложено", "В карточке указаны причина, ответственный и дата следующего шага."),
        "reconsider": ("Запрос направлен на повторное рассмотрение", "Команда пересматривает решение. Предыдущие решения сохранены в истории."),
        "withdraw": ("Запрос отозван", "Отзыв и его причина сохранены в истории. Связанные работы не отменяются автоматически."),
        "follow_up": ("Обновлён следующий шаг по запросу", "В карточке запроса обновлены ответственный, следующий шаг и срок."),
        "fulfilled": ("Результат запроса подтверждён", "Команда подтвердила полное выполнение потребности. Итог доступен в карточке запроса."),
        "work_completed": ("Принята работа по запросу", "Одна из связанных работ выполнена. Команда проверит полноту результата по запросу."),
        "needs_verification": ("Результат запроса требует сверки", "Связанные работы изменились. Команда должна повторно проверить результат."),
        "approved": ("Проработка запроса завершена", "Откройте запрос, чтобы посмотреть результат."),
    }
    if status not in labels:
        return None
    title, body = labels[status]
    request_id = getattr(request, "id", None)
    return _create_notification(
        db,
        recipient_id,
        None,
        "request",
        title,
        body=body,
        importance="high" if status in {"returned", "rejected"} else "medium",
        action_url=f"#/review/{request_id}" if status=='withdraw' and recipient_id != getattr(request,'user_id',None) else f"#/customer/request/{request_id}",
        group_key=f"request-review:{request_id}:{getattr(request, 'version', 0)}:{status}",
        event_type=f"request.review.{status}",
    )


# ==================== EVENT NOTIFIERS ====================

def notify_assignment(
    db: Session,
    task: Task,
    new_owner_id: int | None,
    assigned_by_user_id: int | None = None,
):
    previous_assignments = db.query(Notification).filter(
        Notification.task_id == task.id,
        Notification.type.in_((EVENT_TYPES["assignment"], "assignment")),
        Notification.is_resolved == False,
    )

    if new_owner_id is not None:
        previous_assignments = previous_assignments.filter(Notification.user_id != new_owner_id)
    resolved_at = datetime.utcnow()
    previous_assignments.update(
        {
            Notification.is_resolved: True,
            Notification.resolved_at: resolved_at,
            Notification.is_read: True,
            Notification.read_at: resolved_at,
        },
        synchronize_session=False,
    )
    if not new_owner_id:
        return
    owner = db.query(User).filter(User.id == new_owner_id).first()
    if not owner or not _user_can_read_task(owner, task):
        return
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Вам назначена задача {task_label}"
    _send_to_users(
        db, [new_owner_id], task.id, "assignment", title,
        importance=IMPORTANCE["assignment"],
        action_url=f"#/backlog?task={task.id}",
        group_key=f"task_assignment_{task.id}_{new_owner_id}",
        exclude_user_ids={assigned_by_user_id} if assigned_by_user_id else None,
        event_type=EVENT_TYPES["assignment"],
    )


def notify_mention(
    db: Session,
    task: Task,
    mentioned_user_ids: list[int] | None,
    author_name: str,
    author_user_id: int | None = None,
    comment_id: int | None = None,
):
    if not mentioned_user_ids:
        return
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    invalid = set(invalid_mention_user_ids(db, task, mentioned_user_ids))
    for uid in dict.fromkeys(mentioned_user_ids):
        if uid in invalid:
            continue
        title = f"{author_name} упомянул вас в задаче {task_label}"
        comment_suffix = f"&comment={comment_id}" if comment_id else ""
        _send_to_users(
            db, [uid], task.id, "mention", title,
            importance=IMPORTANCE["mention"],
            action_url=f"#/backlog?task={task.id}&tab=com{comment_suffix}",
            group_key=f"task_mention_{task.id}_{uid}_{comment_id or 'legacy'}",
            exclude_user_ids={author_user_id} if author_user_id else None,
            event_type=EVENT_TYPES["mention"],
        )


def notify_comment(
    db: Session,
    task: Task,
    commenter_id: int,
    excluded_recipient_ids: set[int] | None = None,
    commenter_name: str | None = None,
    comment_id: int | None = None,
):
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    actor = commenter_name or db.query(User.name).filter(User.id == commenter_id).scalar() or "Пользователь"
    title = f"{actor} добавил комментарий к задаче {task_label}"
    recipients = task_comment_recipient_ids(db, task)
    excluded = set(excluded_recipient_ids or set()) | {commenter_id}
    comment_suffix = f"&comment={comment_id}" if comment_id else ""
    _send_to_users(
        db, recipients, task.id, "comment", title,
        importance=IMPORTANCE["comment"],
        action_url=f"#/backlog?task={task.id}&tab=com{comment_suffix}",
        group_key=f"task_comment_{task.id}_{comment_id or 'legacy'}",
        exclude_user_ids=excluded,
        event_type=EVENT_TYPES["comment"],
    )


# ==================== SCHEDULED CHECK ====================

def check_scheduled_notifications(db: Session):
    """Run approved reminders for reporting meetings and quarterly progress."""
    from reporting_meetings import check_reporting_meeting_notifications

    check_reporting_meeting_notifications(db)
    check_quarterly_goal_notifications(db)

    db.commit()


def check_quarterly_goal_notifications(db: Session, today: date | None = None):
    """Напомнить командам о неподтверждённом или устаревшем факте квартала."""
    from reporting_meetings import active_reporting_users_by_team
    from routers.reports_router import (
        _apply_quarterly_goals_scope,
        _current_quarter_progress,
        _moscow_today,
        _progress_is_stale,
    )

    today = today or _moscow_today()
    query = db.query(Task).options(joinedload(Task.team)).filter(Task.is_deleted == False)
    query, _ = _apply_quarterly_goals_scope(query, db, today)
    stale_tasks = []
    teams = {}
    for task in query.all():
        if not _progress_is_stale(task):
            continue
        if task.team:
            teams[task.team.id] = task.team
            stale_tasks.append(task)

    recipients_by_team = active_reporting_users_by_team(db, list(teams.values()))
    by_user = defaultdict(list)
    for task in stale_tasks:
        for user in recipients_by_team.get(task.team_id, []):
            by_user[user.id].append(task)

    quarter = _current_quarter_progress(today)[0].replace(" ", "_")
    group_key = f"quarterly_progress_{quarter}"
    existing = db.query(Notification).filter(
        Notification.group_key == group_key,
        Notification.is_resolved == False,
    ).all()
    existing_by_user = {item.user_id: item for item in existing}
    now = datetime.now(timezone.utc)

    for notification in existing:
        if notification.user_id not in by_user:
            notification.is_resolved = True
            notification.resolved_at = now
            notification.is_read = True
            notification.read_at = now

    for user_id, tasks in by_user.items():
        if user_id in existing_by_user:
            continue
        preview = ", ".join((task.public_id or str(task.id)) for task in tasks[:10])
        suffix = "" if len(tasks) <= 10 else f" и ещё {len(tasks) - 10}"
        _send_to_users(
            db,
            [user_id],
            None,
            "reporting",
            "Обновите прогресс и статусы",
            body=f"Требуют подтверждения: {len(tasks)}. {preview}{suffix}",
            importance="high",
            action_url="#/quarterly-goals-update?source=notification",
            group_key=group_key,
            event_type="quarterly.progress_update.required",
        )

    db.flush()


# ==================== QUERY HELPERS ====================

def _visible_notifications_query(db: Session, user_id: int, current_user: User | None = None):
    """Return notifications whose task context is still readable by the recipient."""
    from auth import task_read_scope_clause, is_customer_portal_only

    user = current_user or db.query(User).filter(User.id == user_id).first()
    query = db.query(Notification).outerjoin(Task, Notification.task_id == Task.id).filter(
        Notification.user_id == user_id,
        Notification.category.in_(ACTIVE_NOTIFICATION_CATEGORIES),
        Notification.is_dismissed == False,
    )
    if not user:
        return query.filter(Notification.id == -1)
    from models import WorkTask
    from services.work_tasks import read_scope
    work_ids = db.query(WorkTask.id).filter(WorkTask.is_deleted.is_(False), read_scope(user))
    query = query.filter(or_(Notification.work_task_id.is_(None), Notification.work_task_id.in_(work_ids)))
    if is_customer_portal_only(user):
        # Only decisions addressed to this authenticated customer belong in this inbox.
        return query.filter(Notification.category == "request", Notification.task_id.is_(None))
    return query.filter(or_(
        Notification.task_id.is_(None),
        task_read_scope_clause(user, Task),
    ))


def get_unread_count(db: Session, user_id: int, current_user: User | None = None) -> int:
    return _visible_notifications_query(db, user_id, current_user).filter(
        Notification.is_read == False,
        Notification.is_resolved == False,
    ).with_entities(sql_func.count(Notification.id)).scalar() or 0


def get_notification_summary(db: Session, user_id: int, current_user: User | None = None) -> dict:
    from services.work_tasks import WORK_ACTION_TYPES
    base = _visible_notifications_query(db, user_id, current_user)
    unread = base.filter(
        Notification.is_read == False,
        Notification.is_resolved == False,
    ).count()
    requires_action = base.filter(
        Notification.is_resolved == False,
        or_(Notification.category == "reporting", Notification.type.in_(WORK_ACTION_TYPES)),
    ).count()
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today = base.filter(Notification.created_at >= today_start).count()
    category_rows = base.filter(
        Notification.is_read == False,
        Notification.is_resolved == False,
    ).with_entities(
        Notification.category, sql_func.count(Notification.id)
    ).group_by(Notification.category).all()
    return {
        "unread": unread,
        "requires_action": requires_action,
        "today": today,
        "by_category": {category: count for category, count in category_rows},
    }


def get_notification_revision(db: Session, user_id: int) -> int:
    return db.query(sql_func.max(EventOutbox.id)).filter(
        EventOutbox.audience_user_id == user_id,
        EventOutbox.event_type.like("notification.%"),
    ).scalar() or 0


def get_notification_snapshot(db: Session, user_id: int, current_user: User):
    """Read shell and dashboard data against one stable notification revision."""
    for _attempt in range(2):
        before = get_notification_revision(db, user_id)
        recent_items, recent_total = get_notifications(
            db, user_id, page=1, per_page=5, current_user=current_user,
        )
        action_items, action_total = get_notifications(
            db, user_id, requires_action=True, page=1, per_page=5, current_user=current_user,
        )
        summary = get_notification_summary(db, user_id, current_user)
        after = get_notification_revision(db, user_id)
        if before == after:
            break
    return {
        "revision": after,
        "summary": summary,
        "recent_items": recent_items,
        "recent_total": recent_total,
        "action_items": action_items,
        "action_total": action_total,
    }


def get_notifications(
    db: Session,
    user_id: int,
    category: str | None = None,
    unread_only: bool = False,
    importance: str | None = None,
    resolved: bool | None = None,
    requires_action: bool = False,
    search: str | None = None,
    page: int = 1,
    per_page: int = 20,
    current_user: User | None = None,
    views: str | None = None,
):
    q = _visible_notifications_query(db, user_id, current_user)
    from services.filter_values import filter_values
    if category:
        q = q.filter(Notification.category.in_(filter_values(category)))
    if unread_only:
        q = q.filter(Notification.is_read == False, Notification.is_resolved == False)
    if importance:
        q = q.filter(Notification.importance.in_(filter_values(importance)))
    if resolved is not None:
        q = q.filter(Notification.is_resolved == resolved)
    if requires_action:
        from services.work_tasks import WORK_ACTION_TYPES
        q = q.filter(
            Notification.is_resolved == False,
            or_(Notification.category == "reporting", Notification.type.in_(WORK_ACTION_TYPES)),
        )
    selected_views=filter_values(views,allowed={'all','unread','action','resolved','open'})
    if selected_views and 'all' not in selected_views:
        from services.work_tasks import WORK_ACTION_TYPES
        clauses={'unread':(Notification.is_read == False)&(Notification.is_resolved == False),
            'action':(Notification.is_resolved == False)&or_(Notification.category=='reporting',Notification.type.in_(WORK_ACTION_TYPES)),
            'resolved':Notification.is_resolved == True,'open':Notification.is_resolved == False}
        q=q.filter(or_(*(clauses[value] for value in selected_views)))
    if search:
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        q = q.filter(or_(
            Notification.title.ilike(pattern, escape="\\"),
            Notification.body.ilike(pattern, escape="\\"),
        ))

    total = q.count()
    unread_rank = case((Notification.is_read == False, 0), else_=1)
    items = q.order_by(
        unread_rank,
        Notification.created_at.desc(),
        Notification.id.desc(),
    ).offset(
        (page - 1) * per_page
    ).limit(per_page).all()

    return items, total


def mark_read(db: Session, notification_ids: list[int], user_id: int):
    now = datetime.utcnow()
    query = db.query(Notification).filter(
        Notification.id.in_(notification_ids),
        Notification.user_id == user_id,
    )
    blocked_ids = [row[0] for row in query.filter(
        Notification.category == READ_LOCKED_NOTIFICATION_CATEGORY,
        Notification.is_resolved == False,
    ).with_entities(Notification.id).all()]
    changed_query = query.filter(or_(
        Notification.category != READ_LOCKED_NOTIFICATION_CATEGORY,
        Notification.is_resolved == True,
    ))
    changed_ids = [row[0] for row in changed_query.filter(
        Notification.is_read == False,
    ).with_entities(Notification.id).all()]
    changed_query.update(
        {Notification.is_read: True, Notification.read_at: now},
        synchronize_session=False,
    )
    if changed_ids:
        enqueue_user_event(
            db,
            user_id=user_id,
            event_type="notification.state.changed",
            payload={"action": "read", "notification_ids": changed_ids[:100]},
        )
    db.flush()
    return {"changed_ids": changed_ids, "blocked_ids": blocked_ids}


def mark_unread(db: Session, notification_ids: list[int], user_id: int):
    query = db.query(Notification).filter(
        Notification.id.in_(notification_ids),
        Notification.user_id == user_id,
        Notification.is_dismissed == False,
        Notification.is_resolved == False,
    )
    changed_ids = [row[0] for row in query.filter(
        Notification.is_read == True,
    ).with_entities(Notification.id).all()]
    query.update(
        {Notification.is_read: False, Notification.read_at: None},
        synchronize_session=False,
    )
    if changed_ids:
        enqueue_user_event(
            db,
            user_id=user_id,
            event_type="notification.state.changed",
            payload={"action": "unread", "notification_ids": changed_ids[:100]},
        )
    db.flush()
    return changed_ids


def mark_all_read(db: Session, user_id: int):
    now = datetime.utcnow()
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(ACTIVE_NOTIFICATION_CATEGORIES),
        Notification.is_read == False,
        Notification.is_dismissed == False,
        Notification.is_resolved == False,
        Notification.category != READ_LOCKED_NOTIFICATION_CATEGORY,
    )
    changed_ids = [row[0] for row in query.with_entities(Notification.id).all()]
    query.update(
        {Notification.is_read: True, Notification.read_at: now},
        synchronize_session=False,
    )
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "read_all"},
    )
    db.flush()
    return changed_ids


def dismiss_notification(db: Session, notification_id: int, user_id: int):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).first()
    if not notification:
        return "not_found"
    if notification.category == "reporting" and not notification.is_resolved:
        return "mandatory_action"
    notification.is_dismissed = True
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "dismiss", "notification_ids": [notification_id]},
    )
    db.flush()
    return "dismissed"


def restore_notification(db: Session, notification_id: int, user_id: int):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).first()
    if not notification:
        return "not_found"
    group_key = str(notification.group_key or "")
    if group_key.startswith("reporting_fill_"):
        meeting_id = _positive_int(group_key.removeprefix("reporting_fill_"))
        if meeting_id and db.query(ReportingMeeting.id).filter(
            ReportingMeeting.id == meeting_id,
            ReportingMeeting.state == "held",
        ).first():
            return "terminal"
    notification.is_dismissed = False
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "restore", "notification_ids": [notification_id]},
    )
    db.flush()
    return "restored"
