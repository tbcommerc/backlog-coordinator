"""
DMB Backlog - Reports Router
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, cast, Date
from typing import Optional, List
from datetime import date, timedelta
from collections import defaultdict
import json

from database import get_db
from models import Report, Task, User, Team, Priority, TaskStatus, Project, Department
from schemas import ReportCreate, ReportResponse, TaskResponse
from auth import get_current_user, require_permission

router = APIRouter()


def _report_to_response(report: Report) -> ReportResponse:
    return ReportResponse(
        id=report.id,
        name=report.name,
        description=report.description,
        type=report.type,
        filters=report.filters,
        fields=report.fields,
        group_by=report.group_by,
        sort_by=report.sort_by,
        sort_order=report.sort_order or "asc",
        is_public=report.is_public,
        created_by=report.created_by,
        created_at=report.created_at
    )


@router.get("/", response_model=List[ReportResponse])
async def get_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all reports (standard + user's custom + public)"""
    reports = db.query(Report).filter(
        (Report.type == "standard") |
        (Report.created_by == current_user.id) |
        (Report.is_public == True)
    ).order_by(Report.created_at.desc()).all()

    return [_report_to_response(r) for r in reports]


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get a single report by ID"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type != "standard" and report.created_by != current_user.id and not report.is_public:
        raise HTTPException(status_code=403, detail="Access denied")

    return _report_to_response(report)


@router.post("/", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    report_data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create custom report"""
    report = Report(
        name=report_data.name,
        description=report_data.description,
        type="custom",
        created_by=current_user.id,
        filters=report_data.filters,
        fields=report_data.fields,
        group_by=report_data.group_by,
        sort_by=report_data.sort_by,
        sort_order=report_data.sort_order,
        is_public=report_data.is_public
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return _report_to_response(report)


@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: int,
    report_data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update custom report (only owner or admin)"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type == "standard":
        raise HTTPException(status_code=403, detail="Cannot edit standard reports")

    if report.created_by != current_user.id:
        if not (current_user.role and current_user.role.admin_access in ("partial", "full")):
            raise HTTPException(status_code=403, detail="Access denied")

    report.name = report_data.name
    report.description = report_data.description
    report.filters = report_data.filters
    report.fields = report_data.fields
    report.group_by = report_data.group_by
    report.sort_by = report_data.sort_by
    report.sort_order = report_data.sort_order
    report.is_public = report_data.is_public

    db.commit()
    db.refresh(report)

    return _report_to_response(report)


@router.delete("/{report_id}")
async def delete_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete custom report (only owner or admin)"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type == "standard":
        raise HTTPException(status_code=403, detail="Cannot delete standard reports")

    if report.created_by != current_user.id:
        if not (current_user.role and current_user.role.admin_access in ("partial", "full")):
            raise HTTPException(status_code=403, detail="Access denied")

    db.delete(report)
    db.commit()

    return {"message": "Report deleted"}


@router.get("/meeting-status")
async def get_meeting_status(
    report_type: Optional[str] = Query(None, description="directorate | did | projects | reg-directors"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get aggregated meeting status data with charts-ready format"""

    query = db.query(Task).filter(Task.is_deleted == False)

    tasks = query.all()
    total = len(tasks)

    if report_type == "directorate":
        tasks = [t for t in tasks if t.priority == "Высокий" or t.directorate_status in ("Риск", "На контроле")]
    elif report_type == "did":
        tasks = [t for t in tasks if t.did_status in ("В работе", "Требует решения", "Блокировано")]
    elif report_type == "projects":
        tasks = [t for t in tasks if t.key_project]
    elif report_type == "reg-directors":
        tasks = [t for t in tasks if t.priority == "Высокий"]

    filtered = len(tasks)

    by_status = defaultdict(int)
    by_priority = defaultdict(int)
    by_team = defaultdict(int)
    by_owner = defaultdict(int)

    for t in tasks:
        status_name = t.status.name if t.status else "Не указан"
        priority_name = t.priority.name if t.priority else "Средний"
        team_name = t.team.name if t.team else "Без команды"
        owner_name = t.owner.name if t.owner else "Не назначен"
        by_status[status_name] += 1
        by_priority[priority_name] += 1
        by_team[team_name] += 1
        by_owner[owner_name] += 1

    status_colors = {
        "Сбор требований": "#6366f1",
        "Экспресс-оценка": "#8b5cf6",
        "Принятие решения": "#f59e0b",
        "В работе": "#10b981",
        "Отклонена": "#ef4444",
        "Не актуальна": "#94a3b8",
        "Холд": "#f43f5e",
        "Выполнена": "#22c55e",
    }
    priority_colors = {
        "Высокий": "#f43f5e",
        "Средний": "#f59e0b",
        "Низкий": "#94a3b8",
    }

    def sort_by_value(d):
        return sorted(d.items(), key=lambda x: x[1], reverse=True)

    return {
        "total": total,
        "filtered": filtered,
        "high_priority": sum(1 for t in tasks if t.priority and t.priority.name == "Высокий"),
        "at_risk": sum(1 for t in tasks if t.status and t.status.name in ("Холд", "Отклонена")),
        "avg_progress": round(sum(t.progress or 0 for t in tasks) / filtered, 1) if filtered else 0,
        "status_distribution": [{"label": k, "value": v, "color": status_colors.get(k, "#94a3b8")} for k, v in sort_by_value(by_status)],
        "priority_distribution": [{"label": k, "value": v, "color": priority_colors.get(k, "#94a3b8")} for k, v in sort_by_value(by_priority)],
        "team_distribution": [{"label": k, "value": v} for k, v in sort_by_value(by_team)],
        "owner_distribution": [{"label": k, "value": v} for k, v in sort_by_value(by_owner)],
        "total_financial_effect": round(sum(t.financial_effect or 0 for t in tasks), 2),
    }


@router.get("/{report_id}/execute")
async def execute_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Execute report — apply saved filters, grouping and sorting"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type != "standard" and report.created_by != current_user.id and not report.is_public:
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(Task).filter(Task.is_deleted == False)

    if report.filters:
        try:
            filters = json.loads(report.filters) if isinstance(report.filters, str) else report.filters
        except (json.JSONDecodeError, TypeError):
            filters = []

        for f in filters:
            field = f.get("field")
            operator = f.get("operator", "equals")
            value = f.get("value")

            if not field or value is None:
                continue

            column = getattr(Task, field, None)
            if column is None:
                if field == "team_name":
                    query = query.join(Team, Task.team_id == Team.id)
                    if operator == "equals":
                        query = query.filter(Team.name == value)
                    elif operator == "contains":
                        query = query.filter(Team.name.ilike(f"%{value}%"))
                elif field == "priority_name":
                    query = query.join(Priority, Task.priority_id == Priority.id)
                    if operator == "equals":
                        query = query.filter(Priority.name == value)
                    elif operator == "in" and isinstance(value, list):
                        query = query.filter(Priority.name.in_(value))
                elif field == "status_name":
                    query = query.join(TaskStatus, Task.status_id == TaskStatus.id)
                    if operator == "equals":
                        query = query.filter(TaskStatus.name == value)
                    elif operator == "in" and isinstance(value, list):
                        query = query.filter(TaskStatus.name.in_(value))
                elif field == "project_name":
                    query = query.join(Project, Task.project_id == Project.id)
                    if operator == "equals":
                        query = query.filter(Project.name == value)
                    elif operator == "contains":
                        query = query.filter(Project.name.ilike(f"%{value}%"))
                continue

            if operator == "equals":
                if isinstance(value, bool):
                    query = query.filter(column == value)
                else:
                    query = query.filter(column == value)
            elif operator == "not_equals":
                query = query.filter(column != value)
            elif operator == "contains":
                query = query.filter(column.ilike(f"%{value}%"))
            elif operator == "in" and isinstance(value, list):
                query = query.filter(column.in_(value))
            elif operator == "gt":
                query = query.filter(column > value)
            elif operator == "lt":
                query = query.filter(column < value)

    tasks = query.all()

    items = []
    for task in tasks:
        cv = None
        if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
            cv = round(task.financial_effect / task.effort_rub, 2)

        items.append({
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "team_id": task.team_id,
            "team_name": task.team.name if task.team else "",
            "priority_id": task.priority_id,
            "priority_name": task.priority.name if task.priority else "",
            "status_id": task.status_id,
            "status_name": task.status.name if task.status else "",
            "project_id": task.project_id,
            "project_name": task.project.name if task.project else "",
            "business_customer": task.business_customer or "",
            "business_customer_name": task.business_customer_rel.name if task.business_customer_rel else "",
            "department_name": task.department.name if task.department else "",
            "channel_name": task.channel.name if task.channel else "",
            "task_type_name": task.task_type.name if task.task_type else "",
            "deadline_name": task.deadline.name if task.deadline else "",
            "owner_name": task.owner.name if task.owner else "",
            "progress": task.progress or 0,
            "effort_days": task.effort_days,
            "effort_rub": task.effort_rub,
            "financial_effect": task.financial_effect,
            "cv": cv,
            "ice_score": task.ice_score,
            "key_project": task.key_project,
            "key_project_status": task.key_project_status,
            "directorate_status": task.directorate_status,
            "did_status": task.did_status,
            "date_received": str(task.date_received) if task.date_received else None,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        })

    if report.sort_by:
        reverse = (report.sort_order or "asc") == "desc"
        items.sort(key=lambda x: str(x.get(report.sort_by, "") or "").lower(), reverse=reverse)

    if report.group_by:
        groups = {}
        for item in items:
            key = item.get(report.group_by) or "Без группы"
            if key not in groups:
                groups[key] = []
            groups[key].append(item)

        sorted_groups = sorted(groups.items(), key=lambda x: len(x[1]), reverse=True)

        return {
            "total": len(items),
            "grouped": True,
            "group_field": report.group_by,
            "groups": [
                {"name": name, "items": group_items, "count": len(group_items)}
                for name, group_items in sorted_groups
            ],
            "items": items
        }

    return {"total": len(items), "grouped": False, "items": items}
