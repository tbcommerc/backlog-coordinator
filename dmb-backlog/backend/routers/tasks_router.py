from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, String, cast, case
from typing import Optional, List
from datetime import date, datetime, timezone
import json
import logging
import re
import threading
import uuid
from functools import wraps


logger = logging.getLogger("dmb_backlog.tasks")


_task_creation_lock = threading.Lock()
_task_creation_idempotency = {}
_task_update_idempotency = {}


def _serialize_task_creation(func):
    """Serialize ID allocation for the legacy SQLite tasks table."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        with _task_creation_lock:
            return func(*args, **kwargs)
    return wrapper


def _require_reference(db, model, value, field_name, label):
    if db.query(model).filter(model.id == value).first() is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{
                "loc": ["body", field_name],
                "msg": f"Выбранное значение «{label}» больше не существует. Обновите форму.",
                "type": "value_error.reference",
            }],
        )

from database import get_db
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer, AuditLog, CompetencyCostHistory, FieldLabel, Tag, IssueTag, DictionaryItem, TaskComment
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse, TaskListResponse,
    BulkActionRequest, SuccessResponse, BulkActionResponse, BulkPreviewResponse, TaskHistoryResponse, TaskLinkUpdate,
    PipDecisionRequest,
)
from auth import (
    get_current_user,
    check_permission,
    require_bulk_task_edit_access,
    require_backlog_page_access,
    authorize_task,
    can_access_task,
    can_edit_task,
    is_task_global_editor,
    can_comment_task,
    can_make_pip_decision,
)
from notifications import notify_status_change, notify_assignment, notify_comment, notify_mention
from routers.task_collaboration_router import is_task_lock_active

router = APIRouter(dependencies=[Depends(require_backlog_page_access)])

PIP_DECISION_ROLES = {
    "лидер трайба",
    "проектный офис (админ)",
    # Совместимость с текущей seed-ролью.
    "администратор",
}
PIP_DECISION_STATUS = "Принятие решения"
PIP_TARGET_STATUSES = {
    "reject": "Отклонена",
    "accept": "Принята в работу",
}

SORT_FIELD_MAP = {
    "priority": "priority_id",
    "status": "status_id",
    "deadline": "deadline_id",
    "project": "project_id",
    "task_type": "task_type_id",
    "source_channel": "channel_id",
    "customer_department": "department_id",
    "owner": "owner_id",
}


def task_to_response(task: Task, db: Optional[Session] = None) -> TaskResponse:
    """Convert Task ORM object to TaskResponse schema"""
    cv = task.cv

    resolved_task_type_id = task.task_type_id
    resolved_task_type_name = task.task_type.name if task.task_type else None
    resolved_channel_id = task.channel_id
    resolved_channel_name = task.channel.name if task.channel else None

    # Совместимость с задачами, которые ранее получили ID из legacy-таблицы
    # dictionary_items вместо канонических task_types/channels. Нормализация
    # выполняется только в ответе API и не изменяет данные в БД.
    if db is not None and task.task_type_id is not None and not resolved_task_type_name:
        legacy = db.query(DictionaryItem).filter(
            DictionaryItem.id == task.task_type_id,
            DictionaryItem.dict_type == "task_type",
        ).first()
        if legacy and legacy.name:
            legacy_name = legacy.name.strip().casefold()
            canonical = next(
                (item for item in db.query(TaskType).all() if (item.name or "").strip().casefold() == legacy_name),
                None,
            )
            if canonical:
                resolved_task_type_id = canonical.id
                resolved_task_type_name = canonical.name

    if db is not None and task.channel_id is not None and not resolved_channel_name:
        legacy = db.query(DictionaryItem).filter(
            DictionaryItem.id == task.channel_id,
            DictionaryItem.dict_type == "channel",
        ).first()
        if legacy and legacy.name:
            legacy_name = legacy.name.strip().casefold()
            canonical = next(
                (item for item in db.query(Channel).all() if (item.name or "").strip().casefold() == legacy_name),
                None,
            )
            if canonical:
                resolved_channel_id = canonical.id
                resolved_channel_name = canonical.name

    involved_team_names = None
    if task.involved_teams:
        team_ids = [t for t in task.involved_teams if isinstance(t, int)]
        if team_ids:
            if db is not None:
                team_names = {t.id: t.name for t in db.query(Team).filter(Team.id.in_(team_ids)).all()}
                involved_team_names = [team_names.get(i) or str(i) for i in team_ids]
            else:
                involved_team_names = [str(i) for i in team_ids]

    return TaskResponse(
        id=task.id,
        team_id=task.team_id,
        title=task.title,
        description=task.description,
        date_received=task.date_received,
        channel_id=resolved_channel_id,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=resolved_task_type_id,
        task_type_name=resolved_task_type_name,
        involved_teams=task.involved_teams,
        priority_id=task.priority_id,
        status_id=task.status_id,
        deadline_id=task.deadline_id,
        effort_days=task.effort_days,
        effort_rub=task.effort_rub,
        effort_designee=task.effort_designee,
        effort_analytics=task.effort_analytics,
        effort_be=task.effort_be,
        effort_python_be=task.effort_python_be,
        effort_fe=task.effort_fe,
        effort_test=task.effort_test,
        effort_test_auto=task.effort_test_auto,
        effort_delivery=task.effort_delivery,
        actual_effort_days=task.actual_effort_days,
        actual_effort_designee=task.actual_effort_designee,
        actual_effort_analytics=task.actual_effort_analytics,
        actual_effort_be=task.actual_effort_be,
        actual_effort_python_be=task.actual_effort_python_be,
        actual_effort_fe=task.actual_effort_fe,
        actual_effort_test=task.actual_effort_test,
        actual_effort_test_auto=task.actual_effort_test_auto,
        actual_effort_delivery=task.actual_effort_delivery,
        financial_effect=task.financial_effect,
        financial_effect_justification=task.financial_effect_justification,
        financial_effect_ai=task.financial_effect_ai,
        financial_effect_ai_justification=task.financial_effect_ai_justification,
        priority_score=task.priority_score,
        priority_justification=task.priority_justification,
        assessment_weight=task.assessment_weight,
        completion_forecast=task.completion_forecast,
        hard_score=task.hard_score,
        soft_score=task.soft_score,
        progress=task.progress,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        link_requirements=task.link_requirements,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        owner_id=task.owner_id,
        key_project_status=task.key_project_status,
        key_project_status_updated_at=task.key_project_status_updated_at,
        prev_key_project_status=task.prev_key_project_status,
        directorate_status=task.directorate_status,
        directorate_status_updated_at=task.directorate_status_updated_at,
        prev_directorate_status=task.prev_directorate_status,
        did_status=task.did_status,
        did_status_updated_at=task.did_status_updated_at,
        prev_did_status=task.prev_did_status,
        metric_kr_plan=task.metric_kr_plan,
        metric_kr_fact=task.metric_kr_fact,
        metric_kr_unit=task.metric_kr_unit,
        cv=cv,
        created_by=task.created_by,
        created_by_name=task.creator.name if task.creator else None,
        involved_team_names=involved_team_names,
        tags=[
            {"id": t.id, "name": t.name, "color": t.color, "description": t.description}
            for t in (task.tags or [])
        ],
        created_at=task.created_at,
        updated_at=task.updated_at,
        team_name=task.team.name if task.team else None,
        channel_name=resolved_channel_name,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        owner_name=task.owner.name if task.owner else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
        did_demo=task.did_demo if task.did_demo else False,
        version=task.version or 0,
        lock_owner_id=task.lock_owner_id,
        lock_owner_name=task.lock_owner.name if task.lock_owner else None,
        lock_until=task.lock_until,
    )


# Компетенции и соответствующие поля ЭО (для авторасчёта стоимости по ЭО)
COMPETENCY_EFFORT_FIELDS = [
    ("effort_designee", "Designee"),
    ("effort_analytics", "Аналитика"),
    ("effort_be", "Разработка BE"),
    ("effort_python_be", "Разработка python BE"),
    ("effort_fe", "Разработка FE"),
    ("effort_test", "Tester"),
    ("effort_test_auto", "Tester Auto"),
    ("effort_delivery", "Delivery"),
]

ACTUAL_EFFORT_FIELDS = [
    "actual_effort_designee",
    "actual_effort_analytics",
    "actual_effort_be",
    "actual_effort_python_be",
    "actual_effort_fe",
    "actual_effort_test",
    "actual_effort_test_auto",
    "actual_effort_delivery",
]


def _apply_tags(db: Session, task: Task, tag_names: Optional[List[str]], user_id: Optional[int] = None) -> None:
    """Синхронизирует теги задачи (по именам) с таблицей issue_tags.

    Отсутствующие теги автоматически создаются в справочнике tags.
    """
    db.query(IssueTag).filter(IssueTag.issue_id == task.id).delete()

    seen = set()
    for raw in tag_names or []:
        name = (raw or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        tag = db.query(Tag).filter(func.lower(Tag.name) == key).first()
        if tag is None:
            tag = Tag(name=name, color="#6366f1", creator=user_id)
            db.add(tag)
            db.flush()
        db.add(IssueTag(issue_id=task.id, tag_id=tag.id))
    db.flush()


def _year_from_deadline(db: Session, deadline_id: Optional[int]) -> Optional[int]:
    """Год из кода дедлайна (последние 4 цифры: Q1_2026 -> 2026, Y2026 -> 2026).

    Возвращает None, если дедлайн не задан или в коде нет года (no_deadline).
    """
    if deadline_id is None:
        return None
    deadline = db.query(Deadline).filter(Deadline.id == deadline_id).first()
    if not deadline or not deadline.code:
        return None
    match = re.search(r"(\d{4})$", deadline.code.strip())
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def _competency_costs(db: Session, year: Optional[int] = None) -> dict:
    """Стоимость чел-дня по компетенциям из competency_cost_history.

    Для каждой компетенции берётся ставка года `year`; если год не задан или
    для него нет записи — ставка максимального (актуального) года.
    """
    items = db.query(CompetencyCostHistory).filter(
        CompetencyCostHistory.is_active == True
    ).all()
    by_competency: dict[str, dict[int, float]] = {}
    for it in items:
        by_competency.setdefault(it.competency, {})[it.year] = float(it.rate or 0)

    costs = {}
    for comp, rates in by_competency.items():
        rate = rates.get(year) if year is not None else None
        if rate is None and rates:
            rate = rates[max(rates)]
        costs[comp] = rate or 0
    return costs


def compute_effort_rub(db: Session, values: dict, fallback: Optional[float], year: Optional[int] = None) -> Optional[float]:
    """Авторасчёт стоимости по ЭО: Σ(ЭО по ролям × ставка роли). С 2 знаками.

    Ставки берутся по году дедлайна задачи (`year`); если он не передан,
    год извлекается из `values['deadline_id']`. Если год не определён —
    используются актуальные ставки (максимальный год).

    Если ни одно из полей ЭО по ролям не заполнено — возвращает сохранённое значение (fallback).
    """
    if year is None:
        year = _year_from_deadline(db, values.get("deadline_id"))
    costs = _competency_costs(db, year)
    total = 0.0
    any_value = False
    for field, comp in COMPETENCY_EFFORT_FIELDS:
        val = values.get(field)
        if val is None:
            val = 0
        if val:
            any_value = True
        total += float(val or 0) * costs.get(comp, 0)
    if any_value:
        return round(total, 2)
    return fallback


def recalculate_effort_rub_for_all(db: Session) -> int:
    """Пересчитывает effort_rub и cv всех задач с заполненными ЭО по ролям.

    Ставки берутся по году дедлайна каждой задачи (fallback — актуальный год).
    Возвращает количество пересчитанных задач.
    """
    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    changed = 0
    for task in tasks:
        if not any(getattr(task, f) for f, _ in COMPETENCY_EFFORT_FIELDS):
            continue
        vals = {f: getattr(task, f) for f, _ in COMPETENCY_EFFORT_FIELDS}
        year = _year_from_deadline(db, task.deadline_id)
        new_rub = compute_effort_rub(db, vals, task.effort_rub, year)
        if new_rub is not None and new_rub != task.effort_rub:
            task.effort_rub = new_rub
            if task.financial_effect is not None and new_rub > 0:
                task.cv = round(float(task.financial_effect) / float(new_rub), 2)
            else:
                task.cv = None
            changed += 1
    if changed:
        db.flush()
    return changed


def compute_actual_effort_days(values: dict) -> Optional[float]:
    """Авторасчёт фактических трудозатрат: сумма полей ФТЗ по 8 компетенциям.

    Если ни одно из полей не заполнено (None/0) — возвращает None.
    """
    total = 0.0
    any_value = False
    for field in ACTUAL_EFFORT_FIELDS:
        val = values.get(field)
        if val:
            any_value = True
            total += float(val)
    if not any_value:
        return None
    return round(total, 2)


def recalculate_actual_effort_days_for_all(db: Session) -> int:
    """Пересчитывает actual_effort_days всех задач из суммы полей ФТЗ.

    Возвращает количество пересчитанных задач.
    """
    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    changed = 0
    for task in tasks:
        if not any(getattr(task, f) for f in ACTUAL_EFFORT_FIELDS):
            continue
        new_days = compute_actual_effort_days({f: getattr(task, f) for f in ACTUAL_EFFORT_FIELDS})
        if new_days != task.actual_effort_days:
            task.actual_effort_days = new_days
            changed += 1
    if changed:
        db.commit()
    return changed


@router.get("/", response_model=TaskListResponse)
def get_tasks(
    team_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=200),
    sort_by: str = Query("id", max_length=50),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get filtered list of tasks"""
    query = db.query(Task).filter(Task.is_deleted == False)

    if not check_permission(current_user, "backlog_dmb", "read"):
        user_team_id = current_user.team_id
        if user_team_id:
            query = query.filter(Task.team_id == user_team_id)
        else:
            query = query.filter(False)

    if team_id:
        query = query.filter(Task.team_id == team_id)
    if status:
        query = query.join(TaskStatus, Task.status_id == TaskStatus.id).filter(TaskStatus.name == status)
    if priority:
        query = query.join(Priority, Task.priority_id == Priority.id).filter(Priority.name == priority)
    if search:
        query = query.filter(Task.title.ilike(f"%{search}%"))

    sort_column_name = SORT_FIELD_MAP.get(sort_by, sort_by)
    sort_column = getattr(Task, sort_column_name, Task.id)
    if sort_order == "desc":
        query = query.order_by(desc(sort_column))
    else:
        query = query.order_by(asc(sort_column))

    total = query.count()
    offset = (page - 1) * per_page
    tasks = query.offset(offset).limit(per_page).all()

    items = [task_to_response(task, db) for task in tasks]

    return TaskListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page
    )


@router.get("/search", response_model=List[TaskResponse])
def search_tasks(
    q: str = Query("", min_length=1, max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Search tasks by title, ID, or owner name"""
    query = db.query(Task).filter(Task.is_deleted == False)

    if q:
        owner_ids = db.query(User.id).filter(User.name.ilike(f"%{q}%"))
        search_filter = (
            Task.title.ilike(f"%{q}%") |
            cast(Task.id, String).ilike(f"%{q}%") |
            Task.owner_id.in_(owner_ids)
        )
        query = query.filter(search_filter)

    tasks = query.limit(10).all()

    return [task_to_response(task, db) for task in tasks]


@router.get("/stats")
def get_task_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return aggregated task statistics"""
    base_query = db.query(Task).filter(Task.is_deleted == False)
    total = base_query.count()

    terminal_statuses = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")
    active = base_query.join(TaskStatus, Task.status_id == TaskStatus.id).filter(
        TaskStatus.name.notin_(terminal_statuses)
    ).count()

    at_risk_deadlines = ("1Q 2026", "2Q 2026")
    risk = base_query.join(TaskStatus, Task.status_id == TaskStatus.id).join(
        Deadline, Task.deadline_id == Deadline.id
    ).filter(
        TaskStatus.name.in_(("СБОР ТРЕБОВАНИЙ", "ЭКСПРЕСС-ОЦЕНКА"))
    ).filter(
        Deadline.name.in_(at_risk_deadlines)
    ).count()

    no_estimate = base_query.filter(
        Task.effort_days == None,
        Task.effort_rub == None
    ).count()

    status_rows = db.query(TaskStatus.name, func.count(Task.id)).join(
        TaskStatus, Task.status_id == TaskStatus.id
    ).filter(
        Task.is_deleted == False
    ).group_by(TaskStatus.name).all()
    by_status = {row[0]: row[1] for row in status_rows}

    priority_rows = db.query(Priority.name, func.count(Task.id)).join(
        Priority, Task.priority_id == Priority.id
    ).filter(
        Task.is_deleted == False
    ).group_by(Priority.name).all()
    by_priority = {row[0]: row[1] for row in priority_rows}

    total_financial_effect = db.query(func.coalesce(func.sum(Task.financial_effect), 0.0)).filter(
        Task.is_deleted == False
    ).scalar()
    avg_progress = db.query(func.coalesce(func.avg(Task.progress), 0.0)).filter(
        Task.is_deleted == False
    ).scalar()

    team_rows = db.query(
        Team.name,
        func.count(Task.id),
        func.sum(case(
            (TaskStatus.name.notin_(terminal_statuses), 1), else_=0
        )),
        func.coalesce(func.avg(Task.progress), 0.0)
    ).join(Task, Task.team_id == Team.id).join(
        TaskStatus, Task.status_id == TaskStatus.id
    ).filter(
        Task.is_deleted == False
    ).group_by(Team.name).all()

    by_team = {}
    for name, total_t, active_t, avg_p in team_rows:
        by_team[name] = {
            "total": total_t,
            "active": active_t,
            "avg_progress": round(avg_p, 1)
        }

    return {
        "total": total,
        "active": active,
        "risk": risk,
        "no_estimate": no_estimate,
        "by_status": by_status,
        "by_priority": by_priority,
        "by_team": by_team,
        "total_financial_effect": float(total_financial_effect),
        "avg_progress": round(float(avg_progress), 1)
    }


@router.get("/reference")
def get_task_reference(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return reference data for task editing (statuses, priorities, etc.)"""
    statuses = db.query(TaskStatus).order_by(TaskStatus.sort_order).all()
    priorities = db.query(Priority).order_by(Priority.name).all()
    deadlines = db.query(Deadline).order_by(Deadline.name).all()
    teams = db.query(Team).order_by(Team.name).all()
    projects = db.query(Project).order_by(Project.name).all()
    task_types = db.query(TaskType).order_by(TaskType.name).all()
    channels = db.query(Channel).order_by(Channel.name).all()
    departments = db.query(Department).order_by(Department.name).all()
    business_customers = db.query(BusinessCustomer).order_by(BusinessCustomer.name).all()

    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()

    return {
        "statuses": [{"id": s.id, "name": s.name} for s in statuses],
        "priorities": [{"id": p.id, "name": p.name} for p in priorities],
        "deadlines": [{"id": d.id, "name": d.name} for d in deadlines],
        "teams": [{"id": t.id, "name": t.name} for t in teams],
        "projects": [{"id": p.id, "name": p.name} for p in projects],
        "task_types": [{"id": t.id, "name": t.name} for t in task_types],
        "channels": [{"id": c.id, "name": c.name} for c in channels],
        "departments": [{"id": d.id, "name": d.name} for d in departments],
        "business_customers": [{"id": b.id, "name": b.name, "department_id": b.department_id} for b in business_customers],
        "users": [{"id": u.id, "name": u.name, "team_id": u.team_id} for u in users],
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in db.query(Tag).order_by(Tag.name).all()]
    }


@router.get("/report/{kind}")
def get_report(
    kind: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Generate report data based on report config kind"""
    if kind not in ("directorate", "did", "projects", "reg-directors"):
        raise HTTPException(status_code=400, detail="Invalid report kind")

    total = db.query(Task).filter(Task.is_deleted == False).count()
    terminal = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")

    if kind == "directorate":
        rows = db.query(
            func.coalesce(Project.name, "Без проекта"),
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(case((TaskStatus.name == "ВЫПОЛНЕНА", 1), else_=0)),
            func.coalesce(func.sum(Task.financial_effect), 0.0)
        ).join(Project, Task.project_id == Project.id, isouter=True).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(Task.is_deleted == False).group_by(Project.name).all()
        groups = [
            {"project": r[0], "total": r[1], "active": r[2], "done": r[3], "total_financial_effect": float(r[4])}
            for r in rows
        ]
        return {"kind": kind, "groups": groups, "total": total}

    elif kind == "did":
        rows = db.query(
            func.coalesce(BusinessCustomer.name, "Без заказчика"),
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.coalesce(func.sum(Task.financial_effect), 0.0)
        ).join(TaskStatus, Task.status_id == TaskStatus.id).join(
            BusinessCustomer, Task.business_customer_id == BusinessCustomer.id, isouter=True
        ).filter(
            Task.is_deleted == False
        ).group_by(BusinessCustomer.name).all()
        groups = [
            {"customer": r[0], "total": r[1], "active": r[2], "total_financial_effect": float(r[3])}
            for r in rows
        ]
        return {"kind": kind, "groups": groups, "total": total}

    elif kind == "projects":
        rows = db.query(
            func.coalesce(Project.name, "Без проекта"),
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(case((TaskStatus.name == "ВЫПОЛНЕНА", 1), else_=0)),
            func.coalesce(func.avg(Task.progress), 0.0)
        ).join(Project, Task.project_id == Project.id, isouter=True).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(Task.is_deleted == False).group_by(Project.name).all()
        groups = [
            {"project": r[0], "total": r[1], "active": r[2], "done": r[3], "progress_avg": round(float(r[4]), 1)}
            for r in rows
        ]
        return {"kind": kind, "groups": groups, "total": total}

    elif kind == "reg-directors":
        at_risk_deadlines = ("1Q 2026", "2Q 2026")
        risk_condition = (TaskStatus.name.in_(("СБОР ТРЕБОВАНИЙ", "ЭКСПРЕСС-ОЦЕНКА"))) & (Deadline.name.in_(at_risk_deadlines))
        rows = db.query(
            Team.name,
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(case((risk_condition, 1), else_=0)),
            func.coalesce(func.avg(Task.progress), 0.0)
        ).join(Task, Task.team_id == Team.id).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).join(
            Deadline, Task.deadline_id == Deadline.id, isouter=True
        ).filter(
            Task.is_deleted == False
        ).group_by(Team.name).all()
        groups = [
            {"team": r[0], "total": r[1], "active": r[2], "risk": r[3], "avg_progress": round(float(r[4]), 1)}
            for r in rows
        ]
        return {"kind": kind, "groups": groups, "total": total}
































@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get single task by ID"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("read", task, current_user)

    return task_to_response(task, db)


@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
@_serialize_task_creation
def create_task(task_data: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create new task with auto-calculations and audit logging"""
    if not check_permission(current_user, "backlog_team", "write_own"):
        raise HTTPException(status_code=403, detail="Permission denied")

    request_key = str(task_data.client_request_id or '').strip()
    cache_key = (current_user.id, request_key) if request_key else None
    if cache_key and cache_key in _task_creation_idempotency:
        existing = db.query(Task).filter(Task.id == _task_creation_idempotency[cache_key], Task.is_deleted == False).first()
        if existing:
            return task_to_response(existing, db)

    _require_reference(db, Team, task_data.team_id, "team_id", "Ответственная команда")
    _require_reference(db, TaskType, task_data.task_type_id, "task_type_id", "Тип задачи")
    _require_reference(db, Channel, task_data.channel_id, "channel_id", "Канал поступления")
    optional_references = (
        (Project, task_data.project_id, "project_id", "Проект"),
        (BusinessCustomer, task_data.business_customer_id, "business_customer_id", "Бизнес-заказчик"),
        (User, task_data.owner_id, "owner_id", "Исполнитель"),
        (Deadline, task_data.deadline_id, "deadline_id", "Срок выполнения"),
    )
    for model, value, field_name, label in optional_references:
        if value is not None:
            _require_reference(db, model, value, field_name, label)

    # 1. Calculate C/V if both financial_effect and effort_rub are provided
    cv = None
    if task_data.financial_effect is not None and task_data.effort_rub is not None and task_data.effort_rub > 0:
        cv = round(task_data.financial_effect / task_data.effort_rub, 2)

    # 2. Defaults are resolved by stable dictionary values, never by magic IDs.
    status_id = task_data.status_id
    if status_id is None:
        default_status = db.query(TaskStatus).filter(TaskStatus.code == "new").first()
        if default_status is None:
            default_status = next((item for item in db.query(TaskStatus).all() if item.name.casefold() == "новая задача"), None)
        if default_status is None:
            raise HTTPException(status_code=500, detail="В справочнике отсутствует статус «Новая задача»")
        status_id = default_status.id
    else:
        _require_reference(db, TaskStatus, status_id, "status_id", "Статус")

    priority_id = task_data.priority_id
    if priority_id is None:
        default_priority = next((item for item in db.query(Priority).all() if item.name.casefold() == "средний"), None)
        if default_priority is None:
            raise HTTPException(status_code=500, detail="В справочнике отсутствует приоритет «Средний»")
        priority_id = default_priority.id
    else:
        _require_reference(db, Priority, priority_id, "priority_id", "Приоритет")

    # Auto-calculate effort cost from role estimates x competency rates
    effort_rub = compute_effort_rub(db, task_data.model_dump(), task_data.effort_rub)

    # Auto-fill department from the selected business customer when not provided
    department_id = task_data.department_id
    if department_id is None and task_data.business_customer_id is not None:
        customer = db.query(BusinessCustomer).filter(BusinessCustomer.id == task_data.business_customer_id).first()
        if customer and customer.department_id is not None:
            department_id = customer.department_id

    # The current SQLite database was imported with a typeless `tasks.id`
    # column and therefore cannot provide ROWID autoincrement. Assign the ID
    # explicitly. The process-wide lock above keeps concurrent allocations
    # unique without rewriting the existing table or its data.
    next_task_id = (db.query(func.max(Task.id)).scalar() or 0) + 1
    created_now = datetime.now(timezone.utc)

    task = Task(
        id=next_task_id,
        team_id=task_data.team_id,
        title=task_data.title,
        description=task_data.description,
        date_received=task_data.date_received or date.today(),
        channel_id=task_data.channel_id,
        business_customer_id=task_data.business_customer_id,
        department_id=department_id,
        project_id=task_data.project_id,
        task_type_id=task_data.task_type_id,
        involved_teams=task_data.involved_teams,
        priority_id=priority_id,
        status_id=status_id,
        deadline_id=task_data.deadline_id,
        effort_days=task_data.effort_days,
        effort_rub=effort_rub,
        effort_designee=task_data.effort_designee,
        effort_analytics=task_data.effort_analytics,
        effort_be=task_data.effort_be,
        effort_python_be=task_data.effort_python_be,
        effort_fe=task_data.effort_fe,
        effort_test=task_data.effort_test,
        effort_test_auto=task_data.effort_test_auto,
        effort_delivery=task_data.effort_delivery,
        actual_effort_days=compute_actual_effort_days(task_data.model_dump()),
        actual_effort_designee=task_data.actual_effort_designee,
        actual_effort_analytics=task_data.actual_effort_analytics,
        actual_effort_be=task_data.actual_effort_be,
        actual_effort_python_be=task_data.actual_effort_python_be,
        actual_effort_fe=task_data.actual_effort_fe,
        actual_effort_test=task_data.actual_effort_test,
        actual_effort_test_auto=task_data.actual_effort_test_auto,
        actual_effort_delivery=task_data.actual_effort_delivery,
        financial_effect=task_data.financial_effect,
        financial_effect_justification=task_data.financial_effect_justification,
        financial_effect_ai=task_data.financial_effect_ai,
        financial_effect_ai_justification=task_data.financial_effect_ai_justification,
        priority_score=task_data.priority_score,
        priority_justification=task_data.priority_justification,
        assessment_weight=task_data.assessment_weight,
        completion_forecast=task_data.completion_forecast,
        hard_score=task_data.hard_score,
        soft_score=task_data.soft_score,
        cv=cv,
        progress=task_data.progress,
        link_mockups=task_data.link_mockups,
        link_jira=task_data.link_jira,
        link_requirements=task_data.link_requirements,
        rejection_reason=task_data.rejection_reason,
        comment=task_data.comment,
        owner_id=task_data.owner_id,
        key_project_status=task_data.key_project_status,
        directorate_status=task_data.directorate_status,
        did_status=task_data.did_status,
        metric_kr_plan=task_data.metric_kr_plan,
        metric_kr_fact=task_data.metric_kr_fact,
        metric_kr_unit=task_data.metric_kr_unit,
        did_demo=task_data.did_demo,
        created_by=current_user.id,
        created_at=created_now,
        updated_at=created_now,
    )

    db.add(task)
    db.flush()

    _apply_tags(db, task, task_data.tags, current_user.id)

    # 4. Record creation in task_history
    history_fields = [
        ("title", None, task.title),
        ("status_id", None, str(task.status_id)),
        ("priority_id", None, str(task.priority_id)),
        ("team_id", None, str(task.team_id)),
    ]
    if task.description:
        history_fields.append(("description", None, task.description))
    if task.deadline_id:
        history_fields.append(("deadline_id", None, str(task.deadline_id)))
    if task.financial_effect is not None:
        history_fields.append(("financial_effect", None, str(task.financial_effect)))
    if task.effort_days is not None:
        history_fields.append(("effort_days", None, str(task.effort_days)))
    if task.effort_rub is not None:
        history_fields.append(("effort_rub", None, str(task.effort_rub)))

    for field_name, old_val, new_val in history_fields:
        history = TaskHistory(
            task_id=task.id,
            changed_by=current_user.id,
            field_name=field_name,
            old_value=old_val,
            new_value=new_val
        )
        db.add(history)

    # 5. Record in audit_log
    audit = AuditLog(
        user_id=current_user.id,
        action="create",
        entity_type="task",
        entity_id=task.id,
        details=f"Task '{task.title}' created with status_id={task.status_id}",
    )
    db.add(audit)

    # Notifications: assignment on creation
    if task.owner_id:
        notify_assignment(db, task, task.owner_id, current_user.id)

    db.commit()
    db.refresh(task)

    if cache_key:
        _task_creation_idempotency[cache_key] = task.id
        if len(_task_creation_idempotency) > 1000:
            _task_creation_idempotency.pop(next(iter(_task_creation_idempotency)))

    return task_to_response(task, db)


@router.put("/{task_id}/pip-decision", response_model=TaskResponse)
def apply_pip_decision(
    task_id: int,
    payload: PipDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перевести задачу из PI-решения в один из двух разрешённых статусов."""
    if not can_make_pip_decision(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PI-решение доступно только Лидеру трайба и проектному офису",
        )

    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    current_status_name = task.status.name if task.status else ""
    if current_status_name.strip().casefold() != PIP_DECISION_STATUS.casefold():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Решение можно принять только по задаче в статусе «Принятие решения»",
        )

    if is_task_lock_active(task) and task.lock_owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Задача заблокирована другим пользователем",
        )

    target_name = PIP_TARGET_STATUSES[payload.decision]
    target_status = db.query(TaskStatus).filter(
        func.lower_unicode(TaskStatus.name) == target_name.casefold()
    ).first()
    if not target_status:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Статус «{target_name}» не найден в справочнике",
        )

    db.add(TaskHistory(
        task_id=task.id,
        changed_by=current_user.id,
        field_name="status_id",
        old_value=str(task.status_id) if task.status_id else None,
        new_value=str(target_status.id),
    ))
    task.status_id = target_status.id
    task.version = (task.version or 0) + 1
    notify_status_change(db, task, current_status_name, target_name, current_user.id)
    db.commit()
    db.refresh(task)
    return task_to_response(task, db)


@router.patch("/{task_id}", response_model=TaskResponse)
@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update existing task"""
    try:
        task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        # PO/PL/CL, BA/Участник команды и IT PL редактируют только задачи
        # своей команды. Проектный офис (админ) может редактировать все задачи.
        requested_team_id = task_data.team_id if "team_id" in task_data.model_fields_set else None
        authorize_task("edit", task, current_user, requested_team_id)

        request_key = str(task_data.client_request_id or '').strip()
        cache_key = (current_user.id, task_id, request_key) if request_key else None
        if cache_key and cache_key in _task_update_idempotency:
            return task_to_response(task, db)

        if is_task_lock_active(task) and task.lock_owner_id != current_user.id:
            owner = db.query(User).filter(User.id == task.lock_owner_id).first()
            raise HTTPException(
                status_code=423,
                detail=f"Задача в данный момент редактируется пользователем {owner.name if owner else 'Неизвестный'}. Доступен режим 'только чтение'"
            )

        # Capture old values before changes
        old_status_id = task.status_id
        old_owner_id = task.owner_id
        old_dir_status = task.directorate_status
        old_did_status = task.did_status
        old_key_status = task.key_project_status

        update_data = task_data.model_dump(exclude_unset=True)
        update_data.pop('client_request_id', None)
        logger.info(f"[update_task] task_id={task_id}, update_data={update_data}")

        requested_actual_fields = set(update_data) & set(ACTUAL_EFFORT_FIELDS)
        if requested_actual_fields and not is_task_global_editor(current_user):
            raise HTTPException(status_code=403, detail="Фактические трудозатраты может корректировать только администратор")

        # Optimistic lock: extract and check version before applying changes
        submitted_version = update_data.pop('version', None)
        # actual_effort_days is always computed from actual effort fields
        update_data.pop('actual_effort_days', None)
        # tags — обрабатываются отдельно через issue_tags (не колонка ORM)
        tag_names = update_data.pop('tags', None)

        reference_fields = {
            'team_id': (Team, 'Ответственная команда'),
            'task_type_id': (TaskType, 'Тип задачи'),
            'channel_id': (Channel, 'Канал поступления'),
            'priority_id': (Priority, 'Приоритет'),
            'status_id': (TaskStatus, 'Статус'),
            'project_id': (Project, 'Проект'),
            'business_customer_id': (BusinessCustomer, 'Бизнес-заказчик'),
            'owner_id': (User, 'Исполнитель'),
            'deadline_id': (Deadline, 'Срок выполнения'),
        }
        for field_name, (model, label) in reference_fields.items():
            value = update_data.get(field_name)
            if value is not None:
                _require_reference(db, model, value, field_name, label)

        if submitted_version is not None and submitted_version != (task.version or 0):
            current = task_to_response(task, db)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Задача была изменена другим пользователем. Пожалуйста, обновите страницу и повторите изменения.",
                    "current_version": task.version or 0,
                    "submitted_version": submitted_version,
                    "task": current.model_dump(mode="json")
                }
            )

        # Auto-fill department from the selected business customer when not provided
        if 'business_customer_id' in update_data and 'department_id' not in update_data:
            if update_data['business_customer_id'] is not None:
                customer = db.query(BusinessCustomer).filter(BusinessCustomer.id == update_data['business_customer_id']).first()
                if customer and customer.department_id is not None:
                    update_data['department_id'] = customer.department_id

        for field, new_value in update_data.items():
            if not hasattr(task, field):
                logger.warning(f"[update_task] Unknown field '{field}' for task {task_id}, skipping")
                continue
            old_value = getattr(task, field, None)
            if str(old_value) != str(new_value):
                history = TaskHistory(
                    task_id=task.id,
                    changed_by=current_user.id,
                    field_name=field,
                    old_value=str(old_value) if old_value else None,
                    new_value=str(new_value) if new_value else None
                )
                db.add(history)
            setattr(task, field, new_value)

        # Apply tags (m2m) after direct field updates
        if tag_names is not None:
            _apply_tags(db, task, tag_names, current_user.id)

        # Auto-calculate actual effort days from actual effort fields (ФТЗ)
        if any(f in update_data for f in ACTUAL_EFFORT_FIELDS):
            task.actual_effort_days = compute_actual_effort_days({f: getattr(task, f) for f in ACTUAL_EFFORT_FIELDS})

        # Auto-calculate effort cost from role estimates x competency rates
        if any(f in update_data for f, _ in COMPETENCY_EFFORT_FIELDS):
            vals = {f: getattr(task, f) for f, _ in COMPETENCY_EFFORT_FIELDS}
            task.effort_rub = compute_effort_rub(db, vals, task.effort_rub, _year_from_deadline(db, task.deadline_id))

        # Auto-calculate C/V if financial_effect or effort_rub changed
        if 'financial_effect' in update_data or 'effort_rub' in update_data:
            if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
                task.cv = round(float(task.financial_effect) / float(task.effort_rub), 2)
            else:
                task.cv = None

        # Auto-set timestamps when status fields change; shift old status into prev_*
        from datetime import datetime, timezone
        if 'directorate_status' in update_data:
            if 'prev_directorate_status' not in update_data and old_dir_status:
                task.prev_directorate_status = old_dir_status
                db.add(TaskHistory(
                    task_id=task.id,
                    changed_by=current_user.id,
                    field_name='prev_directorate_status',
                    old_value=None,
                    new_value=old_dir_status,
                ))
            task.directorate_status_updated_at = datetime.now(timezone.utc)
        if 'did_status' in update_data:
            if 'prev_did_status' not in update_data and old_did_status:
                task.prev_did_status = old_did_status
                db.add(TaskHistory(
                    task_id=task.id,
                    changed_by=current_user.id,
                    field_name='prev_did_status',
                    old_value=None,
                    new_value=old_did_status,
                ))
            task.did_status_updated_at = datetime.now(timezone.utc)
        if 'key_project_status' in update_data:
            if 'prev_key_project_status' not in update_data and old_key_status:
                task.prev_key_project_status = old_key_status
                db.add(TaskHistory(
                    task_id=task.id,
                    changed_by=current_user.id,
                    field_name='prev_key_project_status',
                    old_value=None,
                    new_value=old_key_status,
                ))
            task.key_project_status_updated_at = datetime.now(timezone.utc)

        # Notifications: status change
        new_status_id = task.status_id
        if old_status_id != new_status_id:
            if old_status_id:
                old_status = db.query(TaskStatus).filter(TaskStatus.id == old_status_id).first()
                old_name = old_status.name if old_status else str(old_status_id)
            else:
                old_name = "Не установлен"
            if new_status_id:
                new_status = db.query(TaskStatus).filter(TaskStatus.id == new_status_id).first()
                new_name = new_status.name if new_status else str(new_status_id)
            else:
                new_name = "Не установлен"
            notify_status_change(db, task, old_name, new_name, current_user.id)

        # Notifications: assignment change
        new_owner_id = task.owner_id
        if old_owner_id != new_owner_id and new_owner_id:
            notify_assignment(db, task, new_owner_id, current_user.id)

        # Version, task fields, tags, history and notifications are committed
        # atomically as one use-case.
        task.version = (task.version or 0) + 1
        db.commit()
        db.refresh(task)

        if cache_key:
            _task_update_idempotency[cache_key] = task.version
            if len(_task_update_idempotency) > 2000:
                _task_update_idempotency.pop(next(iter(_task_update_idempotency)))

        return task_to_response(task, db)

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("Unexpected task update failure task_id=%s", task_id)
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.get("/{task_id}/history", response_model=List[TaskHistoryResponse])
def get_task_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get change history for a task"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("read", task, current_user)

    history = db.query(TaskHistory).filter(
        TaskHistory.task_id == task_id
    ).order_by(TaskHistory.changed_at.desc()).limit(50).all()

    # Названия полей берутся из реестра field_labels (источник истины)
    FIELD_LABELS = {fl.key: fl.label for fl in db.query(FieldLabel).all()}

    result = []
    for h in history:
        changer = db.query(User).filter(User.id == h.changed_by).first()
        result.append(TaskHistoryResponse(
            id=h.id,
            task_id=h.task_id,
            changed_by=h.changed_by,
            changed_by_name=changer.name if changer else None,
            changed_at=h.changed_at,
            field_name=h.field_name,
            field_label=FIELD_LABELS.get(h.field_name, h.field_name),
            old_value=h.old_value,
            new_value=h.new_value,
        ))
    return result


@router.get("/{task_id}/documents")
def get_task_documents(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get documents and links associated with a task"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("read", task, current_user)

    docs = []
    if task.link_mockups:
        docs.append({"type": "mockups", "title": "Макеты / БТ", "url": task.link_mockups})
    if task.link_jira:
        if isinstance(task.link_jira, list):
            for url in task.link_jira:
                if url:
                    docs.append({"type": "jira", "title": "Jira Task", "url": url})
        else:
            docs.append({"type": "jira", "title": "Jira Task", "url": task.link_jira})

    if task.link_requirements:
        if isinstance(task.link_requirements, list):
            for url in task.link_requirements:
                if url:
                    docs.append({"type": "requirements", "title": "Бизнес-требования", "url": url})
        else:
            docs.append({"type": "requirements", "title": "Бизнес-требования", "url": task.link_requirements})

    return {"documents": docs}


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Soft delete task"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    authorize_task("delete", task, current_user)

    task.is_deleted = True
    db.commit()
    return {"message": "Task deleted"}

















@router.put("/{task_id}/links", response_model=TaskResponse)
def update_task_links(
    task_id: int,
    data: TaskLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("edit", task, current_user)

    changes = {}
    if data.link_mockups is not None and data.link_mockups != (task.link_mockups or ""):
        old = task.link_mockups or ""
        task.link_mockups = data.link_mockups
        changes["link_mockups"] = (old, data.link_mockups)
    if data.link_jira is not None:
        new_jira = [data.link_jira] if isinstance(data.link_jira, str) else data.link_jira
        old_jira = task.link_jira or []
        if new_jira != old_jira:
            task.link_jira = new_jira
            changes["link_jira"] = (old_jira, new_jira)

    for field_name, (old_val, new_val) in changes.items():
        old_val = old_val if isinstance(old_val, str) else json.dumps(old_val, ensure_ascii=False) if old_val else None
        new_val = new_val if isinstance(new_val, str) else json.dumps(new_val, ensure_ascii=False) if new_val else None
        history = TaskHistory(
            task_id=task_id,
            changed_by=current_user.id,
            field_name=field_name,
            old_value=old_val if old_val else None,
            new_value=new_val if new_val else None,
        )
        db.add(history)

    db.commit()
    db.refresh(task)

    return task_to_response(task, db)


ALLOWED_BULK_FIELDS = {
    'status_id', 'priority_id', 'progress', 'deadline_id', 'owner_id',
    'team_id', 'project_id', 'task_type_id', 'channel_id', 'department_id',
    'business_customer_id', 'key_project_status',
    'directorate_status', 'did_status',
    'effort_days', 'effort_rub', 'financial_effect',
    'rejection_reason',
    'link_jira', 'link_mockups', 'date_received',
    'tags_add', 'tags_remove'
}

FORBIDDEN_BULK_FIELDS = {
    'id', 'title', 'description', 'is_deleted', 'version', 'created_at',
    'updated_at', 'created_by', 'cv', 'effort_designee',
    'effort_analytics', 'effort_be', 'effort_fe', 'effort_test',
    'effort_test_auto', 'effort_delivery', 'effort_python_be',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics',
    'actual_effort_be', 'actual_effort_fe', 'actual_effort_test',
    'actual_effort_test_auto', 'actual_effort_python_be', 'actual_effort_delivery', 'metric_kr_plan', 'metric_kr_fact',
    'financial_effect_justification', 'did_demo', 'involved_teams'
}

REQUIRES_REASON_STATUSES = {'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ'}


def _load_bulk_tasks(db: Session, task_ids: List[int]) -> tuple[list[int], list[Task]]:
    requested_ids = list(dict.fromkeys(task_ids))
    tasks = []
    for start in range(0, len(requested_ids), 500):
        id_chunk = requested_ids[start:start + 500]
        tasks.extend(db.query(Task).filter(Task.id.in_(id_chunk), Task.is_deleted == False).all())
    return requested_ids, tasks


@router.post("/bulk/preview", response_model=BulkPreviewResponse)
def preview_bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Validate and calculate a bulk action without changing database state."""
    errors = []
    if request.action not in {"close", "hold", "delete", "update", "comment"}:
        errors.append(f"Неизвестная массовая операция: {request.action}")

    requested_ids, tasks = _load_bulk_tasks(db, request.task_ids)
    if len(tasks) != len(requested_ids):
        errors.append("Часть задач не найдена")

    fields = request.fields or request.updates or {}
    if set(fields) & set(ACTUAL_EFFORT_FIELDS) and not is_task_global_editor(current_user):
        errors.append("Фактические трудозатраты может корректировать только администратор")
    if request.action == 'comment':
        comment_text = str(fields.get('comment_text') or '').strip()
        mentioned_ids = list(dict.fromkeys(fields.get('mentioned_user_ids') or []))
        if not comment_text: errors.append('Введите текст комментария')
        if len(comment_text) > 5000: errors.append('Комментарий не должен превышать 5000 символов')
        active_ids = {uid for (uid,) in db.query(User.id).filter(User.id.in_(mentioned_ids), User.is_active == True).all()} if mentioned_ids else set()
        if set(mentioned_ids) != active_ids: errors.append('Упомянуты несуществующие или неактивные пользователи')
    else:
        for field in fields:
            if field in FORBIDDEN_BULK_FIELDS:
                errors.append(f"Поле '{field}' нельзя менять массово")
            elif field not in ALLOWED_BULK_FIELDS:
                errors.append(f"Поле '{field}' не поддерживается для массового изменения")
    for tag_field in ('tags_add', 'tags_remove'):
        if tag_field in fields and not isinstance(fields.get(tag_field), list):
            errors.append(f"Поле '{tag_field}' должно быть списком")

    status_obj = db.query(TaskStatus).filter(TaskStatus.id == fields.get('status_id')).first() if fields.get('status_id') else None
    if status_obj and status_obj.name in REQUIRES_REASON_STATUSES and not fields.get('rejection_reason'):
        errors.append(f"Для статуса '{status_obj.name}' требуется указать причину")

    target_team_id = fields.get('team_id') if 'team_id' in fields else None
    accessible = []
    inaccessible = []
    for task in tasks:
        allowed = can_comment_task(current_user, task.team_id) if request.action == 'comment' else (can_access_task('delete', task, current_user) if request.action == 'delete' else can_edit_task(current_user, task.team_id, target_team_id))
        (accessible if allowed else inaccessible).append(task)

    done_status = db.query(TaskStatus).filter(TaskStatus.name == "ВЫПОЛНЕНА").first() if request.action == 'close' else None
    hold_status = db.query(TaskStatus).filter(TaskStatus.name == "ХОЛД").first() if request.action == 'hold' else None
    changed_tasks = applied_changes = skipped_changes = notifications = 0
    for task in accessible:
        task_changes = 0
        old_status_id = task.status_id
        old_owner_id = task.owner_id
        planned = {}
        if request.action == 'close':
            planned = {'status_id': done_status.id if done_status else task.status_id, 'progress': 100}
        elif request.action == 'hold':
            planned = {'status_id': hold_status.id if hold_status else task.status_id}
        elif request.action == 'delete':
            planned = {'is_deleted': True}
        elif request.action == 'comment':
            task_changes = 1
            applied_changes += 1
            mentioned_ids = list(dict.fromkeys(fields.get('mentioned_user_ids') or []))
            notifications += len([uid for uid in mentioned_ids if uid != current_user.id])
            if task.owner_id and task.owner_id != current_user.id and task.owner_id not in mentioned_ids:
                notifications += 1
        elif request.action == 'update':
            planned = {key: value for key, value in fields.items() if key not in {'tags_add', 'tags_remove'} and hasattr(task, key)}
            if 'tags_add' in fields or 'tags_remove' in fields:
                current_tags = [tag.name for tag in (task.tags or []) if tag and tag.name]
                next_tags = list(current_tags)
                known = {name.casefold() for name in next_tags}
                for raw in fields.get('tags_add') or []:
                    name = str(raw).strip()
                    if name and name.casefold() not in known:
                        next_tags.append(name); known.add(name.casefold())
                removals = {str(raw).strip().casefold() for raw in (fields.get('tags_remove') or []) if str(raw).strip()}
                next_tags = [name for name in next_tags if name.casefold() not in removals]
                if next_tags != current_tags: task_changes += 1; applied_changes += 1
                else: skipped_changes += 1
        for field, value in planned.items():
            if getattr(task, field) == value: skipped_changes += 1
            else: task_changes += 1; applied_changes += 1
        if task_changes:
            changed_tasks += 1
            planned_status_id = planned.get('status_id', old_status_id)
            planned_owner_id = planned.get('owner_id', old_owner_id)
            if planned_status_id != old_status_id: notifications += 1
            if planned_owner_id != old_owner_id and planned_owner_id: notifications += 1

    return BulkPreviewResponse(
        requested_tasks=len(requested_ids), found_tasks=len(tasks), accessible_tasks=len(accessible),
        inaccessible_tasks=len(inaccessible), changed_tasks=changed_tasks,
        unchanged_tasks=len(accessible) - changed_tasks, applied_changes=applied_changes,
        skipped_changes=skipped_changes, notifications=notifications,
        can_apply=not errors and not inaccessible and bool(accessible), errors=errors,
    )

@router.post("/bulk", response_model=BulkActionResponse)
def bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Perform bulk actions on multiple tasks"""
    if request.action not in {"close", "hold", "delete", "update", "comment"}:
        raise HTTPException(status_code=400, detail=f"Неизвестная массовая операция: {request.action}")

    requested_ids, tasks = _load_bulk_tasks(db, request.task_ids)

    if not tasks:
        return BulkActionResponse(
            detail="Задачи не найдены", operation_id=str(uuid.uuid4()),
            requested_tasks=len(requested_ids), changed_tasks=0,
            unchanged_tasks=len(requested_ids), applied_changes=0, skipped_changes=0,
            error_task_ids=requested_ids, errors=["Задачи не найдены"],
        )

    requested_ids = set(requested_ids)
    found_ids = {task.id for task in tasks}
    if found_ids != requested_ids:
        raise HTTPException(
            status_code=404,
            detail="Часть задач не найдена или недоступна для массовой операции",
        )

    fields_to_update = request.fields or request.updates or {}

    if set(fields_to_update) & set(ACTUAL_EFFORT_FIELDS) and not is_task_global_editor(current_user):
        raise HTTPException(status_code=403, detail="Фактические трудозатраты может корректировать только администратор")

    target_team_id = fields_to_update.get("team_id") if "team_id" in fields_to_update else None
    if request.action == 'comment':
        if any(not can_comment_task(current_user, task.team_id) for task in tasks):
            raise HTTPException(status_code=403, detail='Недостаточно прав для комментирования задач')
    else:
        require_bulk_task_edit_access(
            current_user,
            [task.team_id for task in tasks],
            target_team_id=target_team_id,
            is_delete=request.action == "delete",
        )

    if request.action == 'comment':
        comment_text = str(fields_to_update.get('comment_text') or '').strip()
        mentioned_ids = list(dict.fromkeys(fields_to_update.get('mentioned_user_ids') or []))
        if not comment_text or len(comment_text) > 5000:
            raise HTTPException(status_code=400, detail='Комментарий должен содержать от 1 до 5000 символов')
        active_ids = {uid for (uid,) in db.query(User.id).filter(User.id.in_(mentioned_ids), User.is_active == True).all()} if mentioned_ids else set()
        if set(mentioned_ids) != active_ids:
            raise HTTPException(status_code=422, detail='Упомянуты несуществующие или неактивные пользователи')
    else:
        for field in fields_to_update.keys():
            if field in FORBIDDEN_BULK_FIELDS:
                raise HTTPException(status_code=400, detail=f"Поле '{field}' нельзя менять массово")
            if field not in ALLOWED_BULK_FIELDS:
                raise HTTPException(status_code=400, detail=f"Поле '{field}' не поддерживается для массового изменения")

    status_id = fields_to_update.get('status_id')
    if status_id:
        status_obj = db.query(TaskStatus).filter(TaskStatus.id == status_id).first()
        if status_obj and status_obj.name in REQUIRES_REASON_STATUSES:
            if not fields_to_update.get('rejection_reason'):
                raise HTTPException(status_code=400, detail=f"Для статуса '{status_obj.name}' требуется указать причину")

    for tag_field in ('tags_add', 'tags_remove'):
        if tag_field not in fields_to_update:
            continue
        tag_values = fields_to_update.get(tag_field)
        if not isinstance(tag_values, list):
            raise HTTPException(status_code=400, detail=f"Поле '{tag_field}' должно быть списком")
        if len(tag_values) > 50:
            raise HTTPException(status_code=400, detail="За одну операцию можно указать не более 50 тегов")
        if any(len(str(value).strip()) > 100 for value in tag_values):
            raise HTTPException(status_code=400, detail="Название тега не должно превышать 100 символов")

    operation_id = str(uuid.uuid4())
    changed_tasks = 0
    changed_task_ids = []
    unchanged_task_ids = []
    applied_changes = 0
    skipped_changes = 0

    def history_value(value):
        if value is None:
            return None
        if isinstance(value, (list, dict)):
            return json.dumps(value, ensure_ascii=False)
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return str(value)

    done_status = db.query(TaskStatus).filter(TaskStatus.name == "ВЫПОЛНЕНА").first() if request.action == "close" else None
    hold_status = db.query(TaskStatus).filter(TaskStatus.name == "ХОЛД").first() if request.action == "hold" else None

    for task in tasks:
        task_change_count = 0
        old_status_id = task.status_id
        old_owner_id = task.owner_id
        old_status_name = task.status.name if task.status else str(task.status_id or "Не установлен")
        if request.action == "close":
            changes = {'status_id': done_status.id if done_status else task.status_id, 'progress': 100}
            for field, value in changes.items():
                old_value = getattr(task, field)
                if old_value == value:
                    skipped_changes += 1
                    continue
                setattr(task, field, value)
                db.add(TaskHistory(task_id=task.id, changed_by=current_user.id, field_name=field, old_value=history_value(old_value), new_value=history_value(value)))
                task_change_count += 1
                applied_changes += 1
            if done_status:
                task.status_id = done_status.id
            new_status_name = "ВЫПОЛНЕНА"
        elif request.action == "hold":
            new_status_id = hold_status.id if hold_status else task.status_id
            if task.status_id != new_status_id:
                db.add(TaskHistory(task_id=task.id, changed_by=current_user.id, field_name='status_id', old_value=history_value(task.status_id), new_value=history_value(new_status_id)))
                task.status_id = hold_status.id
                task_change_count += 1
                applied_changes += 1
            else:
                skipped_changes += 1
            new_status_name = "ХОЛД"
        elif request.action == "delete":
            if not task.is_deleted:
                db.add(TaskHistory(task_id=task.id, changed_by=current_user.id, field_name='is_deleted', old_value='False', new_value='True'))
                task.is_deleted = True
                task_change_count += 1
                applied_changes += 1
            else:
                skipped_changes += 1
            new_status_name = None
        elif request.action == "comment":
            db.add(TaskComment(
                task_id=task.id, user_id=current_user.id, text=comment_text,
                mentioned_user_ids=json.dumps(mentioned_ids) if mentioned_ids else None,
            ))
            db.add(TaskHistory(
                task_id=task.id, changed_by=current_user.id, field_name='comment',
                old_value=None, new_value=comment_text[:200],
            ))
            if mentioned_ids:
                notify_mention(db, task, mentioned_ids, current_user.name, current_user.id)
            notify_comment(db, task, current_user.id, excluded_recipient_ids=set(mentioned_ids))
            task_change_count = 1
            applied_changes += 1
            new_status_name = None
        elif request.action == "update" and fields_to_update:
            current_tag_names = [tag.name for tag in (task.tags or []) if tag and tag.name]
            next_tag_names = list(current_tag_names)
            if 'tags_add' in fields_to_update:
                additions = fields_to_update.get('tags_add') or []
                known = {name.casefold() for name in next_tag_names}
                for raw in additions:
                    name = str(raw).strip()
                    if name and name.casefold() not in known:
                        next_tag_names.append(name)
                        known.add(name.casefold())
            if 'tags_remove' in fields_to_update:
                removals = fields_to_update.get('tags_remove') or []
                remove_keys = {str(raw).strip().casefold() for raw in removals if str(raw).strip()}
                next_tag_names = [name for name in next_tag_names if name.casefold() not in remove_keys]
            if next_tag_names != current_tag_names:
                _apply_tags(db, task, next_tag_names, current_user.id)
                db.add(TaskHistory(
                    task_id=task.id,
                    changed_by=current_user.id,
                    field_name='tags',
                    old_value=', '.join(current_tag_names) or None,
                    new_value=', '.join(next_tag_names) or None,
                ))
                task_change_count += 1
                applied_changes += 1
            elif 'tags_add' in fields_to_update or 'tags_remove' in fields_to_update:
                skipped_changes += 1
            for field, value in fields_to_update.items():
                if field in {'tags_add', 'tags_remove'}:
                    continue
                if hasattr(task, field):
                    old_value = getattr(task, field)
                    if old_value == value:
                        skipped_changes += 1
                        continue
                    setattr(task, field, value)
                    db.add(TaskHistory(
                        task_id=task.id, changed_by=current_user.id, field_name=field,
                        old_value=history_value(old_value), new_value=history_value(value),
                    ))
                    task_change_count += 1
                    applied_changes += 1
            new_status_name = None

        if task_change_count > 0 and request.action != 'comment':
            task.version = (task.version or 0) + 1
        if task_change_count > 0:
            changed_tasks += 1
            changed_task_ids.append(task.id)
        else:
            unchanged_task_ids.append(task.id)
        if old_status_id != task.status_id:
            resolved_status = db.query(TaskStatus).filter(TaskStatus.id == task.status_id).first() if task.status_id else None
            notify_status_change(db, task, old_status_name, resolved_status.name if resolved_status else (new_status_name or "Не установлен"), current_user.id)
        if old_owner_id != task.owner_id and task.owner_id:
            notify_assignment(db, task, task.owner_id, current_user.id)

    db.add(AuditLog(
        user_id=current_user.id,
        action='BULK_UPDATE',
        entity_type='tasks_bulk',
        entity_id=None,
        details=json.dumps({
            'operation_id': operation_id,
            'action': request.action,
            'task_ids': sorted(requested_ids),
            'fields': list(fields_to_update.keys()),
            'changed_tasks': changed_tasks,
            'unchanged_tasks': len(tasks) - changed_tasks,
            'applied_changes': applied_changes,
            'skipped_changes': skipped_changes,
        }, ensure_ascii=False),
    ))

    db.commit()
    return BulkActionResponse(
        detail=f"Массовая операция применена к {changed_tasks} задачам",
        operation_id=operation_id,
        requested_tasks=len(tasks),
        changed_tasks=changed_tasks,
        unchanged_tasks=len(tasks) - changed_tasks,
        applied_changes=applied_changes,
        skipped_changes=skipped_changes,
        changed_task_ids=sorted(changed_task_ids),
        unchanged_task_ids=sorted(unchanged_task_ids),
    )


@router.post("/import")
def import_tasks(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Import tasks from CSV file with validation, error reporting and audit logging.

    Поля CSV сопоставляются по умолчанию (русские метки из field_labels / DB-ключи).
    Ошибочные строки пропускаются, валидные импортируются. Разделитель определяется
    автоматически (запятая или точка с запятой).
    """
    import import_service

    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Только CSV файлы поддерживаются")

    if not check_permission(current_user, "backlog_team", "write_own"):
        raise HTTPException(status_code=403, detail="Permission denied")

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Файл пуст")

    try:
        return import_service.import_tasks_from_csv(db, content, current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        logger.exception("Unexpected task import failure filename=%r", file.filename)
        raise HTTPException(status_code=500, detail="Внутренняя ошибка импорта")
