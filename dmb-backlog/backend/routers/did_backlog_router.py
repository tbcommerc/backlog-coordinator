"""DID report, scoped preferences and authenticated exports."""
import base64
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.dialects.postgresql import insert as pg_insert
from auth import require_permission, task_read_scope_clause
from database import get_db, db_lower
from models import Task, TaskType, TaskStatus, Deadline, User, UserReportPreference
from services.did_backlog import (COLUMNS, EXCLUDED_STATUSES, clean_prefs, current_quarter,
    report_quarters, task_row, apply_view, summary)
from services.did_backlog_export import workbook, print_html

router = APIRouter(dependencies=[Depends(require_permission("reports", "read"))])
KEY = "did-backlog"


def portfolio_query(db, user):
    return db.query(Task).join(Task.task_type).join(Task.deadline).outerjoin(Task.status).filter(
        Task.is_deleted.is_(False), task_read_scope_clause(user, Task),
        db_lower(func.trim(TaskType.name)).in_(["квартальная/годовая цель", "ad-hoc"]),
        or_(Task.status_id.is_(None), ~db_lower(func.trim(TaskStatus.name)).in_(EXCLUDED_STATUSES)))


def portfolio_rows(db, user, quarter):
    tasks = portfolio_query(db, user).options(*(joinedload(getattr(Task, key)) for key in
        ("did_client_group", "team", "project", "task_type", "department", "business_customer_rel", "deadline"))).all()
    return [task_row(task) for task in tasks if quarter in report_quarters(task.deadline.name, task.task_type.name)]


class ViewCommand(BaseModel):
    quarter: str = Field(pattern=r"^[1-4]Q 20\d{2}$")
    filters: dict = Field(default_factory=dict)
    sortField: str | None = None
    sortDir: str = "asc"
    widths: dict = Field(default_factory=dict)
    ordered_ids: list[int] = Field(default_factory=list, max_length=100000)

    @model_validator(mode="before")
    @classmethod
    def reject_user_override(cls, data):
        if isinstance(data, dict) and "user_id" in data:
            raise ValueError("Пользователь определяется по сеансу; user_id передавать нельзя")
        return data


@router.get("/quarters")
def quarters(db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    names = portfolio_query(db, user).with_entities(Deadline.name, TaskType.name).distinct().all()
    available = {q for name, task_type in names for q in report_quarters(name, task_type)}
    available.add(current_quarter())
    return {"current_quarter": current_quarter(), "quarters": sorted(available, key=lambda q: (q[3:], q[0]))}


@router.get("/preferences")
def get_preferences(db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    item = db.query(UserReportPreference).filter_by(user_id=user.id, report_key=KEY).first()
    return {"saved": item is not None, "prefs": clean_prefs(item.prefs if item else {})}


@router.put("/preferences")
def save_preferences(command: ViewCommand, db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    prefs = clean_prefs(command.model_dump())
    # Atomic upsert: two tabs cannot race on the unique user/report pair.
    insert = pg_insert if db.bind.dialect.name == "postgresql" else __import__("sqlalchemy.dialects.sqlite", fromlist=["insert"]).insert
    statement = insert(UserReportPreference).values(user_id=user.id, report_key=KEY, prefs=prefs)
    db.execute(statement.on_conflict_do_update(index_elements=["user_id", "report_key"], set_={"prefs": prefs, "updated_at": func.now()}))
    db.commit()
    return {"saved": True}


@router.delete("/preferences")
def reset_preferences(db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    db.query(UserReportPreference).filter_by(user_id=user.id, report_key=KEY).delete()
    db.commit()
    return {"saved": False}


@router.get("")
def report(quarter: str | None = Query(None, pattern=r"^[1-4]Q 20\d{2}$"), db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    quarter = quarter or current_quarter()
    rows = apply_view(portfolio_rows(db, user, quarter), {})
    return {"quarter": quarter, "total_tasks": len(rows), **summary(rows), "tasks": rows,
            "can_export": bool(user.can_export and user.role and user.role.can_export)}


@router.post("/export/{format}")
def export(format: Literal["xlsx", "pdf"], command: ViewCommand, db: Session = Depends(get_db), user: User = Depends(require_permission("reports"))):
    if not (user.can_export and user.role and user.role.can_export):
        raise HTTPException(403, "Нет права на экспорт")
    prefs = clean_prefs(command.model_dump())
    rows = apply_view(portfolio_rows(db, user, command.quarter), prefs)
    if "ordered_ids" in command.model_fields_set:
        if len(command.ordered_ids) != len(rows) or set(command.ordered_ids) != {r["id"] for r in rows}:
            raise HTTPException(409, "Состав отчёта изменился. Обновите отчёт перед выгрузкой.")
        by_id = {r["id"]: r for r in rows}
        rows = [by_id[id] for id in command.ordered_ids]
    if format == "pdf":
        return {"html": print_html(command.quarter, rows, prefs["widths"])}
    return {"filename": f"did-backlog_{command.quarter.replace(' ', '_')}_{date.today().isoformat()}.xlsx",
            "content": base64.b64encode(workbook(command.quarter, rows, prefs["widths"])).decode()}
