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
from models import Report, Task, User, Team
from schemas import ReportCreate, ReportResponse, TaskResponse
from auth import get_current_user, require_permission

router = APIRouter()


@router.get("/", response_model=List[ReportResponse])
async def get_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all reports (standard + user's custom)"""
    reports = db.query(Report).filter(
        (Report.type == "standard") | 
        (Report.created_by == current_user.id) | 
        (Report.is_public == True)
    ).all()
    
    result = []
    for report in reports:
        result.append(ReportResponse(
            id=report.id,
            name=report.name,
            description=report.description,
            type=report.type,
            filters=report.filters,
            fields=report.fields,
            group_by=report.group_by,
            sort_by=report.sort_by,
            sort_order=report.sort_order,
            is_public=report.is_public,
            created_by=report.created_by,
            created_at=report.created_at
        ))
    return result


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
    
    return ReportResponse(
        id=report.id,
        name=report.name,
        description=report.description,
        type=report.type,
        filters=report.filters,
        fields=report.fields,
        group_by=report.group_by,
        sort_by=report.sort_by,
        sort_order=report.sort_order,
        is_public=report.is_public,
        created_by=report.created_by,
        created_at=report.created_at
    )


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
        by_status[t.status or "Не указан"] += 1
        by_priority[t.priority or "Средний"] += 1
        team_name = t.team.name if t.team else "Без команды"
        by_team[team_name] += 1
        by_owner[t.owner or "Не назначен"] += 1

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
        "high_priority": sum(1 for t in tasks if t.priority == "Высокий"),
        "at_risk": sum(1 for t in tasks if t.status in ("Холд", "Отклонена")),
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
    """Execute report and return filtered results"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    # Build query based on report filters
    query = db.query(Task).filter(Task.is_deleted == False)
    
    if report.filters:
        filters = json.loads(report.filters)
        for f in filters:
            field = f.get("field")
            operator = f.get("operator")
            value = f.get("value")
            
            if field and operator and value:
                column = getattr(Task, field, None)
                if column:
                    if operator == "equals":
                        query = query.filter(column == value)
                    elif operator == "contains":
                        query = query.filter(column.ilike(f"%{value}%"))
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
            "team": task.team.name if task.team else "",
            "priority": task.priority,
            "status": task.status,
            "deadline": str(task.deadline) if task.deadline else "",
            "progress": task.progress,
            "financial_effect": task.financial_effect,
            "effort_rub": task.effort_rub,
            "cv": cv
        })
    
    return {"total": len(items), "items": items}