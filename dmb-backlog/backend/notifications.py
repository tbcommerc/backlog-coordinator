"""
DMB Backlog - Notification Service
Event-driven notifications + scheduled scanning
"""
import json
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func

from models import (
    Notification, UserNotificationPreference, User, Role,
    Task, Team, TaskStatus
)


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
        action_url=action_url or f"#/backlog",
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
):
    for uid in user_ids:
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
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"

    recipients = _get_task_recipients(db, task)
    title = f"Статус задачи {task_label}: {old_status_name} → {new_status_name}"

    _send_to_users(
        db, recipients, task.id, "status_change", title,
        importance=IMPORTANCE["status_change"],
        action_url=f"#/backlog",
    )

    if new_status_name in RISK_STATUSES:
        lt_ids = _get_all_lt_user_ids(db)
        title_risk = f"Риск: задача {task_label} переведена в «{new_status_name}»"
        _send_to_users(
            db, lt_ids, task.id, "risk", title_risk,
            importance=IMPORTANCE["risk"],
            group_key=f"risk_{task.id}",
            action_url=f"#/backlog",
        )


def notify_assignment(
    db: Session,
    task: Task,
    new_owner_id: int,
):
    if not new_owner_id:
        return
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
    title = f"Вам назначена задача {task_label}"
    _send_to_users(
        db, [new_owner_id], task.id, "assignment", title,
        importance=IMPORTANCE["assignment"],
        action_url=f"#/backlog",
    )


def notify_mention(
    db: Session,
    task: Task,
    mentioned_user_ids: list[int] | None,
    author_name: str,
):
    if not mentioned_user_ids:
        return
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
    for uid in mentioned_user_ids:
        title = f"{author_name} упомянул вас в задаче {task_label}"
        _send_to_users(
            db, [uid], task.id, "mention", title,
            importance=IMPORTANCE["mention"],
            action_url=f"#/backlog",
        )


def notify_comment(
    db: Session,
    task: Task,
    commenter_id: int,
):
    if not task.owner_id or task.owner_id == commenter_id:
        return
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
    title = f"Новый комментарий к задаче {task_label}"
    _send_to_users(
        db, [task.owner_id], task.id, "comment", title,
        importance=IMPORTANCE["comment"],
        action_url=f"#/backlog",
    )


def notify_express_import(
    db: Session,
    task: Task,
    imported_by_name: str,
):
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
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
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
    title = f"Новая задача от заказчика ({customer_name}): {task_label}"
    recipients = _get_task_recipients(db, task)
    _send_to_users(
        db, recipients, task.id, "system", title,
        importance=IMPORTANCE["system"],
        action_url=f"#/backlog",
    )


def notify_lock_acquired(
    db: Session,
    task: Task,
    lock_owner_name: str,
):
    """Notify task owner + team PO/PL that someone started editing the task."""
    task_label = f"#{task.id}: «{task.title or 'Без названия'}»"
    title = f"Пользователь {lock_owner_name} начал редактирование задачи {task_label}"
    recipients = _get_task_recipients(db, task)
    _send_to_users(
        db, recipients, task.id, "editing", title,
        importance=IMPORTANCE["editing"],
        action_url=f"#/backlog",
    )


# ==================== SCHEDULED CHECK ====================

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

        if task.deadline:
            try:
                dl = task.deadline if isinstance(task.deadline, date) else task.deadline.date()
                if q_start <= dl <= q_end:
                    days_left = (dl - date.today()).days
                    deadline_tasks.append((task, days_left))
            except Exception:
                pass

        if not task.description or len(task.description) < 20:
            attrs_tasks.append((task, "no_description"))
        elif task.effort_days is None and task.effort_rub is None:
            attrs_tasks.append((task, "no_effort"))

    if stale_tasks:
        group_key = f"stale_{current_quarter}_{current_year}"
        sample_task = stale_tasks[0][0]
        recipients = _get_task_recipients(db, sample_task)
        count = len(stale_tasks)
        title = f"{count} {'задача' if count == 1 else 'задач'} без обновления > 5 дней"
        _send_to_users(
            db, recipients, None, "system", title,
            importance=IMPORTANCE["stale"],
            group_key=group_key,
            action_url=f"#/backlog",
        )

    if deadline_tasks:
        group_key = f"deadline_{current_quarter}_{current_year}"
        sample_task = deadline_tasks[0][0]
        recipients = _get_task_recipients(db, sample_task)
        urgent = sum(1 for _, d in deadline_tasks if d < 7)
        title_parts = []
        if urgent:
            title_parts.append(f"{urgent} с дедлайном < 7 дней")
        title_parts.append(f"{len(deadline_tasks)} задач с дедлайном в квартале")
        title = " | ".join(title_parts)
        _send_to_users(
            db, recipients, None, "system", title,
            importance=IMPORTANCE["deadline"],
            group_key=group_key,
            action_url=f"#/backlog",
        )

    if attrs_tasks:
        no_desc = sum(1 for _, k in attrs_tasks if k == "no_description")
        no_eff = sum(1 for _, k in attrs_tasks if k == "no_effort")
        group_key = f"attrs_{current_quarter}_{current_year}"
        sample_task = attrs_tasks[0][0]
        recipients = _get_task_recipients(db, sample_task)
        parts = []
        if no_desc:
            parts.append(f"{no_desc} без описания")
        if no_eff:
            parts.append(f"{no_eff} без оценки трудозатрат")
        title = f"Неполные атрибуты: {', '.join(parts)}"
        _send_to_users(
            db, recipients, None, "system", title,
            importance=IMPORTANCE["attrs"],
            group_key=group_key,
            action_url=f"#/backlog",
        )

    db.commit()


# ==================== QUERY HELPERS ====================

def get_unread_count(db: Session, user_id: int) -> int:
    return db.query(sql_func.count(Notification.id)).filter(
        Notification.user_id == user_id,
        Notification.is_read == False,
        Notification.is_dismissed == False,
    ).scalar() or 0


def get_notifications(
    db: Session,
    user_id: int,
    category: str | None = None,
    unread_only: bool = False,
    importance: str | None = None,
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

    total = q.count()
    items = q.order_by(Notification.created_at.desc()).offset(
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
    db.flush()


def dismiss_notification(db: Session, notification_id: int, user_id: int):
    db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user_id,
    ).update(
        {Notification.is_dismissed: True},
        synchronize_session=False,
    )
    db.flush()
