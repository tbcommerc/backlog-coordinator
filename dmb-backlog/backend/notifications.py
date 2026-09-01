"""
DMB Backlog - Notification Service
Event-driven notifications + scheduled scanning
"""
import json
import logging
import re
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import case, func as sql_func, or_

from models import (
    Notification, UserNotificationPreference, User, Role,
    Task, Team, TaskStatus, format_task_public_id
)
from event_outbox import enqueue_user_event


logger = logging.getLogger("dmb_backlog.notifications")


# ==================== CONSTANTS ====================

IMPORTANCE = {
    "risk": "critical",
    "deadline": "high",
    "status_change": "high",
    "assignment": "high",
    "mention": "high",
    "express": "high",
    "editing": "medium",
    "comment": "medium",
    "stale": "low",
    "attrs": "low",
    "system": "low",
    "reporting": "high",
}

ACTIVE_STATUSES = [
    "СБОР ТРЕБОВАНИЙ", "ПРОВЕРКА ТРЕБОВАНИЙ", "УТОЧНЕНИЕ ТРЕБОВАНИЙ",
    "ЭКСПРЕСС-ОЦЕНКА", "ПРИНЯТИЕ РЕШЕНИЯ", "ПРИНЯТА В РАБОТУ",
]

RISK_STATUSES = ["ХОЛД", "ЭСКАЛАЦИЯ НА ЛТ"]

CLOSED_STATUSES = ["ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА"]

STATUS_NAMES = {
    1: "НОВАЯ ЗАДАЧА", 2: "НАЗНАЧЕНА КОМАНДА", 3: "СБОР ТРЕБОВАНИЙ",
    4: "ПРОВЕРКА ТРЕБОВАНИЙ", 5: "УТОЧНЕНИЕ ТРЕБОВАНИЙ", 6: "ЭКСПРЕСС-ОЦЕНКА",
    7: "ПРИНЯТИЕ РЕШЕНИЯ", 8: "ПРИНЯТА В РАБОТУ", 9: "ОТКЛОНЕНА",
    10: "НЕ АКТУАЛЬНА", 11: "ВЫПОЛНЕНА", 12: "ЭСКАЛАЦИЯ НА ЛТ", 13: "ХОЛД",
}


# ==================== PREFERENCES ====================

DEFAULT_PREFERENCES = {
    "risk": True, "deadline": True, "status_change": True,
    "assignment": True, "mention": True, "comment": True,
    "express": True, "editing": True, "stale": True, "attrs": True, "system": True,
    "reporting": True,
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
    return prefs.get(category, True)


# ==================== RECIPIENT RESOLUTION ====================

def _get_task_recipients(db: Session, task: Task) -> list[int]:
    """Get user IDs for task owner + team PO + team PL."""
    ids = set()
    if task.owner_id:
        ids.add(task.owner_id)
    team = task.team
    if not team:
        team = db.query(Team).filter(Team.id == task.team_id).first()
    if team:
        if team.po_id:
            ids.add(team.po_id)
        if team.pl_id:
            ids.add(team.pl_id)
    return list(ids)


def _get_all_lt_user_ids(db: Session) -> list[int]:
    lt_role = db.query(Role).filter(Role.name == "Лидер трайба").first()
    if not lt_role:
        return []
    return [
        u.id for u in db.query(User).filter(
            User.role_id == lt_role.id, User.is_active == True
        ).all()
    ]


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
):
    if not importance:
        importance = IMPORTANCE.get(category, "medium")

    if group_key:
        existing = db.query(Notification).filter(
            Notification.user_id == user_id,
            Notification.group_key == group_key,
            Notification.is_read == False,
            Notification.is_dismissed == False,
        ).first()
        if existing:
            existing.group_count = (existing.group_count or 1) + 1
            existing.title = title
            existing.body = body
            existing.type = category
            existing.message = title[:500]
            existing.created_at = datetime.utcnow()
            db.flush()
            return

    notif = Notification(
        user_id=user_id,
        task_id=task_id,
        type=category,
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
            importance, action_url, group_key,
        )


# ==================== EVENT NOTIFIERS ====================

def notify_status_change(
    db: Session,
    task: Task,
    old_status_name: str,
    new_status_name: str,
    changed_by_user_id: int,
):
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"

    recipients = _get_task_recipients(db, task)
    title = f"Статус задачи {task_label}: {old_status_name} → {new_status_name}"

    _send_to_users(
        db, recipients, task.id, "status_change", title,
        importance=IMPORTANCE["status_change"],
        action_url=f"#/backlog?task={task.id}",
        group_key=f"task_updates_{task.id}",
        exclude_user_ids={changed_by_user_id},
    )

    if new_status_name in RISK_STATUSES:
        lt_ids = _get_all_lt_user_ids(db)
        title_risk = f"Риск: задача {task_label} переведена в «{new_status_name}»"
        _send_to_users(
            db, lt_ids, task.id, "risk", title_risk,
            importance=IMPORTANCE["risk"],
            group_key=f"risk_{task.id}",
            action_url=f"#/backlog?task={task.id}",
            exclude_user_ids={changed_by_user_id},
        )


def notify_assignment(
    db: Session,
    task: Task,
    new_owner_id: int,
    assigned_by_user_id: int | None = None,
):
    if not new_owner_id:
        return
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Вам назначена задача {task_label}"
    _send_to_users(
        db, [new_owner_id], task.id, "assignment", title,
        importance=IMPORTANCE["assignment"],
        action_url=f"#/backlog?task={task.id}",
        group_key=f"task_assignment_{task.id}_{new_owner_id}",
        exclude_user_ids={assigned_by_user_id} if assigned_by_user_id else None,
    )


def notify_mention(
    db: Session,
    task: Task,
    mentioned_user_ids: list[int] | None,
    author_name: str,
    author_user_id: int | None = None,
):
    if not mentioned_user_ids:
        return
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    for uid in mentioned_user_ids:
        title = f"{author_name} упомянул вас в задаче {task_label}"
        _send_to_users(
            db, [uid], task.id, "mention", title,
            importance=IMPORTANCE["mention"],
            action_url=f"#/backlog?task={task.id}&tab=comments",
            group_key=f"task_mention_{task.id}_{uid}",
            exclude_user_ids={author_user_id} if author_user_id else None,
        )


def notify_comment(
    db: Session,
    task: Task,
    commenter_id: int,
    excluded_recipient_ids: set[int] | None = None,
):
    if not task.owner_id or task.owner_id == commenter_id:
        return
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Новый комментарий к задаче {task_label}"
    _send_to_users(
        db, [task.owner_id], task.id, "comment", title,
        importance=IMPORTANCE["comment"],
        action_url=f"#/backlog?task={task.id}&tab=comments",
        group_key=f"task_comments_{task.id}",
        exclude_user_ids=excluded_recipient_ids,
    )


def notify_express_import(
    db: Session,
    task: Task,
    imported_by_name: str,
):
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Задача {task_label} переведена в ЭКСПРЕСС-ОЦЕНКУ"
    recipients = _get_task_recipients(db, task)
    _send_to_users(
        db, recipients, task.id, "express", title,
        importance=IMPORTANCE["express"],
        action_url=f"#/express-estimate",
    )


def notify_customer_task_created(
    db: Session,
    task: Task,
    customer_name: str,
):
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Новая задача от заказчика ({customer_name}): {task_label}"
    recipients = _get_task_recipients(db, task)
    _send_to_users(
        db, recipients, task.id, "system", title,
        importance=IMPORTANCE["system"],
        action_url=f"#/backlog?task={task.id}",
    )


def notify_lock_acquired(
    db: Session,
    task: Task,
    lock_owner_name: str,
):
    """Notify task owner + team PO/PL that someone started editing the task."""
    task_label = f"{task.public_id or format_task_public_id(task.id)}: «{task.title or 'Без названия'}»"
    title = f"Пользователь {lock_owner_name} начал редактирование задачи {task_label}"
    recipients = _get_task_recipients(db, task)
    _send_to_users(
        db, recipients, task.id, "editing", title,
        importance=IMPORTANCE["editing"],
        action_url=f"#/backlog?task={task.id}",
    )


# ==================== SCHEDULED CHECK ====================

def resolve_deadline_date(value):
    """Resolve a real date or a Deadline dictionary item into its period end."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    candidates = [str(getattr(value, "code", "") or ""), str(getattr(value, "name", "") or "")]
    for text in candidates:
        normalized = text.strip().upper()
        quarter = re.fullmatch(r"(?:Q([1-4])[_\s-]?(\d{4})|([1-4])Q\s*(\d{4}))", normalized)
        if quarter:
            number = int(quarter.group(1) or quarter.group(3))
            year = int(quarter.group(2) or quarter.group(4))
            return date(year + (1 if number == 4 else 0), 1 if number == 4 else number * 3 + 1, 1) - timedelta(days=1)
        annual = re.fullmatch(r"Y(?:EAR)?[_\s-]?(\d{4})", normalized)
        if annual:
            return date(int(annual.group(1)), 12, 31)
    return None

def check_scheduled_notifications(db: Session):
    now = datetime.utcnow()
    current_quarter = (now.month - 1) // 3 + 1
    current_year = now.year

    q_start = date(current_year, (current_quarter - 1) * 3 + 1, 1)
    if current_quarter < 4:
        q_end = date(current_year, current_quarter * 3 + 1, 1) - timedelta(days=1)
    else:
        q_end = date(current_year + 1, 1, 1) - timedelta(days=1)

    tasks = db.query(Task).filter(
        Task.is_deleted == False,
        Task.status_id.notin_(
            db.query(TaskStatus.id).filter(TaskStatus.name.in_(CLOSED_STATUSES))
        ),
    ).all()

    stale_tasks = []
    deadline_tasks = []
    attrs_tasks = []

    for task in tasks:
        status_name = STATUS_NAMES.get(task.status_id, "")
        if status_name not in ACTIVE_STATUSES:
            continue

        if status_name == "ПРИНЯТА В РАБОТУ" and task.updated_at:
            days_since = (now - task.updated_at.replace(tzinfo=None)).days
            if days_since > 5:
                stale_tasks.append((task, days_since))

        dl = resolve_deadline_date(task.deadline)
        if dl and q_start <= dl <= q_end:
            days_left = (dl - date.today()).days
            deadline_tasks.append((task, days_left))

        if not task.description or len(task.description) < 20:
            attrs_tasks.append((task, "no_description"))
        elif task.effort_days is None and task.effort_rub is None:
            attrs_tasks.append((task, "no_effort"))

    def per_recipient(rows):
        result = {}
        for row in rows:
            task = row[0]
            for uid in _get_task_recipients(db, task):
                result.setdefault(uid, []).append(row)
        return result

    for uid, rows in per_recipient(stale_tasks).items():
        count = len(rows)
        title = f"{count} {'задача' if count == 1 else 'задач'} без обновления > 5 дней"
        _send_to_users(
            db, [uid], None, "stale", title,
            importance=IMPORTANCE["stale"],
            group_key=f"stale_{uid}_{current_quarter}_{current_year}",
            action_url="#/backlog?filter=stale",
        )

    for uid, rows in per_recipient(deadline_tasks).items():
        urgent = sum(1 for _, days_left in rows if days_left < 7)
        title_parts = []
        if urgent:
            title_parts.append(f"{urgent} с дедлайном < 7 дней")
        title_parts.append(f"{len(rows)} задач с дедлайном в квартале")
        _send_to_users(
            db, [uid], None, "deadline", " | ".join(title_parts),
            importance=IMPORTANCE["deadline"],
            group_key=f"deadline_{uid}_{current_quarter}_{current_year}",
            action_url="#/backlog?filter=deadline",
        )

    for uid, rows in per_recipient(attrs_tasks).items():
        no_desc = sum(1 for _, kind in rows if kind == "no_description")
        no_eff = sum(1 for _, kind in rows if kind == "no_effort")
        parts = []
        if no_desc:
            parts.append(f"{no_desc} без описания")
        if no_eff:
            parts.append(f"{no_eff} без оценки трудозатрат")
        _send_to_users(
            db, [uid], None, "attrs", f"Неполные атрибуты: {', '.join(parts)}",
            importance=IMPORTANCE["attrs"],
            group_key=f"attrs_{uid}_{current_quarter}_{current_year}",
            action_url="#/backlog?filter=incomplete",
        )

    # Отчётные встречи используют тот же почасовой планировщик и общую
    # пользовательскую ленту уведомлений.
    from reporting_meetings import check_reporting_meeting_notifications
    check_reporting_meeting_notifications(db, today=now.date())

    db.commit()


# ==================== QUERY HELPERS ====================

def get_unread_count(db: Session, user_id: int) -> int:
    return db.query(sql_func.count(Notification.id)).filter(
        Notification.user_id == user_id,
        Notification.is_read == False,
        Notification.is_dismissed == False,
    ).scalar() or 0


def get_notification_summary(db: Session, user_id: int) -> dict:
    base = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.is_dismissed == False,
    )
    unread = base.filter(Notification.is_read == False).count()
    requires_action = base.filter(
        Notification.is_resolved == False,
        Notification.importance.in_(("critical", "high")),
    ).count()
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today = base.filter(Notification.created_at >= today_start).count()
    category_rows = db.query(
        Notification.category, sql_func.count(Notification.id)
    ).filter(
        Notification.user_id == user_id,
        Notification.is_dismissed == False,
        Notification.is_read == False,
    ).group_by(Notification.category).all()
    return {
        "unread": unread,
        "requires_action": requires_action,
        "today": today,
        "by_category": {category: count for category, count in category_rows},
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
):
    q = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.is_dismissed == False,
    )
    if category:
        q = q.filter(Notification.category == category)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    if importance:
        q = q.filter(Notification.importance == importance)
    if resolved is not None:
        q = q.filter(Notification.is_resolved == resolved)
    if requires_action:
        q = q.filter(
            Notification.is_resolved == False,
            Notification.importance.in_(("critical", "high")),
        )
    if search:
        pattern = f"%{search.strip()}%"
        q = q.filter(or_(Notification.title.ilike(pattern), Notification.body.ilike(pattern)))

    total = q.count()
    attention_rank = case(
        (Notification.is_resolved == True, 4),
        (Notification.importance == "critical", 0),
        (Notification.importance == "high", 1),
        (Notification.is_read == False, 2),
        else_=3,
    )
    items = q.order_by(attention_rank, Notification.created_at.desc(), Notification.id.desc()).offset(
        (page - 1) * per_page
    ).limit(per_page).all()

    return items, total


def mark_read(db: Session, notification_ids: list[int], user_id: int):
    now = datetime.utcnow()
    db.query(Notification).filter(
        Notification.id.in_(notification_ids),
        Notification.user_id == user_id,
    ).update(
        {Notification.is_read: True, Notification.read_at: now},
        synchronize_session=False,
    )
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "read", "notification_ids": notification_ids[:100]},
    )
    db.flush()


def mark_all_read(db: Session, user_id: int):
    now = datetime.utcnow()
    db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.is_read == False,
    ).update(
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


def dismiss_notification(db: Session, notification_id: int, user_id: int):
    db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).update(
        {Notification.is_dismissed: True},
        synchronize_session=False,
    )
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "dismiss", "notification_ids": [notification_id]},
    )
    db.flush()


def restore_notification(db: Session, notification_id: int, user_id: int):
    db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).update(
        {Notification.is_dismissed: False},
        synchronize_session=False,
    )
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "restore", "notification_ids": [notification_id]},
    )
    db.flush()


def resolve_notification(db: Session, notification_id: int, user_id: int):
    now = datetime.utcnow()
    db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
        Notification.is_dismissed == False,
    ).update(
        {
            Notification.is_resolved: True,
            Notification.resolved_at: now,
            Notification.is_read: True,
            Notification.read_at: now,
        },
        synchronize_session=False,
    )
    enqueue_user_event(
        db,
        user_id=user_id,
        event_type="notification.state.changed",
        payload={"action": "resolve", "notification_ids": [notification_id]},
    )
    db.flush()


# ==================== REQUIREMENT REQUEST NOTIFICATIONS ====================

def _get_team_reviewers(db: Session, team_id: int) -> list[int]:
    """Get PO/PL/CL user IDs for a team."""
    if not team_id:
        return []
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        return []
    ids = set()
    if team.po_id:
        ids.add(team.po_id)
    if team.pl_id:
        ids.add(team.pl_id)
    po_pl_role = db.query(Role).filter(Role.name == "PO/PL/CL").first()
    if po_pl_role:
        for u in db.query(User).filter(
            User.team_id == team_id,
            User.role_id == po_pl_role.id,
            User.is_active == True,
        ).all():
            ids.add(u.id)
    return list(ids)


def notify_new_request(db: Session, request_id: int, team_id: int, title: str, author_name: str):
    """Notify team PO/PL/CL about a new requirement request."""
    reviewers = _get_team_reviewers(db, team_id)
    if not reviewers:
        return
    _send_to_users(
        db,
        reviewers,
        task_id=None,
        category="system",
        title=f"Новый запрос на ревью: {title}",
        body=f"Заказчик: {author_name}. Требуется рассмотрение.",
        importance="high",
        action_url=f"#/review/{request_id}",
        group_key=f"req_review_{request_id}",
    )


def notify_request_rejected(db: Session, request_id: int, author_id: int, title: str, reason: str):
    """Notify author that their request was rejected."""
    _send_to_users(
        db,
        [author_id],
        task_id=None,
        category="system",
        title=f"Запрос отклонён: {title}",
        body=f"Причина: {reason[:200]}",
        importance="high",
        action_url=f"#/customer/request/{request_id}",
        group_key=f"req_rejected_{request_id}",
    )


def notify_request_returned(db: Session, request_id: int, author_id: int, title: str, reason: str):
    """Notify the customer that their request needs clarification."""
    _send_to_users(
        db, [author_id], task_id=None, category="system",
        title=f"Нужно уточнить запрос: {title}", body=f"Комментарий ревьюера: {reason[:200]}",
        importance="high", action_url=f"#/customer/request/{request_id}",
        group_key=f"req_returned_{request_id}",
    )


def notify_request_in_progress(db: Session, request_id: int, author_id: int, title: str, task_id: int):
    """Notify the customer when review has produced an internal delivery task."""
    _send_to_users(
        db, [author_id], task_id=task_id, category="system",
        title=f"Запрос передан в проработку: {title}",
        body="Назначен аналитик и создана внутренняя задача команды.",
        importance="normal", action_url=f"#/customer/request/{request_id}",
        group_key=f"req_in_progress_{request_id}",
    )


def notify_request_assigned(db: Session, request_id: int, assignee_id: int, title: str):
    """Notify assigned BA about a new task."""
    _send_to_users(
        db,
        [assignee_id],
        task_id=None,
        category="assignment",
        title=f"Назначен на проработку: {title}",
        body="Требуется дополнительное уточнение требований.",
        importance="high",
        action_url=f"#/review/{request_id}",
        group_key=f"req_assigned_{request_id}",
    )
