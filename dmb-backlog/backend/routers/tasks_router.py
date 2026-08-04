from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, String, cast, case
from typing import Optional, List
from datetime import date, datetime, timezone, timedelta
import json
import os
import uuid
import shutil

from database import get_db
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer, AuditLog, TaskComment, TaskAttachment, Notification, TaskViewer, TeamCompetencyResource, DictionaryItem, FieldLabel
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
    cv = None
    if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
        cv = round(task.financial_effect / task.effort_rub, 2)

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
        business_customer=task.business_customer,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
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
        actual_effort_fe=task.actual_effort_fe,
        actual_effort_test=task.actual_effort_test,
        actual_effort_test_auto=task.actual_effort_test_auto,
        financial_effect=task.financial_effect,
        financial_effect_justification=task.financial_effect_justification,
        ice_score=task.ice_score,
        ice_impact=task.ice_impact,
        ice_confidence=task.ice_confidence,
        ice_ease=task.ice_ease,
        progress=task.progress,
        what_if=task.what_if,
        dod=task.dod,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        status_comment=task.status_comment,
        owner_id=task.owner_id,
        responsible_po_id=task.responsible_po_id,
        business_analyst_id=task.business_analyst_id,
        it_product_lead_id=task.it_product_lead_id,
        key_project=task.key_project,
        key_project_status=task.key_project_status,
        key_project_status_updated_at=task.key_project_status_updated_at,
        directorate_status=task.directorate_status,
        directorate_status_updated_at=task.directorate_status_updated_at,
        did_status=task.did_status,
        did_status_updated_at=task.did_status_updated_at,
        metric_kr_plan=task.metric_kr_plan,
        metric_kr_fact=task.metric_kr_fact,
        is_from_leadership=task.is_from_leadership,
        is_regular=task.is_regular,
        cv=cv,
        last_updated=task.last_updated,
        created_by=task.created_by,
        created_by_name=task.creator.name if task.creator else None,
        involved_team_names=involved_team_names,
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
        responsible_po_name=task.responsible_po.name if task.responsible_po else None,
        business_analyst_name=task.business_analyst.name if task.business_analyst else None,
        it_product_lead_name=task.it_product_lead.name if task.it_product_lead else None,
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


def _competency_costs(db: Session) -> dict:
    """Стоимость чел-дня по компетенциям из справочника competency_cost."""
    items = db.query(DictionaryItem).filter(DictionaryItem.dict_type == 'competency_cost').all()
    costs = {}
    for it in items:
        try:
            costs[it.name] = float(it.code) if it.code else 0
        except (TypeError, ValueError):
            costs[it.name] = 0
    return costs


def compute_effort_rub(db: Session, values: dict, fallback: Optional[float]) -> Optional[float]:
    """Авторасчёт стоимости по ЭО: Σ(ЭО по ролям × ставка роли). С 2 знаками.

    Если ни одно из полей ЭО по ролям не заполнено — возвращает сохранённое значение (fallback).
    """
    costs = _competency_costs(db)
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


@router.get("/", response_model=TaskListResponse)
async def get_tasks(
    team_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    key_project: Optional[bool] = None,
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
    if key_project is not None:
        query = query.filter(Task.key_project == key_project)
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

    key_projects = base_query.filter(Task.key_project == True).count()
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
        "key_projects": key_projects,
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
        "business_customers": [{"id": b.id, "name": b.name} for b in business_customers],
        "users": [{"id": u.id, "name": u.name} for u in users],
        "tags": []
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
            func.coalesce(Task.business_customer, "Без заказчика"),
            func.count(Task.id),
            func.sum(case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.coalesce(func.sum(Task.financial_effect), 0.0)
        ).join(TaskStatus, Task.status_id == TaskStatus.id).filter(
            Task.is_deleted == False
        ).group_by(Task.business_customer).all()
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

        key_rows = db.query(Task).filter(
            Task.is_deleted == False, Task.key_project == True
        ).all()
        key_projects_progress = [
            {"id": t.id, "title": t.title, "team": teams.get(t.team_id, ""), "progress": t.progress,
             "status": t.status.name if t.status else None}
            for t in key_rows
        ]

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
            "key_projects_progress": key_projects_progress,
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
    task.version = (task.version or 0) + 1
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

    # 2. Calculate ICE Score if Impact, Confidence, Ease are provided
    ice_score = task_data.ice_score
    if task_data.ice_impact is not None and task_data.ice_confidence is not None and task_data.ice_ease is not None:
        ice_score = round((task_data.ice_impact * task_data.ice_confidence * task_data.ice_ease) / 10, 1)

    # 3. Default status = НОВАЯ ЗАДАЧА (status_id = 1)
    status_id = task_data.status_id
    if status_id is None:
        status_id = 1

    # Auto-calculate effort cost from role estimates x competency rates
    effort_rub = compute_effort_rub(db, task_data.model_dump(), task_data.effort_rub)

    task = Task(
        team_id=task_data.team_id,
        title=task_data.title,
        description=task_data.description,
        date_received=task_data.date_received or date.today(),
        channel_id=task_data.channel_id,
        business_customer=task_data.business_customer,
        business_customer_id=task_data.business_customer_id,
        department_id=task_data.department_id,
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
        actual_effort_days=task_data.actual_effort_days,
        actual_effort_designee=task_data.actual_effort_designee,
        actual_effort_analytics=task_data.actual_effort_analytics,
        actual_effort_be=task_data.actual_effort_be,
        actual_effort_fe=task_data.actual_effort_fe,
        actual_effort_test=task_data.actual_effort_test,
        actual_effort_test_auto=task_data.actual_effort_test_auto,
        financial_effect=task_data.financial_effect,
        financial_effect_justification=task_data.financial_effect_justification,
        ice_score=ice_score,
        ice_impact=task_data.ice_impact,
        ice_confidence=task_data.ice_confidence,
        ice_ease=task_data.ice_ease,
        cv=cv,
        progress=task_data.progress,
        what_if=task_data.what_if,
        dod=task_data.dod,
        link_mockups=task_data.link_mockups,
        link_jira=task_data.link_jira,
        rejection_reason=task_data.rejection_reason,
        comment=task_data.comment,
        status_comment=task_data.status_comment,
        owner_id=task_data.owner_id,
        responsible_po_id=task_data.responsible_po_id,
        business_analyst_id=task_data.business_analyst_id,
        it_product_lead_id=task_data.it_product_lead_id,
        key_project=task_data.key_project,
        key_project_status=task_data.key_project_status,
        directorate_status=task_data.directorate_status,
        did_status=task_data.did_status,
        metric_kr_plan=task_data.metric_kr_plan,
        metric_kr_fact=task_data.metric_kr_fact,
        is_from_leadership=task_data.is_from_leadership,
        is_regular=task_data.is_regular,
        did_demo=task_data.did_demo,
        last_updated=date.today(),
        created_by=current_user.id
    )

    db.add(task)
    db.commit()
    db.refresh(task)

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

    update_data = task_data.model_dump(exclude_unset=True)

    # Optimistic lock: extract and check version before applying changes
    submitted_version = update_data.pop('version', None)
    if submitted_version is not None and submitted_version != (task.version or 0):
        current = task_to_response(task, db)
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Задача была изменена другим пользователем. Пожалуйста, обновите страницу и повторите изменения.",
                "current_version": task.version or 0,
                "submitted_version": submitted_version,
                "task": current.model_dump()
            }
        )

    for field, new_value in update_data.items():
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

    task.last_updated = date.today()

    # Auto-calculate effort cost from role estimates x competency rates
    if any(f in update_data for f, _ in COMPETENCY_EFFORT_FIELDS):
        vals = {f: getattr(task, f) for f, _ in COMPETENCY_EFFORT_FIELDS}
        task.effort_rub = compute_effort_rub(db, vals, task.effort_rub)

    # Auto-calculate C/V if financial_effect or effort_rub changed
    if 'financial_effect' in update_data or 'effort_rub' in update_data:
        if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
            task.cv = round(task.financial_effect / task.effort_rub, 2)
        else:
            task.cv = None

    # Auto-calculate ICE Score if ICE components changed
    if any(f in update_data for f in ('ice_impact', 'ice_confidence', 'ice_ease')):
        if task.ice_impact is not None and task.ice_confidence is not None and task.ice_ease is not None:
            task.ice_score = round((task.ice_impact * task.ice_confidence * task.ice_ease) / 10, 1)
        else:
            task.ice_score = None

    # Auto-set timestamps when status fields change
    from datetime import datetime, timezone
    if 'directorate_status' in update_data:
        task.directorate_status_updated_at = datetime.now(timezone.utc)
    if 'did_status' in update_data:
        task.did_status_updated_at = datetime.now(timezone.utc)
    if 'key_project_status' in update_data:
        task.key_project_status_updated_at = datetime.now(timezone.utc)

    # Notifications: status change
    new_status_id = task.status_id
    if old_status_id != new_status_id:
        old_status = db.query(TaskStatus).filter(TaskStatus.id == old_status_id).first()
        new_status = db.query(TaskStatus).filter(TaskStatus.id == new_status_id).first()
        old_name = old_status.name if old_status else str(old_status_id)
        new_name = new_status.name if new_status else str(new_status_id)
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
    if task.dod:
        docs.append({"type": "note", "title": "Definition of Done", "content": task.dod})
    if task.what_if:
        docs.append({"type": "note", "title": "What-If анализ", "content": task.what_if})

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
    'responsible_po_id', 'business_analyst_id', 'it_product_lead_id',
    'team_id', 'project_id', 'task_type_id', 'channel_id', 'department_id',
    'business_customer_id', 'key_project', 'key_project_status',
    'directorate_status', 'did_status', 'is_from_leadership', 'is_regular',
    'effort_days', 'effort_rub', 'financial_effect', 'ice_impact',
    'ice_confidence', 'ice_ease', 'status_comment', 'rejection_reason',
    'comment', 'what_if', 'dod', 'link_jira', 'link_mockups', 'date_received'
}

FORBIDDEN_BULK_FIELDS = {
    'id', 'title', 'description', 'is_deleted', 'version', 'created_at',
    'updated_at', 'created_by', 'cv', 'ice_score', 'effort_designee',
    'effort_analytics', 'effort_be', 'effort_fe', 'effort_test',
    'effort_test_auto', 'effort_delivery', 'effort_python_be',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics',
    'actual_effort_be', 'actual_effort_fe', 'actual_effort_test',
    'actual_effort_test_auto', 'metric_kr_plan', 'metric_kr_fact',
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
    """Import tasks from CSV file"""
    import csv
    import io

    if not file.filename or not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Только CSV файлы поддерживаются")

    content = await file.read()
    try:
        decoded_content = content.decode('utf-8-sig')
    except UnicodeDecodeError:
        try:
            decoded_content = content.decode('cp1251')
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Не удалось декодировать файл. Убедитесь, что файл в формате UTF-8 или Windows-1251")

    reader = csv.DictReader(io.StringIO(decoded_content), delimiter=';')
    headers = reader.fieldnames or []

    rows = list(reader)

    created = 0
    updated = 0
    errors = []

    FIELD_MAP = {
        'id': 'id',
        'title': 'title',
        'description': 'description',
        'date_received': 'date_received',
        'channel_id': 'channel_id',
        'business_customer_id': 'business_customer_id',
        'department_id': 'department_id',
        'project_id': 'project_id',
        'task_type_id': 'task_type_id',
        'priority_id': 'priority_id',
        'status_id': 'status_id',
        'deadline_id': 'deadline_id',
        'effort_days': 'effort_days',
        'effort_rub': 'effort_rub',
        'effort_designee': 'effort_designee',
        'effort_analytics': 'effort_analytics',
        'effort_be': 'effort_be',
        'effort_python_be': 'effort_python_be',
        'effort_fe': 'effort_fe',
        'effort_test': 'effort_test',
        'effort_test_auto': 'effort_test_auto',
        'effort_delivery': 'effort_delivery',
        'actual_effort_days': 'actual_effort_days',
        'actual_effort_designee': 'actual_effort_designee',
        'actual_effort_analytics': 'actual_effort_analytics',
        'actual_effort_be': 'actual_effort_be',
        'actual_effort_fe': 'actual_effort_fe',
        'actual_effort_test': 'actual_effort_test',
        'actual_effort_test_auto': 'actual_effort_test_auto',
        'financial_effect': 'financial_effect',
        'financial_effect_justification': 'financial_effect_justification',
        'ice_impact': 'ice_impact',
        'ice_confidence': 'ice_confidence',
        'ice_ease': 'ice_ease',
        'progress': 'progress',
        'what_if': 'what_if',
        'dod': 'dod',
        'link_mockups': 'link_mockups',
        'link_jira': 'link_jira',
        'rejection_reason': 'rejection_reason',
        'comment': 'comment',
        'status_comment': 'status_comment',
        'owner_id': 'owner_id',
        'responsible_po_id': 'responsible_po_id',
        'business_analyst_id': 'business_analyst_id',
        'it_product_lead_id': 'it_product_lead_id',
        'key_project': 'key_project',
        'key_project_status': 'key_project_status',
        'directorate_status': 'directorate_status',
        'did_status': 'did_status',
        'did_demo': 'did_demo',
        'metric_kr_plan': 'metric_kr_plan',
        'metric_kr_fact': 'metric_kr_fact',
        'is_from_leadership': 'is_from_leadership',
        'is_regular': 'is_regular',
        'involved_teams': 'involved_teams',
        'created_by': 'created_by',
    }

    for row_num, row in enumerate(rows, start=2):
        try:
            task_id = row.get('id') or None
            if task_id:
                try:
                    task_id = int(task_id)
                except (ValueError, TypeError):
                    task_id = None

            if task_id:
                existing_task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
                if existing_task:
                    errors.append({
                        "row": row_num,
                        "id": task_id,
                        "message": f"Задача с ID {task_id} уже существует"
                    })
                    continue

            task_data = {}
            for csv_col, model_col in FIELD_MAP.items():
                val = row.get(csv_col)
                if val is None or val == '':
                    continue

                if model_col in ('effort_days', 'effort_rub', 'financial_effect',
                                  'effort_designee', 'effort_analytics', 'effort_be',
                                  'effort_python_be', 'effort_fe', 'effort_test',
                                  'effort_test_auto', 'effort_delivery',
                                  'actual_effort_days', 'actual_effort_designee',
                                  'actual_effort_analytics', 'actual_effort_be',
                                  'actual_effort_fe', 'actual_effort_test',
                                  'actual_effort_test_auto',
                                  'ice_impact', 'ice_confidence', 'ice_ease',
                                  'metric_kr_plan', 'metric_kr_fact'):
                    try:
                        val = float(val) if val and val != '' else None
                    except (ValueError, TypeError):
                        val = None

                elif model_col in ('priority_id', 'status_id', 'team_id', 'channel_id',
                                    'department_id', 'project_id', 'task_type_id',
                                    'deadline_id', 'owner_id', 'responsible_po_id',
                                    'business_analyst_id', 'it_product_lead_id', 'created_by'):
                    try:
                        val = int(val) if val and val != '' else None
                    except (ValueError, TypeError):
                        val = None

                elif model_col in ('progress', 'key_project', 'did_demo',
                                    'is_from_leadership', 'is_regular'):
                    val = str(val).lower() in ('true', '1', 'yes', 'да') if val else False

                elif model_col == 'date_received':
                    if val:
                        for fmt in ('%Y-%m-%d', '%d.%m.%Y', '%d/%m/%Y'):
                            try:
                                val = datetime.strptime(val, fmt).date()
                                break
                            except ValueError:
                                continue
                        else:
                            val = None

                elif model_col == 'link_jira':
                    if val:
                        val = [v.strip() for v in str(val).split(',') if v.strip()]

                elif model_col == 'involved_teams':
                    if val:
                        teams = []
                        for v in str(val).split(','):
                            try:
                                teams.append(int(v.strip()))
                            except (ValueError, TypeError):
                                pass
                        val = teams if teams else None

                task_data[model_col] = val

            if not task_data.get('title'):
                errors.append({
                    "row": row_num,
                    "id": task_id,
                    "message": "Отсутствует обязательное поле 'title'"
                })
                continue

            if not task_data.get('team_id'):
                errors.append({
                    "row": row_num,
                    "id": task_id,
                    "message": "Отсутствует обязательное поле 'team_id'"
                })
                continue

            task = Task(**task_data)
            db.add(task)
            created += 1

        except Exception as e:
            errors.append({
                "row": row_num,
                "id": row.get('id'),
                "message": str(e)
            })

    db.commit()

    return {
        "created": created,
        "updated": updated,
        "errors": errors
    }
