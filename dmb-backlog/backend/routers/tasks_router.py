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
from models import Task, User, Team, TaskHistory, TaskStatus, Priority, Deadline, Channel, Department, Project, TaskType, BusinessCustomer, AuditLog, TaskComment, TaskAttachment, Notification, TaskViewer
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
        directorate_status=task.directorate_status,
        directorate_status_updated_at=task.directorate_status_updated_at,
        did_status=task.did_status,
        did_status_updated_at=task.did_status_updated_at,
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
        version=task.version or 0,
        lock_owner_id=task.lock_owner_id,
        lock_owner_name=task.lock_owner.name if task.lock_owner else None,
        lock_until=task.lock_until,
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

    return task_to_response(task)


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
        deadline_po_id=task_data.deadline_po_id,
        effort_days=task_data.effort_days,
        effort_rub=task_data.effort_rub,
        financial_effect=task_data.financial_effect,
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
        is_from_leadership=task_data.is_from_leadership,
        is_regular=task_data.is_regular,
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
        current = task_to_response(task)
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
        "ice_impact": "ICE Impact", "ice_confidence": "ICE Confidence",
        "ice_ease": "ICE Ease", "ice_score": "ICE Score", "cv": "C/V",
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
    if data.link_jira is not None and data.link_jira != (task.link_jira or ""):
        old = task.link_jira or ""
        task.link_jira = data.link_jira
        changes["link_jira"] = (old, data.link_jira)

    for field_name, (old_val, new_val) in changes.items():
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

    return task_to_response(task)


@router.post("/bulk", response_model=SuccessResponse)
async def bulk_action(request: BulkActionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Perform bulk actions on multiple tasks"""
    tasks = db.query(Task).filter(Task.id.in_(request.task_ids), Task.is_deleted == False).all()

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

        if new_status_name:
            notify_status_change(db, task, old_status_name, new_status_name, current_user.id)

    db.commit()
    return SuccessResponse(message=f"Action '{request.action}' applied to {len(tasks)} tasks")
