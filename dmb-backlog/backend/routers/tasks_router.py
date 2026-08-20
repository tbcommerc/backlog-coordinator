from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, String, cast, case
from typing import Optional, List
from datetime import date, datetime, timezone
import json
import logging
import re


logger = logging.getLogger("dmb_backlog.tasks")

from database import get_db
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer, AuditLog, CompetencyCostHistory, FieldLabel, Tag, IssueTag
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse, TaskListResponse,
    BulkActionRequest, SuccessResponse, TaskHistoryResponse, TaskLinkUpdate,
    PipDecisionRequest,
)
from auth import (
    get_current_user,
    check_permission,
    require_bulk_task_edit_access,
    require_backlog_page_access,
    authorize_task,
)
from notifications import notify_status_change, notify_assignment
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
        channel_id=task.channel_id,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
        task_type_name=task.task_type.name if task.task_type else None,
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
        channel_name=task.channel.name if task.channel else None,
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
        "users": [{"id": u.id, "name": u.name} for u in users],
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
def create_task(task_data: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create new task with auto-calculations and audit logging"""
    if not check_permission(current_user, "backlog_team", "write_own"):
        raise HTTPException(status_code=403, detail="Permission denied")

    # 1. Calculate C/V if both financial_effect and effort_rub are provided
    cv = None
    if task_data.financial_effect is not None and task_data.effort_rub is not None and task_data.effort_rub > 0:
        cv = round(task_data.financial_effect / task_data.effort_rub, 2)

    # 2. Default status = НОВАЯ ЗАДАЧА (status_id = 1)
    status_id = task_data.status_id
    if status_id is None:
        status_id = 1

    # Auto-calculate effort cost from role estimates x competency rates
    effort_rub = compute_effort_rub(db, task_data.model_dump(), task_data.effort_rub)

    # Auto-fill department from the selected business customer when not provided
    department_id = task_data.department_id
    if department_id is None and task_data.business_customer_id is not None:
        customer = db.query(BusinessCustomer).filter(BusinessCustomer.id == task_data.business_customer_id).first()
        if customer and customer.department_id is not None:
            department_id = customer.department_id

    task = Task(
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
        priority_id=task_data.priority_id,
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
        created_by=current_user.id
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

    return task_to_response(task, db)


@router.put("/{task_id}/pip-decision", response_model=TaskResponse)
def apply_pip_decision(
    task_id: int,
    payload: PipDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перевести задачу из PI-решения в один из двух разрешённых статусов."""
    role_name = (current_user.role_name or "").strip().casefold()
    if role_name not in PIP_DECISION_ROLES:
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
        logger.info(f"[update_task] task_id={task_id}, update_data={update_data}")

        # Optimistic lock: extract and check version before applying changes
        submitted_version = update_data.pop('version', None)
        # actual_effort_days is always computed from actual effort fields
        update_data.pop('actual_effort_days', None)
        # tags — обрабатываются отдельно через issue_tags (не колонка ORM)
        tag_names = update_data.pop('tags', None)
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
    'comment', 'link_jira', 'link_mockups', 'date_received'
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

@router.post("/bulk", response_model=SuccessResponse)
def bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Perform bulk actions on multiple tasks"""
    if len(request.task_ids) > 500:
        raise HTTPException(status_code=400, detail="Лимит 500 задач за запрос")

    if request.action not in {"close", "hold", "delete", "update"}:
        raise HTTPException(status_code=400, detail=f"Неизвестная массовая операция: {request.action}")

    tasks = db.query(Task).filter(Task.id.in_(request.task_ids), Task.is_deleted == False).all()

    if not tasks:
        return SuccessResponse(message="No tasks found")

    requested_ids = set(request.task_ids)
    found_ids = {task.id for task in tasks}
    if found_ids != requested_ids:
        raise HTTPException(
            status_code=404,
            detail="Часть задач не найдена или недоступна для массовой операции",
        )

    fields_to_update = request.fields or request.updates or {}

    target_team_id = fields_to_update.get("team_id") if "team_id" in fields_to_update else None
    require_bulk_task_edit_access(
        current_user,
        [task.team_id for task in tasks],
        target_team_id=target_team_id,
        is_delete=request.action == "delete",
    )

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

    for task in tasks:
        old_status_name = task.status.name if task.status else str(task.status_id)
        if request.action == "close":
            done_status = db.query(TaskStatus).filter(TaskStatus.name == "ВЫПОЛНЕНА").first()
            if done_status:
                task.status_id = done_status.id
            task.progress = 100
            new_status_name = "ВЫПОЛНЕНА"
        elif request.action == "hold":
            hold_status = db.query(TaskStatus).filter(TaskStatus.name == "ХОЛД").first()
            if hold_status:
                task.status_id = hold_status.id
            new_status_name = "ХОЛД"
        elif request.action == "delete":
            task.is_deleted = True
            new_status_name = None
        elif request.action == "update" and fields_to_update:
            for field, value in fields_to_update.items():
                if hasattr(task, field):
                    setattr(task, field, value)
            new_status_name = None

        if new_status_name:
            notify_status_change(db, task, old_status_name, new_status_name, current_user.id)

    db.commit()
    return SuccessResponse(message=f"Action '{request.action}' applied to {len(tasks)} tasks")


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
