from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, func, String, cast
from typing import Optional, List
from datetime import date

from database import get_db
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer
from schemas import (
    TaskCreate, TaskUpdate, TaskResponse, TaskListResponse,
    BulkActionRequest, SuccessResponse, TaskHistoryResponse
)
from auth import get_current_user, check_permission

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


def task_to_response(task: Task) -> TaskResponse:
    """Convert Task ORM object to TaskResponse schema"""
    cv = None
    if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
        cv = round(task.financial_effect / task.effort_rub, 2)

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
        deadline_po_id=task.deadline_po_id,
        effort_days=task.effort_days,
        effort_rub=task.effort_rub,
        financial_effect=task.financial_effect,
        ice_score=task.ice_score,
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
        directorate_status=task.directorate_status,
        did_status=task.did_status,
        is_from_leadership=task.is_from_leadership,
        is_regular=task.is_regular,
        cv=cv,
        last_updated=task.last_updated,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        team_name=task.team.name if task.team else None,
        channel_name=task.channel.name if task.channel else None,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        deadline_po_name=task.deadline_po.name if task.deadline_po else None,
        owner_name=task.owner.name if task.owner else None,
        responsible_po_name=task.responsible_po.name if task.responsible_po else None,
        business_analyst_name=task.business_analyst.name if task.business_analyst else None,
        it_product_lead_name=task.it_product_lead.name if task.it_product_lead else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
    )


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

    items = [task_to_response(task) for task in tasks]

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

    return [task_to_response(task) for task in tasks]


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
        func.sum(func.case(
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
            func.sum(func.case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(func.case((TaskStatus.name == "ВЫПОЛНЕНА", 1), else_=0)),
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
            func.sum(func.case((TaskStatus.name.notin_(terminal), 1), else_=0)),
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
            func.sum(func.case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(func.case((TaskStatus.name == "ВЫПОЛНЕНА", 1), else_=0)),
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
            func.sum(func.case((TaskStatus.name.notin_(terminal), 1), else_=0)),
            func.sum(func.case((risk_condition, 1), else_=0)),
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
            func.sum(func.case((risk_condition, 1), else_=0))
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
            func.sum(func.case((TaskStatus.name.notin_(terminal), 1), else_=0)),
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

    return task_to_response(task)


@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(task_data: TaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create new task"""
    if not check_permission(current_user, "backlog_team", "write_own"):
        raise HTTPException(status_code=403, detail="Permission denied")

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
        status_id=task_data.status_id,
        deadline_id=task_data.deadline_id,
        deadline_po_id=task_data.deadline_po_id,
        effort_days=task_data.effort_days,
        effort_rub=task_data.effort_rub,
        financial_effect=task_data.financial_effect,
        ice_score=task_data.ice_score,
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
        is_from_leadership=task_data.is_from_leadership,
        is_regular=task_data.is_regular,
        last_updated=date.today(),
        created_by=current_user.id
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    return task_to_response(task)


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

    update_data = task_data.model_dump(exclude_unset=True)
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

    db.commit()
    db.refresh(task)

    return task_to_response(task)


@router.get("/{task_id}/history", response_model=List[TaskHistoryResponse])
async def get_task_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get change history for a task"""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    history = db.query(TaskHistory).filter(
        TaskHistory.task_id == task_id
    ).order_by(TaskHistory.changed_at.desc()).limit(50).all()

    FIELD_LABELS = {
        "title": "Название", "description": "Описание", "status_id": "Статус",
        "priority_id": "Приоритет", "team_id": "Команда", "project_id": "Проект",
        "task_type_id": "Тип задачи", "channel_id": "Канал поступления",
        "department_id": "Подразделение", "business_customer_id": "Бизнес-заказчик",
        "owner_id": "Владелец", "responsible_po_id": "Ответственный PO",
        "business_analyst_id": "Бизнес-аналитик", "it_product_lead_id": "IT Product Lead",
        "deadline_id": "Дедлайн", "deadline_po_id": "PO-дедлайн",
        "effort_days": "Трудозатраты (дни)", "effort_rub": "Трудозатраты (руб)",
        "financial_effect": "Фин. эффект", "progress": "Прогресс",
        "directorate_status": "Статус для директорской",
        "did_status": "Статус для ДИД", "key_project_status": "Статус ключ. проекта",
        "key_project": "Ключевой проект", "is_from_leadership": "От руководства",
        "is_regular": "Регулярная", "comment": "Комментарий",
        "status_comment": "Статус-комментарий", "link_mockups": "Макеты",
        "link_jira": "Jira ссылка", "dod": "DoD", "what_if": "What-If",
    }

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


@router.post("/bulk", response_model=SuccessResponse)
async def bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Perform bulk actions on multiple tasks"""
    tasks = db.query(Task).filter(Task.id.in_(request.task_ids), Task.is_deleted == False).all()

    for task in tasks:
        if request.action == "close":
            done_status = db.query(TaskStatus).filter(TaskStatus.name == "ВЫПОЛНЕНА").first()
            if done_status:
                task.status_id = done_status.id
            task.progress = 100
        elif request.action == "hold":
            hold_status = db.query(TaskStatus).filter(TaskStatus.name == "ХОЛД").first()
            if hold_status:
                task.status_id = hold_status.id
        elif request.action == "delete":
            task.is_deleted = True

    db.commit()
    return SuccessResponse(message=f"Action '{request.action}' applied to {len(tasks)} tasks")
