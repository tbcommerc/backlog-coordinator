from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, String, cast, case
from typing import Optional, List
from datetime import date, datetime, timezone, timedelta
import json
import os
import re
import uuid
import shutil

from database import get_db
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer, AuditLog, TaskComment, TaskAttachment, Notification, TaskViewer, TeamCompetencyResource, DictionaryItem, CompetencyCostHistory, FieldLabel, Tag, IssueTag
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse, TaskListResponse,
    BulkActionRequest, SuccessResponse, TaskHistoryResponse,
    CommentCreate, CommentResponse, CommentListResponse,
    AttachmentResponse, AttachmentListResponse, TaskLinkUpdate,
    TaskLockResponse, TaskViewerResponse, TaskViewersListResponse
)
from auth import get_current_user, check_permission
from notifications import (
    notify_status_change, notify_assignment, notify_mention, notify_comment,
    notify_lock_acquired,
)

router = APIRouter()

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
    db.commit()


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
        db.commit()
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
async def get_tasks(
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
async def search_tasks(
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
async def get_task_stats(
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
async def get_task_reference(
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
async def get_report(
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


@router.get("/analytics")
async def get_analytics(
    type: str = Query("tribe"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return analytics aggregation data by type (tribe or po-pl)"""
    if type not in ("tribe", "po-pl"):
        raise HTTPException(status_code=400, detail="Invalid analytics type")

    terminal = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")
    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    teams = {t.id: t.name for t in db.query(Team).all()}

    if type == "tribe":
        high_cv = []
        low_cv = []
        for t in tasks:
            if t.financial_effect is not None and t.effort_rub is not None and t.effort_rub > 0:
                cv = round(t.financial_effect / t.effort_rub, 2)
                entry = {"id": t.id, "title": t.title, "team": teams.get(t.team_id, ""), "cv": cv, "financial_effect": t.financial_effect}
                if cv >= 1.0:
                    high_cv.append(entry)
                else:
                    low_cv.append(entry)

        high_cv.sort(key=lambda x: x["cv"], reverse=True)
        low_cv.sort(key=lambda x: x["cv"])

        at_risk_deadlines = ("1Q 2026", "2Q 2026")
        risk_condition = (TaskStatus.name.in_(("СБОР ТРЕБОВАНИЙ", "ЭКСПРЕСС-ОЦЕНКА"))) & (Deadline.name.in_(at_risk_deadlines))
        risk_rows = db.query(
            Team.name,
            func.count(Task.id),
            func.sum(case((risk_condition, 1), else_=0))
        ).join(Task, Task.team_id == Team.id).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).join(
            Deadline, Task.deadline_id == Deadline.id, isouter=True
        ).filter(
            Task.is_deleted == False
        ).group_by(Team.name).all()
        risk_by_team = {r[0]: {"total": r[1], "risk": r[2]} for r in risk_rows}

        status_rows = db.query(TaskStatus.name, func.count(Task.id)).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False
        ).group_by(TaskStatus.name).all()
        health_by_status = {r[0]: r[1] for r in status_rows}

        fin_rows = db.query(
            Team.name,
            func.coalesce(func.sum(Task.financial_effect), 0.0)
        ).join(Task, Task.team_id == Team.id).filter(
            Task.is_deleted == False
        ).group_by(Team.name).all()
        team_fin_effect = {r[0]: float(r[1]) for r in fin_rows}

        return {
            "high_cv_tasks": high_cv[:10],
            "low_cv_tasks": low_cv[:10],
            "risk_by_team": risk_by_team,
            "portfolio_health": health_by_status,
            "team_financial_effect": team_fin_effect
        }

    else:
        workload_rows = db.query(
            Team.name,
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.coalesce(func.avg(Task.progress), 0.0)
        ).join(Task, Task.team_id == Team.id).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False
        ).group_by(Team.name).all()
        workload_by_team = {
            r[0]: {"total": r[1], "active": r[2], "avg_progress": round(float(r[3]), 1)}
            for r in workload_rows
        }

        total_tasks = db.query(Task).filter(Task.is_deleted == False).count()
        on_track = db.query(Task).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False,
            Task.deadline_id != None,
            TaskStatus.name.in_(terminal)
        ).count()
        overdue = db.query(Task).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False,
            Task.deadline_id != None,
            TaskStatus.name.notin_(terminal)
        ).count()
        no_deadline = db.query(Task).filter(
            Task.is_deleted == False, Task.deadline_id == None
        ).count()
        deadline_pct = round(on_track / total_tasks * 100, 1) if total_tasks else 0

        missing_attrs = {
            "no_effort_days": db.query(Task).filter(Task.is_deleted == False, Task.effort_days == None).count(),
            "no_effort_rub": db.query(Task).filter(Task.is_deleted == False, Task.effort_rub == None).count(),
            "no_financial_effect": db.query(Task).filter(Task.is_deleted == False, Task.financial_effect == None).count(),
            "no_owner": db.query(Task).filter(Task.is_deleted == False, Task.owner_id == None).count(),
            "no_deadline": db.query(Task).filter(Task.is_deleted == False, Task.deadline_id == None).count(),
        }

        return {
            "workload_by_team": workload_by_team,
            "deadline_compliance": {"on_track": on_track, "overdue": overdue, "no_deadline": no_deadline, "compliance_pct": deadline_pct},
            "missing_attributes": missing_attrs
        }


@router.get("/analytics/effort-by-type")
async def get_effort_by_type(
    period: str = Query("quarter", pattern="^(quarter|ytd)$"),
    team_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Соотношение трудозатрат (экспресс-оценка, effort_days) по типам задач.
    Период определяется по плановому дедлайну:
      - quarter — текущий квартал;
      - ytd — накопленный итог с начала года (все кварталы + годовой дедлайн)."""
    today = date.today()
    current_year = today.year
    current_quarter = (today.month - 1) // 3 + 1

    if period == "quarter":
        deadline_names = [f"{current_quarter}Q {current_year}"]
        period_label = f"{current_quarter}Q {current_year}"
    else:
        deadline_names = [f"{q}Q {current_year}" for q in range(1, 5)]
        deadline_names.append(f"Y{current_year}")
        period_label = str(current_year)

    deadline_ids = db.query(Deadline.id).filter(Deadline.name.in_(deadline_names)).all()
    deadline_ids = [d[0] for d in deadline_ids]

    query = db.query(Task).filter(
        Task.is_deleted == False,
        Task.deadline_id.in_(deadline_ids),
    )

    scope = "tribe"
    if not check_permission(current_user, "backlog_dmb", "read"):
        user_team_id = current_user.team_id
        if user_team_id:
            query = query.filter(Task.team_id == user_team_id)
            scope = "team"
        else:
            query = query.filter(False)

    if team_id is not None:
        query = query.filter(Task.team_id == team_id)
        scope = "team"

    tasks = query.all()

    by_type = {}
    for t in tasks:
        type_name = t.task_type.name if t.task_type else "Без типа"
        agg = by_type.setdefault(type_name, {"tasks": 0, "effort_days": 0.0})
        agg["tasks"] += 1
        agg["effort_days"] += t.effort_days or 0

    total_effort = sum(v["effort_days"] for v in by_type.values())

    result = []
    for name, agg in sorted(by_type.items(), key=lambda x: x[1]["effort_days"], reverse=True):
        share = round(agg["effort_days"] / total_effort * 100, 1) if total_effort else 0
        result.append({
            "task_type": name,
            "tasks": agg["tasks"],
            "effort_days": round(agg["effort_days"], 1),
            "share": share,
        })

    return {
        "period": period,
        "period_label": period_label,
        "scope": scope,
        "team_id": team_id,
        "total_tasks": len(tasks),
        "total_effort_days": round(total_effort, 1),
        "by_type": result,
    }


@router.get("/analytics/tribe-dashboard")
async def get_tribe_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Сводные агрегации для дашборда Лидера Трайба:
    Загрузка команд vs ёмкость, матрица приоритет×срок,
    ROI по командам."""
    terminal = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")

    tasks = db.query(Task).filter(Task.is_deleted == False).all()
    teams = {t.id: t.name for t in db.query(Team).all()}
    deadline_order = {d.id: d.name for d in db.query(Deadline).all()}

    # --- Загрузка команд vs ёмкость ---
    cap_rows = db.query(TeamCompetencyResource).all()
    capacity = {}
    for r in cap_rows:
        people = (r.senior_count or 0) + (r.middle_count or 0) + (r.junior_count or 0)
        a = capacity.setdefault(r.team_id, {"capacity": 0.0, "headcount": 0})
        a["capacity"] += people * (r.working_days or 66)
        a["headcount"] += people

    capacity_by_team = []
    for tid, name in teams.items():
        load = sum(
            t.effort_days or 0 for t in tasks
            if t.team_id == tid and t.status is not None and t.status.name not in terminal
        )
        cap = capacity.get(tid, {}).get("capacity", 0.0)
        capacity_by_team.append({
            "team": name,
            "load": round(load, 1),
            "capacity": round(cap, 1),
            "headcount": capacity.get(tid, {}).get("headcount", 0),
            "utilisation": round(load / cap * 100, 1) if cap else None,
        })
    capacity_by_team.sort(key=lambda x: x["team"])

    # --- Матрица Приоритет × Срок (effort_days) ---
    pd = {}
    for t in tasks:
        p = t.priority.name if t.priority else "БЕЗ ПРИОРИТЕТА"
        dl = t.deadline.name if t.deadline else "БЕЗ СРОКА"
        pd.setdefault(p, {}).setdefault(dl, 0.0)
        pd[p][dl] += t.effort_days or 0
    priority_deadline = [
        {"priority": p, "values": [
            {"deadline": dl, "effort_days": round(v, 1)}
            for dl, v in cells.items()
        ]}
        for p, cells in pd.items()
    ]

    # --- ROI по командам ---
    roi = {}
    for t in tasks:
        a = roi.setdefault(teams.get(t.team_id, "БЕЗ КОМАНДЫ"), {"financial_effect": 0.0, "effort_rub": 0.0})
        a["financial_effect"] += t.financial_effect or 0
        a["effort_rub"] += t.effort_rub or 0
    roi_by_team = [
        {
            "team": k,
            "financial_effect": round(v["financial_effect"], 1),
            "effort_rub": round(v["effort_rub"], 1),
            "roi": round(v["financial_effect"] / v["effort_rub"], 2) if v["effort_rub"] else None,
        }
        for k, v in sorted(roi.items())
    ]

    return {
        "capacity_by_team": capacity_by_team,
        "priority_deadline": priority_deadline,
        "roi_by_team": roi_by_team,
    }


@router.get("/analytics/lt-reports")
async def get_lt_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Единый датасет для отчётов «Аналитики Лидера Трайба»:
    1) Трудозатраты по типам задач; 2) Потоки работ (заказчики → команды → типы);
    3) Карта взаимосвязей команд. Возвращает агрегации по всем периодам сразу.

    Периоды определяются динамически по плановым дедлайнам задач:
    - кварталы «NQ YYYY»;
    - год «YYYY год» = сумма квартальных дедлайнов года + годовой дедлайн «YYYYY».
    """
    query = db.query(Task).filter(Task.is_deleted == False)

    scope = "tribe"
    if not check_permission(current_user, "backlog_dmb", "read"):
        user_team_id = current_user.team_id
        if user_team_id:
            query = query.filter(Task.team_id == user_team_id)
            scope = "team"
        else:
            query = query.filter(False)

    tasks = query.all()
    team_names = {t.id: t.name for t in db.query(Team).all()}

    q_re = re.compile(r"^(\d)Q\s*(\d{4})$")
    y_re = re.compile(r"^Y\s*(\d{4})$")
    q_groups = {}
    y_groups = {}
    for t in tasks:
        dl_name = t.deadline.name if t.deadline else None
        if not dl_name:
            continue
        m = q_re.match(dl_name.strip())
        if m:
            q_groups.setdefault(int(m.group(2)), {}).setdefault(int(m.group(1)), []).append(t)
            continue
        m2 = y_re.match(dl_name.strip())
        if m2:
            y_groups.setdefault(int(m2.group(1)), []).append(t)

    periods = []
    period_map = {}
    today = date.today()
    current_year = today.year
    if current_year in set(list(q_groups.keys()) + list(y_groups.keys())):
        qs = q_groups.get(current_year, {})
        for q in range(1, 5):
            if q not in qs:
                continue
            pid = "q{}_{}".format(q, current_year)
            period_map[pid] = {"label": "{}Q {}".format(q, current_year), "tasks": qs[q]}
            periods.append(pid)
        qts = [t for q in range(1, 5) for t in qs.get(q, [])]
        yts = y_groups.get(current_year, [])
        if qts or yts:
            pid = "y{}".format(current_year)
            period_map[pid] = {"label": "{} год".format(current_year), "tasks": qts + yts}
            periods.append(pid)

    today = date.today()
    cur_q = (today.month - 1) // 3 + 1
    cur_pid = "q{}_{}".format(cur_q, today.year)
    active_period = cur_pid if cur_pid in period_map else (periods[0] if periods else None)

    def effort_rows(ts):
        rows = {}
        for t in ts:
            tn = t.task_type.name if t.task_type else "Без типа"
            tm = t.team.name if t.team else "Без команды"
            days = float(t.effort_days or 0)
            r = rows.setdefault(tn, {"type": tn, "tasks": 0, "days": 0.0, "by_team": {}})
            r["tasks"] += 1
            r["days"] += days
            bt = r["by_team"].setdefault(tm, {"tasks": 0, "days": 0.0})
            bt["tasks"] += 1
            bt["days"] += days
        out = [
            {
                "type": r["type"],
                "tasks": r["tasks"],
                "days": round(r["days"], 1),
                "by_team": {k: {"tasks": v["tasks"], "days": round(v["days"], 1)} for k, v in r["by_team"].items()},
            }
            for r in rows.values()
        ]
        out.sort(key=lambda x: (-x["days"], -x["tasks"]))
        return out

    def sankey_data(ts):
        customers, teams, types = [], [], []
        cset, tset, yset = {}, {}, {}
        c2t, t2y = {}, {}
        for t in ts:
            c = t.business_customer_rel.name if t.business_customer_rel else "Без заказчика"
            tm = t.team.name if t.team else "Без команды"
            ty = t.task_type.name if t.task_type else "Без типа"
            days = float(t.effort_days or 0)
            if c not in cset:
                cset[c] = 1
                customers.append(c)
            if tm not in tset:
                tset[tm] = 1
                teams.append(tm)
            if ty not in yset:
                yset[ty] = 1
                types.append(ty)
            a = c2t.setdefault((c, tm), {"tasks": 0, "days": 0.0})
            a["tasks"] += 1
            a["days"] += days
            b = t2y.setdefault((tm, ty), {"tasks": 0, "days": 0.0})
            b["tasks"] += 1
            b["days"] += days
        links = []
        for (c, tm), v in c2t.items():
            links.append({"source": c, "target": tm, "tasks": v["tasks"], "days": round(v["days"], 1)})
        for (tm, ty), v in t2y.items():
            links.append({"source": tm, "target": ty, "tasks": v["tasks"], "days": round(v["days"], 1)})
        return {"customers": customers, "teams": teams, "types": types, "links": links}

    def map_data(ts):
        stat = {}
        edges = {}
        for t in ts:
            main = t.team.name if t.team else None
            ids = [i for i in (t.involved_teams or []) if isinstance(i, int)]
            if main is None or not ids:
                continue
            s = stat.setdefault(main, {"asMain": 0, "asPartner": 0})
            s["asMain"] += 1
            for i in ids:
                pn = team_names.get(i)
                if not pn:
                    continue
                stat.setdefault(pn, {"asMain": 0, "asPartner": 0})["asPartner"] += 1
                edges[(main, pn)] = edges.get((main, pn), 0) + 1
        teams_out = [
            {"name": k, "asMain": v["asMain"], "asPartner": v["asPartner"]}
            for k, v in stat.items()
        ]
        teams_out.sort(key=lambda x: -(x["asMain"] + x["asPartner"]))
        edges_out = [
            {"source": k[0], "target": k[1], "count": v}
            for k, v in sorted(edges.items(), key=lambda kv: -kv[1])
        ]
        return {"teams": teams_out, "edges": edges_out}

    effort_by_type = {}
    sankey = {}
    map_reports = {}
    for pid, meta in period_map.items():
        ts = meta["tasks"]
        effort_by_type[pid] = effort_rows(ts)
        sankey[pid] = sankey_data(ts)
        map_reports[pid] = map_data(ts)

    return {
        "periods": [{"id": p, "label": period_map[p]["label"]} for p in periods],
        "active_period": active_period,
        "scope": scope,
        "effort_by_type": effort_by_type,
        "sankey": sankey,
        "map": map_reports,
    }


# ==================== TASK LOCK ====================

LOCK_DURATION_MINUTES = 15


def _is_lock_active(task: Task) -> bool:
    """Check if the task lock is still valid (not expired)."""
    if not task.lock_owner_id or not task.lock_until:
        return False
    return task.lock_until.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/{task_id}/lock", response_model=TaskLockResponse)
async def get_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Check lock status for a task."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if _is_lock_active(task):
        owner = db.query(User).filter(User.id == task.lock_owner_id).first()
        return TaskLockResponse(
            locked=True,
            lock_owner_id=task.lock_owner_id,
            lock_owner_name=owner.name if owner else None,
            lock_until=task.lock_until,
            is_mine=(task.lock_owner_id == current_user.id),
            version=task.version or 0,
        )

    return TaskLockResponse(locked=False, is_mine=False, version=task.version or 0)


@router.post("/{task_id}/lock", response_model=TaskLockResponse)
async def acquire_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Acquire or extend a lock on a task for editing."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)
    new_until = now + timedelta(minutes=LOCK_DURATION_MINUTES)

    if _is_lock_active(task):
        if task.lock_owner_id == current_user.id:
            task.lock_until = new_until
            db.commit()
            db.refresh(task)
            owner = db.query(User).filter(User.id == task.lock_owner_id).first()
            return TaskLockResponse(
                locked=True,
                lock_owner_id=task.lock_owner_id,
                lock_owner_name=owner.name if owner else None,
                lock_until=task.lock_until,
                is_mine=True,
                version=task.version or 0,
            )
        else:
            owner = db.query(User).filter(User.id == task.lock_owner_id).first()
            raise HTTPException(
                status_code=423,
                detail=f"Задача в данный момент редактируется пользователем {owner.name if owner else 'Неизвестный'}. Доступен режим 'только чтение'"
            )

    task.lock_owner_id = current_user.id
    task.lock_until = new_until
    db.commit()
    db.refresh(task)

    notify_lock_acquired(db, task, current_user.name)

    owner = db.query(User).filter(User.id == task.lock_owner_id).first()
    return TaskLockResponse(
        locked=True,
        lock_owner_id=task.lock_owner_id,
        lock_owner_name=owner.name if owner else None,
        lock_until=task.lock_until,
        is_mine=True,
        version=task.version or 0,
    )


@router.delete("/{task_id}/lock", response_model=TaskLockResponse)
async def release_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Release a lock on a task."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.lock_owner_id == current_user.id or not _is_lock_active(task):
        task.lock_owner_id = None
        task.lock_until = None
        db.commit()
        db.refresh(task)

    return TaskLockResponse(locked=False, is_mine=False)


# ==================== TASK VIEWERS ====================

VIEWER_STALE_MINUTES = 10
VIEWER_ACTIVE_MINUTES = 5


def _cleanup_stale_viewers(db: Session):
    """Remove viewer records older than VIEWER_STALE_MINUTES."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=VIEWER_STALE_MINUTES)
    db.query(TaskViewer).filter(TaskViewer.last_seen_at < cutoff).delete(synchronize_session=False)
    db.flush()


@router.post("/{task_id}/viewers", response_model=TaskViewerResponse)
async def register_viewer(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Register or refresh the current user as a viewer of the task."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)
    viewer = db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id,
        TaskViewer.user_id == current_user.id,
    ).first()

    if viewer:
        viewer.last_seen_at = now
    else:
        viewer = TaskViewer(
            task_id=task_id,
            user_id=current_user.id,
            last_seen_at=now,
        )
        db.add(viewer)

    db.commit()
    db.refresh(viewer)
    return TaskViewerResponse(
        user_id=current_user.id,
        user_name=current_user.name,
        last_seen_at=viewer.last_seen_at,
    )


@router.get("/{task_id}/viewers", response_model=TaskViewersListResponse)
async def list_viewers(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List active viewers of the task (excluding the current user)."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    _cleanup_stale_viewers(db)
    db.commit()

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=VIEWER_ACTIVE_MINUTES)
    viewers = db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id,
        TaskViewer.user_id != current_user.id,
        TaskViewer.last_seen_at >= cutoff,
    ).all()

    result = []
    for v in viewers:
        user = db.query(User).filter(User.id == v.user_id).first()
        result.append(TaskViewerResponse(
            user_id=v.user_id,
            user_name=user.name if user else None,
            last_seen_at=v.last_seen_at,
        ))

    return TaskViewersListResponse(viewers=result)


@router.delete("/{task_id}/viewers")
async def unregister_viewer(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove the current user from the task viewers list."""
    db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id,
        TaskViewer.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": "ok"}


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get single task by ID"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not check_permission(current_user, "backlog_dmb", "read"):
        user_team_id = current_user.team_id
        if user_team_id and task.team_id != user_team_id:
            raise HTTPException(status_code=403, detail="Permission denied")

    return task_to_response(task, db)


@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(task_data: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    db.commit()
    db.refresh(task)

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

    db.commit()
    db.refresh(task)

    # Notifications: assignment on creation
    if task.owner_id:
        notify_assignment(db, task, task.owner_id)
        db.commit()

    return task_to_response(task, db)


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update existing task"""
    import traceback
    import logging
    logger = logging.getLogger(__name__)

    try:
        task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        if _is_lock_active(task) and task.lock_owner_id != current_user.id:
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
            notify_assignment(db, task, new_owner_id)

        db.commit()
        db.refresh(task)

        # Increment version after successful save
        task.version = (task.version or 0) + 1
        db.commit()
        db.refresh(task)

        return task_to_response(task, db)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"[update_task] ERROR task_id={task_id}: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{task_id}/history", response_model=List[TaskHistoryResponse])
async def get_task_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get change history for a task"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

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
async def get_task_documents(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get documents and links associated with a task"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

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
async def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Soft delete task"""
    if not check_permission(current_user, "backlog_team", "write_all"):
        raise HTTPException(status_code=403, detail="Permission denied")

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.is_deleted = True
    db.commit()
    return {"message": "Task deleted"}


# ==================== COMMENTS ====================

@router.get("/{task_id}/comments", response_model=CommentListResponse)
async def get_task_comments(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get comments for a task (threaded: root comments with nested replies)"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    comments = db.query(TaskComment).filter(
        TaskComment.task_id == task_id
    ).order_by(TaskComment.created_at.asc()).all()

    user_cache = {}
    def get_user_name(uid):
        if uid not in user_cache:
            u = db.query(User).filter(User.id == uid).first()
            user_cache[uid] = u.name if u else None
        return user_cache[uid]

    def parse_mentions(raw):
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    comment_map = {}
    for c in comments:
        resp = CommentResponse(
            id=c.id,
            task_id=c.task_id,
            user_id=c.user_id,
            user_name=get_user_name(c.user_id),
            text=c.text,
            mentioned_user_ids=parse_mentions(c.mentioned_user_ids),
            parent_id=c.parent_id,
            replies=[],
            created_at=c.created_at,
        )
        comment_map[c.id] = resp

    roots = []
    for c in comments:
        resp = comment_map[c.id]
        if c.parent_id and c.parent_id in comment_map:
            comment_map[c.parent_id].replies.append(resp)
        else:
            roots.append(resp)

    return CommentListResponse(items=roots, total=len(comments))


@router.post("/{task_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_task_comment(
    task_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a comment to a task, optionally mentioning users via @"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if data.parent_id:
        parent_comment = db.query(TaskComment).filter(
            TaskComment.id == data.parent_id,
            TaskComment.task_id == task_id
        ).first()
        if not parent_comment:
            raise HTTPException(status_code=404, detail="Parent comment not found")

    mentioned_ids_json = None
    if data.mentioned_user_ids:
        mentioned_ids_json = json.dumps(data.mentioned_user_ids)

    comment = TaskComment(
        task_id=task_id,
        user_id=current_user.id,
        parent_id=data.parent_id,
        text=data.text,
        mentioned_user_ids=mentioned_ids_json,
    )
    db.add(comment)

    history = TaskHistory(
        task_id=task_id,
        changed_by=current_user.id,
        field_name="comment",
        old_value=None,
        new_value=data.text[:200] if len(data.text) > 200 else data.text,
    )
    db.add(history)

    # Notifications: mentions + comment
    if data.mentioned_user_ids:
        notify_mention(db, task, data.mentioned_user_ids, current_user.name)
    notify_comment(db, task, current_user.id)

    db.commit()
    db.refresh(comment)

    user = db.query(User).filter(User.id == comment.user_id).first()
    mentioned_ids = None
    if comment.mentioned_user_ids:
        try:
            mentioned_ids = json.loads(comment.mentioned_user_ids)
        except (json.JSONDecodeError, TypeError):
            mentioned_ids = None

    return CommentResponse(
        id=comment.id,
        task_id=comment.task_id,
        user_id=comment.user_id,
        user_name=user.name if user else None,
        text=comment.text,
        mentioned_user_ids=mentioned_ids,
        parent_id=comment.parent_id,
        created_at=comment.created_at,
    )


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.get("/{task_id}/attachments", response_model=AttachmentListResponse)
async def get_task_attachments(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    attachments = db.query(TaskAttachment).filter(
        TaskAttachment.task_id == task_id
    ).order_by(TaskAttachment.created_at.desc()).all()

    items = []
    for a in attachments:
        user = db.query(User).filter(User.id == a.user_id).first()
        items.append(AttachmentResponse(
            id=a.id,
            task_id=a.task_id,
            user_id=a.user_id,
            user_name=user.name if user else None,
            filename=a.filename,
            original_name=a.original_name,
            mime_type=a.mime_type,
            file_size=a.file_size,
            download_url=f"/uploads/{task_id}/{a.filename}",
            created_at=a.created_at,
        ))

    return AttachmentListResponse(items=items, total=len(items))


@router.post("/{task_id}/attachments", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_task_attachment(
    task_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    task_dir = os.path.join(UPLOAD_DIR, str(task_id))
    os.makedirs(task_dir, exist_ok=True)
    file_path = os.path.join(task_dir, stored_name)

    with open(file_path, "wb") as f:
        f.write(content)

    attachment = TaskAttachment(
        task_id=task_id,
        user_id=current_user.id,
        filename=stored_name,
        original_name=file.filename or "unknown",
        mime_type=file.content_type,
        file_size=len(content),
    )
    db.add(attachment)

    history = TaskHistory(
        task_id=task_id,
        changed_by=current_user.id,
        field_name="attachment",
        old_value=None,
        new_value=f"Загружен файл: {file.filename}",
    )
    db.add(history)

    db.commit()
    db.refresh(attachment)

    user = db.query(User).filter(User.id == attachment.user_id).first()
    return AttachmentResponse(
        id=attachment.id,
        task_id=attachment.task_id,
        user_id=attachment.user_id,
        user_name=user.name if user else None,
        filename=attachment.filename,
        original_name=attachment.original_name,
        mime_type=attachment.mime_type,
        file_size=attachment.file_size,
        download_url=f"/uploads/{task_id}/{attachment.filename}",
        created_at=attachment.created_at,
    )


@router.delete("/{task_id}/attachments/{attachment_id}", response_model=SuccessResponse)
async def delete_task_attachment(
    task_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    attachment = db.query(TaskAttachment).filter(
        TaskAttachment.id == attachment_id,
        TaskAttachment.task_id == task_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = os.path.join(UPLOAD_DIR, str(task_id), attachment.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    history = TaskHistory(
        task_id=task_id,
        changed_by=current_user.id,
        field_name="attachment",
        old_value=f"Удалён файл: {attachment.original_name}",
        new_value=None,
    )
    db.add(history)

    db.delete(attachment)
    db.commit()

    return SuccessResponse(message="Attachment deleted")


@router.put("/{task_id}/links", response_model=TaskResponse)
async def update_task_links(
    task_id: int,
    data: TaskLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

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
async def bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Perform bulk actions on multiple tasks"""
    if len(request.task_ids) > 500:
        raise HTTPException(status_code=400, detail="Лимит 500 задач за запрос")

    tasks = db.query(Task).filter(Task.id.in_(request.task_ids), Task.is_deleted == False).all()

    if not tasks:
        return SuccessResponse(message="No tasks found")

    fields_to_update = request.fields or request.updates or {}

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
async def import_tasks(
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

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Файл пуст")

    try:
        return import_service.import_tasks_from_csv(db, content, current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка импорта: {e}")
