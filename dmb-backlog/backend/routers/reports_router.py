"""
DMB Backlog - Reports Router
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy import func
from sqlalchemy.types import String, Text, Unicode
from typing import List
from datetime import date
import json

from database import get_db, db_lower
from models import (
    Report, Task, User, Team, Priority, TaskStatus, Project, Department,
    TaskType, Deadline, BusinessCustomer, Channel,
)
from schemas import ReportCreate, ReportResponse, ReportUpdate
from auth import get_current_user, task_read_scope_clause
from idempotency import reserve_idempotency
from services.task_metrics import calculate_cost_value_ratio

router = APIRouter()


def _report_to_response(report: Report) -> ReportResponse:
    return ReportResponse(
        id=report.id,
        name=report.name,
        description=report.description,
        type=report.type,
        key=report.key,
        filters=report.filters,
        fields=report.fields,
        group_by=report.group_by,
        sort_by=report.sort_by,
        sort_order=report.sort_order or "asc",
        is_public=report.is_public,
        created_by=report.created_by,
        created_at=report.created_at,
        updated_at=report.updated_at,
        version=report.version or 0,
    )


def _report_version_conflict(report: Report, expected_version: int) -> HTTPException:
    return HTTPException(status_code=409, detail={
        "code": "report_version_conflict",
        "message": "Отчёт уже изменён другим пользователем",
        "report_id": report.id,
        "expected_version": expected_version,
        "current_version": report.version or 0,
    })


# ==================== ДВИЖОК ФИЛЬТРОВ И СОРТИРОВКИ ====================
# Поля согласованы с REPORT_FIELDS в админке, чтобы настройки отчётов
# применялись по тем же правилам, что и у стандартных отчётов.

# Прямые колонки Task, доступные для фильтрации.
REPORT_DIRECT_FIELDS = {
    "id", "title", "description", "involved_teams",
    "key_project_status", "directorate_status", "did_status",
    "did_demo", "effort_days", "effort_rub", "financial_effect", "cv", "priority_score",
    "progress", "date_received", "created_at", "updated_at",
}

# Логические «*_name»-поля -> (relationship Task, модель справочника, колонка).
REPORT_JOINED_FIELDS = {
    "team_name": (Task.team, Team, "name"),
    "priority_name": (Task.priority, Priority, "name"),
    "status_name": (Task.status, TaskStatus, "name"),
    "project_name": (Task.project, Project, "name"),
    "business_customer_name": (Task.business_customer_rel, BusinessCustomer, "name"),
    "department_name": (Task.department, Department, "name"),
    "channel_name": (Task.channel, Channel, "name"),
    "task_type_name": (Task.task_type, TaskType, "name"),
    "deadline_name": (Task.deadline, Deadline, "name"),
    "owner_name": (Task.owner, User, "name"),
}

# Поля, которые сортируются как числа, а не строки.
REPORT_NUMERIC_FIELDS = {
    "id", "progress", "effort_days", "effort_rub", "financial_effect", "cv", "priority_score",
}

PIP_STATUS = "Принятие решения"


def _current_quarter_progress(today: date) -> tuple[str, float]:
    """Вернуть имя дедлайна текущего квартала и линейный план его завершённости."""
    quarter = (today.month - 1) // 3 + 1
    start = date(today.year, (quarter - 1) * 3 + 1, 1)
    next_start = date(today.year + 1, 1, 1) if quarter == 4 else date(today.year, quarter * 3 + 1, 1)
    total_days = (next_start - start).days
    elapsed_days = min(total_days, max(0, (today - start).days + 1))
    return f"{quarter}Q {today.year}", round(elapsed_days / total_days * 100, 1)


def _progress_indicator(actual: int | float | None, planned: float) -> tuple[str, float]:
    """Светофор по относительному отставанию факта от линейного плана."""
    actual_value = float(actual or 0)
    relative_gap = max(0.0, (planned - actual_value) / planned * 100) if planned > 0 else 0.0
    if relative_gap > 50:
        return "red", round(relative_gap, 1)
    if relative_gap > 20:
        return "yellow", round(relative_gap, 1)
    return "green", round(relative_gap, 1)

# Ранг приоритета для корректной сортировки по важности (не по алфавиту).
PRIORITY_RANK = {"ВЫСОКИЙ": 3, "СРЕДНИЙ": 2, "НИЗКИЙ": 1}


def _is_text_column(column):
    return isinstance(getattr(column, "type", None), (String, Text, Unicode))


def _ci(value):
    return value.lower() if isinstance(value, str) else value


def _apply_value_filter(query, column, operator, value):
    """Применить оператор к конкретной колонке (прямой или через join).

    - Строки сравниваются регистронезависимо (SQLite lower() не знает кириллицу,
      поэтому используется переносимое выражение db_lower из database.py).
    - equals "" / not_equals "" трактуются как «пусто или NULL» / «не пусто».
    - not_equals с непустым значением включает NULL (задачи без значения).
    """
    text_col = isinstance(value, str) and _is_text_column(column)
    expr = db_lower(column) if text_col else column
    cval = _ci(value) if text_col else value

    if operator == "equals":
        if value == "":
            return query.filter((expr == "") | (column.is_(None)))
        return query.filter(expr == cval)
    if operator == "not_equals":
        if value == "":
            return query.filter(column.isnot(None), expr != "")
        return query.filter((expr != cval) | (column.is_(None)))
    if operator == "contains":
        return query.filter(expr.like(f"%{cval}%"))
    if operator == "in" and isinstance(value, list):
        if text_col:
            vals = [_ci(v) for v in value if isinstance(v, str)]
            return query.filter(expr.in_(vals))
        return query.filter(column.in_(value))
    if operator == "gt":
        return query.filter(expr > cval)
    if operator == "lt":
        return query.filter(expr < cval)
    return query


def _apply_report_filters(query, filters):
    """Применить фильтры отчёта к запросу.

    Каждый «*_name»-джойн выполняется один раз (внешний), чтобы:
    - фильтры not_equals/equals на справочниках не теряли задачи без значения;
    - повторные фильтры по одному полю не дублировали join.
    """
    for f in filters:
        field = f.get("field")
        if field in REPORT_JOINED_FIELDS:
            rel_attr, _model, _col = REPORT_JOINED_FIELDS[field]
            query = query.join(rel_attr, isouter=True)

    for f in filters:
        field = f.get("field")
        operator = f.get("operator", "equals")
        value = f.get("value")

        if not field or value is None:
            continue
        if isinstance(value, (list, tuple)) and len(value) == 0:
            continue
        if value == "" and operator != "not_equals":
            continue

        if field in REPORT_JOINED_FIELDS:
            rel_attr, model, col_name = REPORT_JOINED_FIELDS[field]
            query = _apply_value_filter(query, getattr(model, col_name), operator, value)
        elif field in REPORT_DIRECT_FIELDS:
            query = _apply_value_filter(query, getattr(Task, field), operator, value)

    return query


def _report_sort_key(item, field):
    """Ключ сортировки: числа — числом, приоритет — по важности, остальное — строкой."""
    value = item.get(field)
    if field in REPORT_NUMERIC_FIELDS:
        try:
            return float(value) if value is not None else 0.0
        except (TypeError, ValueError):
            return 0.0
    if field == "priority_name":
        return PRIORITY_RANK.get((value or "").upper(), 0)
    return str(value).lower() if value is not None else ""


REPORT_ALLOWED_OPERATORS = {"equals", "not_equals", "contains", "in", "gt", "lt"}
REPORT_ALLOWED_GROUP_BY = {"team_name", "project_name", "status_name", "priority_name", "department_name"}
REPORT_ALLOWED_FILTER_FIELDS = REPORT_DIRECT_FIELDS | set(REPORT_JOINED_FIELDS.keys())


def _validate_report_config(filters, fields, group_by, sort_by):
    """Проверить конфиг отчёта перед сохранением.

    Неизвестные поля/операторы отклоняются 400 — иначе отчёт выполнялся бы
    молча по неверным условиям (движок игнорирует неизвестные поля).
    filters/fields приходят JSON-строками из фронтенда.
    """
    def _loads(raw):
        if raw is None:
            return None
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                raise HTTPException(status_code=400, detail="Конфиг отчёта содержит некорректный JSON")
        return raw

    parsed_filters = _loads(filters)
    if parsed_filters:
        if not isinstance(parsed_filters, list):
            raise HTTPException(status_code=400, detail="Фильтры отчёта должны быть списком")
        for f in parsed_filters:
            if not isinstance(f, dict):
                raise HTTPException(status_code=400, detail="Фильтр должен быть объектом")
            field = f.get("field")
            operator = f.get("operator", "equals")
            if field not in REPORT_ALLOWED_FILTER_FIELDS:
                raise HTTPException(status_code=400, detail=f"Неизвестное поле фильтра: {field}")
            if operator not in REPORT_ALLOWED_OPERATORS:
                raise HTTPException(status_code=400, detail=f"Неизвестный оператор фильтра: {operator}")

    parsed_fields = _loads(fields)
    if parsed_fields:
        if not isinstance(parsed_fields, list):
            raise HTTPException(status_code=400, detail="Поля отчёта должны быть списком")
        for field in parsed_fields:
            if field not in REPORT_ALLOWED_FILTER_FIELDS:
                raise HTTPException(status_code=400, detail=f"Неизвестное поле отчёта: {field}")

    if group_by and group_by not in REPORT_ALLOWED_GROUP_BY:
        raise HTTPException(status_code=400, detail=f"Неизвестная группировка: {group_by}")
    if sort_by and sort_by not in REPORT_ALLOWED_FILTER_FIELDS:
        raise HTTPException(status_code=400, detail=f"Неизвестная сортировка: {sort_by}")


# Стандартные отчёты — единый реестр, синхронизированный со страницей «Статусы для встреч».
# Существующие стандартные отчёты в БД получают `key` один раз (миграция).
# После этого админ может свободно править конфиг — повторные перезапуски не перезаписывают его.
DEFAULT_STANDARD_REPORTS = [
    {
        "key": "directorate",
        "name": "Статус для Директорской оперативки",
        "description": "Еженедельный статус для доклада Лидеру трайба",
        "legacy_names": ["Статус для оперативки DMB"],
        "filters": None,
        "fields": None,
        "group_by": None,
        "sort_by": None,
        "sort_order": "asc",
    },
    {
        "key": "did-operational",
        "name": "Статус для оперативки ДИД",
        "description": "Статус по задачам ЦИ и трайба для руководства ДИД",
        "legacy_names": ["Статус для оперативки ДИД"],
        "filters": None,
        "fields": None,
        "group_by": None,
        "sort_by": None,
        "sort_order": "asc",
    },
    {
        "key": "reg-directors",
        "name": "Отчет для Рег. директоров",
        "description": "Статус по задачам для региональных директоров - пользователей IBP",
        "legacy_names": ["Отчет для Рег. директоров"],
        "filters": '[{"field":"priority_name","operator":"equals","value":"Высокий"}]',
        "fields": '["id","title","team_name","project_name","status_name","priority_name","financial_effect","progress"]',
        "group_by": None,
        "sort_by": "priority_name",
        "sort_order": "desc",
    },
    {
        "key": "pip",
        "name": "PI-планирование трайба",
        "description": "Отчет для проведения церемонии Product Increment Planning (PIP)",
        "legacy_names": [],
        "filters": '[{"field":"status_name","operator":"equals","value":"Принятие решения"}]',
        "fields": '["id","title","task_type_name","team_name","effort_days","effort_rub","financial_effect","cv","priority_score"]',
        "group_by": None,
        "sort_by": None,
        "sort_order": "asc",
    },
    {
        "key": "did-backlog",
        "name": "Бэклог для отправки на бизнес-заказчиков ДИД",
        "description": "Задачи, запланированные к реализации в следующем квартале с фин. эффектом по ним",
        "legacy_names": [],
        "filters": '[{"field":"did_status","operator":"not_equals","value":""}]',
        "fields": '["id","title","business_customer_name","project_name","team_name","did_status","progress","deadline_name"]',
        "group_by": None,
        "sort_by": "deadline_name",
        "sort_order": "asc",
    },
    {
        "key": "progress",
        "name": "Светофоры по квартальным задачам",
        "description": "Текущий прогресс по выполнению задач текущего квартала, отклонения, риски",
        "legacy_names": ["Прогресс по задачам"],
        "filters": None,
        "fields": '["id","title","task_type_name","team_name","progress"]',
        "group_by": None,
        "sort_by": None,
        "sort_order": "asc",
    },
]


def ensure_standard_reports(db):
    """Идемпотентная синхронизация стандартных отчётов с реестром.

    - Вставляет недостающие стандартные отчёты (по key или legacy-имени).
    - Для уже существующих отчётов один раз (при первом проходе, пока key пуст)
      выставляет key и приводит name/description/конфиг в соответствие с реестром.
    - После этого конфиг НЕ перезаписывается — правки из админки сохраняются.
    """
    for cfg in DEFAULT_STANDARD_REPORTS:
        report = db.query(Report).filter(Report.key == cfg["key"]).first()

        if report is None:
            for legacy in cfg.get("legacy_names", []):
                legacy_report = db.query(Report).filter(Report.name == legacy).first()
                if legacy_report:
                    report = legacy_report
                    break

        if report is None:
            report = Report(
                key=cfg["key"],
                name=cfg["name"],
                description=cfg["description"],
                type="standard",
                filters=cfg.get("filters"),
                fields=cfg.get("fields"),
                group_by=cfg.get("group_by"),
                sort_by=cfg.get("sort_by"),
                sort_order=cfg.get("sort_order", "asc"),
                is_public=True,
            )
            db.add(report)
            continue

        first_sync = report.key is None
        report.key = cfg["key"]
        if first_sync:
            report.name = cfg["name"]
            report.description = cfg["description"]
            report.filters = cfg.get("filters")
            report.fields = cfg.get("fields")
            report.group_by = cfg.get("group_by")
            report.sort_by = cfg.get("sort_by")
            report.sort_order = cfg.get("sort_order", "asc")
            report.is_public = True

    db.commit()


@router.get("/", response_model=List[ReportResponse])
def get_reports(
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


@router.get("/did-operational-report")
def did_operational_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Отчёт «Статус для оперативки ДИД» — задачи с заполненным did_status,
    дедлайном в текущем квартале (или году — для Q4), без «МЕТРИЧЕСКИЕ KR»,
    с группировкой по командам."""
    today = date.today()
    current_year = today.year
    current_quarter = (today.month - 1) // 3 + 1

    if current_quarter == 4:
        deadline_names = [f"{i}Q {current_year}" for i in range(1, 5)]
        deadline_names.append(f"Y{current_year}")
    else:
        deadline_names = [f"{current_quarter}Q {current_year}"]

    deadline_ids = db.query(Deadline.id).filter(Deadline.name.in_(deadline_names)).all()
    deadline_ids = [d[0] for d in deadline_ids]

    query = db.query(Task).filter(
        Task.is_deleted == False,
        task_read_scope_clause(current_user, Task),
        Task.did_status.isnot(None),
        Task.did_status != "",
        Task.deadline_id.in_(deadline_ids),
    )

    query = query.join(TaskType, Task.task_type_id == TaskType.id, isouter=True).filter(
        (Task.task_type_id == None) | (TaskType.name != "МЕТРИЧЕСКИЕ KR")
    )

    tasks = query.all()

    teams_data = {}
    for task in tasks:
        team_name = task.team.name if task.team else "Без команды"
        if team_name not in teams_data:
            teams_data[team_name] = {
                "team_name": team_name,
                "total": 0,
                "with_demo": 0,
                "without_demo": 0,
                "tasks": []
            }

        teams_data[team_name]["total"] += 1
        has_demo = bool(task.did_demo)
        if has_demo:
            teams_data[team_name]["with_demo"] += 1
        else:
            teams_data[team_name]["without_demo"] += 1

        progress = task.progress or 0
        if task.status:
            status_norm = task.status.name.strip().lower()
            if status_norm in ("выполнена",):
                progress = 100
            elif status_norm in ("отклонена", "не актуальна", "холд"):
                progress = -1

        teams_data[team_name]["tasks"].append({
            "id": task.id,
            "public_id": task.public_id,
            "title": task.title,
            "team_name": team_name,
            "involved_teams": task.involved_teams or "",
            "business_customer_name": task.business_customer_rel.name if task.business_customer_rel else "",
            "project_name": task.project.name if task.project else "",
            "deadline_name": task.deadline.name if task.deadline else "",
            "task_type_name": task.task_type.name if task.task_type else "",
            "progress": progress,
            "did_demo": has_demo,
            "did_status": task.did_status or "",
        })

    sorted_teams = sorted(teams_data.values(), key=lambda x: x["total"], reverse=True)

    return {
        "total_tasks": len(tasks),
        "total_teams": len(sorted_teams),
        "teams": sorted_teams
    }


@router.get("/directorate-report")
def directorate_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Отчёт «Статус для Директорской оперативки» — High Priority / Риск / На контроле,
    с дедлайном в текущем квартале (или году — для Q4), группировка по командам."""
    today = date.today()
    current_year = today.year
    current_quarter = (today.month - 1) // 3 + 1

    if current_quarter == 4:
        deadline_names = [f"{i}Q {current_year}" for i in range(1, 5)]
        deadline_names.append(f"Y{current_year}")
    else:
        deadline_names = [f"{current_quarter}Q {current_year}"]

    deadline_ids = db.query(Deadline.id).filter(Deadline.name.in_(deadline_names)).all()
    deadline_ids = [d[0] for d in deadline_ids]

    high_priority_ids = db.query(Priority.id).filter(Priority.name == "Высокий").all()
    high_priority_ids = [p[0] for p in high_priority_ids]

    query = db.query(Task).filter(
        Task.is_deleted == False,
        task_read_scope_clause(current_user, Task),
        Task.deadline_id.in_(deadline_ids),
        (Task.priority_id.in_(high_priority_ids)) |
        (Task.directorate_status.in_(["Риск", "На контроле"]))
    )

    tasks = query.all()

    teams_data = {}
    for task in tasks:
        team_name = task.team.name if task.team else "Без команды"
        if team_name not in teams_data:
            teams_data[team_name] = {
                "team_name": team_name,
                "total": 0,
                "tasks": []
            }

        teams_data[team_name]["total"] += 1

        progress = task.progress or 0
        if task.status:
            status_norm = task.status.name.strip().lower()
            if status_norm in ("выполнена",):
                progress = 100
            elif status_norm in ("отклонена", "не актуальна", "холд"):
                progress = -1

        teams_data[team_name]["tasks"].append({
            "id": task.id,
            "public_id": task.public_id,
            "title": task.title,
            "directorate_status": task.directorate_status or "",
            "directorate_status_updated_at": task.directorate_status_updated_at.isoformat() if task.directorate_status_updated_at else None,
            "progress": progress,
            "status_name": task.status.name if task.status else "",
            "priority_name": task.priority.name if task.priority else "",
            "financial_effect": task.financial_effect,
            "team_name": team_name,
            "business_customer_name": task.business_customer_rel.name if task.business_customer_rel else "",
            "department_name": task.department.name if task.department else "",
            "project_name": task.project.name if task.project else "",
            "task_type_name": task.task_type.name if task.task_type else "",
            "owner_name": task.owner.name if task.owner else "",
            "description": task.description or "",
        })

    sorted_teams = sorted(teams_data.values(), key=lambda x: x["total"], reverse=True)

    return {
        "total_tasks": len(tasks),
        "total_teams": len(sorted_teams),
        "teams": sorted_teams
    }


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(
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
def create_report(
    report_data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create custom report"""
    _validate_report_config(
        report_data.filters,
        report_data.fields,
        report_data.group_by,
        report_data.sort_by,
    )
    idempotency, is_new_request = reserve_idempotency(
        db,
        operation="report.create",
        user_id=current_user.id,
        request_key=report_data.client_request_id,
        request_data=report_data.model_dump(mode="json", exclude={"client_request_id"}),
    )
    if idempotency and not is_new_request:
        existing = db.query(Report).filter(Report.id == idempotency.resource_id).first()
        if existing:
            return _report_to_response(existing)
        raise HTTPException(status_code=409, detail="Результат повторного запроса больше недоступен")
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
    db.flush()
    if idempotency:
        idempotency.resource_type = "report"
        idempotency.resource_id = report.id
        idempotency.resource_version = report.version or 0
    db.commit()
    db.refresh(report)

    return _report_to_response(report)


@router.put("/{report_id}", response_model=ReportResponse)
def update_report(
    report_id: int,
    report_data: ReportUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update report (owner, or admin — including standard reports)"""
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type == "standard":
        if not (current_user.role and current_user.role.admin_access in ("partial", "full")):
            raise HTTPException(status_code=403, detail="Access denied")
    elif report.created_by != current_user.id:
        if not (current_user.role and current_user.role.admin_access in ("partial", "full")):
            raise HTTPException(status_code=403, detail="Access denied")

    idempotency, is_new_request = reserve_idempotency(
        db,
        operation=f"report.update:{report_id}",
        user_id=current_user.id,
        request_key=report_data.client_request_id,
        request_data=report_data.model_dump(mode="json", exclude={"client_request_id"}),
    )
    if idempotency and not is_new_request:
        return _report_to_response(report)
    if (report.version or 0) != report_data.version:
        raise _report_version_conflict(report, report_data.version)

    _validate_report_config(
        report_data.filters,
        report_data.fields,
        report_data.group_by,
        report_data.sort_by,
    )

    report.name = report_data.name
    report.description = report_data.description
    report.filters = report_data.filters
    report.fields = report_data.fields
    report.group_by = report_data.group_by
    report.sort_by = report_data.sort_by
    report.sort_order = report_data.sort_order
    report.is_public = report_data.is_public
    report.version = (report.version or 0) + 1
    if idempotency:
        idempotency.resource_type = "report"
        idempotency.resource_id = report.id
        idempotency.resource_version = report.version

    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        current = db.query(Report).filter(Report.id == report_id).first()
        if current:
            raise _report_version_conflict(current, report_data.version)
        raise HTTPException(status_code=404, detail="Report not found")
    db.refresh(report)

    return _report_to_response(report)


@router.delete("/{report_id}")
def delete_report(
    report_id: int,
    version: int = Query(..., ge=0),
    client_request_id: str | None = Query(None, min_length=8, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete custom report (only owner or admin)"""
    idempotency, is_new_request = reserve_idempotency(
        db,
        operation=f"report.delete:{report_id}",
        user_id=current_user.id,
        request_key=client_request_id,
        request_data={"report_id": report_id, "version": version},
    )
    if idempotency and not is_new_request:
        return {"message": "Report deleted"}
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if report.type == "standard":
        raise HTTPException(status_code=403, detail="Cannot delete standard reports")

    if report.created_by != current_user.id:
        if not (current_user.role and current_user.role.admin_access in ("partial", "full")):
            raise HTTPException(status_code=403, detail="Access denied")

    if (report.version or 0) != version:
        raise _report_version_conflict(report, version)

    db.delete(report)
    if idempotency:
        idempotency.resource_type = "report_delete"
        idempotency.resource_id = report_id
        idempotency.resource_version = version
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        current = db.query(Report).filter(Report.id == report_id).first()
        if current:
            raise _report_version_conflict(current, version)
        raise HTTPException(status_code=409, detail="Отчёт уже удалён другим пользователем")

    return {"message": "Report deleted"}


@router.get("/{report_id}/execute")
def execute_report(
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

    if report.type == "standard" and report.key in ("directorate", "did-operational"):
        raise HTTPException(
            status_code=400,
            detail="Отчёт выполняется по сценарию страницы «Статусы для встреч» и недоступен через execute",
        )

    query = db.query(Task).filter(
        Task.is_deleted == False,
        task_read_scope_clause(current_user, Task),
    )

    # PI-отчёт — системный срез. Не зависим от устаревшей
    # конфигурации стандартного отчёта в БД.
    if report.type == "standard" and report.key == "pip":
        query = _apply_report_filters(query, [{
            "field": "status_name",
            "operator": "equals",
            "value": PIP_STATUS,
        }])
    elif report.type == "standard" and report.key == "progress":
        deadline_name, _planned_progress = _current_quarter_progress(date.today())
        query = _apply_report_filters(query, [{
            "field": "deadline_name",
            "operator": "equals",
            "value": deadline_name,
        }])
    elif report.filters:
        try:
            filters = json.loads(report.filters) if isinstance(report.filters, str) else report.filters
        except (json.JSONDecodeError, TypeError):
            filters = []

        query = _apply_report_filters(query, filters)

    tasks = query.all()

    items = []
    progress_plan = _current_quarter_progress(date.today())[1] if report.key == "progress" else None
    for task in tasks:
        cv = calculate_cost_value_ratio(task.effort_rub, task.financial_effect)

        progress_indicator, progress_deviation = _progress_indicator(task.progress, progress_plan) if progress_plan is not None else (None, None)
        items.append({
            "id": task.id,
            "public_id": task.public_id,
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
            "business_customer_name": task.business_customer_rel.name if task.business_customer_rel else "",
            "department_name": task.department.name if task.department else "",
            "channel_name": task.channel.name if task.channel else "",
            "task_type_name": task.task_type.name if task.task_type else "",
            "deadline_name": task.deadline.name if task.deadline else "",
            "owner_name": task.owner.name if task.owner else "",
            "progress": task.progress or 0,
            "planned_progress": progress_plan,
            "progress_deviation_percent": progress_deviation,
            "progress_indicator": progress_indicator,
            "effort_days": task.effort_days,
            "effort_rub": task.effort_rub,
            "financial_effect": task.financial_effect,
            "cv": cv,
            "priority_score": task.priority_score,
            "key_project_status": task.key_project_status,
            "directorate_status": task.directorate_status,
            "did_status": task.did_status,
            "involved_teams": task.involved_teams or "",
            "did_demo": bool(task.did_demo),
            "date_received": str(task.date_received) if task.date_received else None,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        })

    effective_sort_by = None if report.key in ("pip", "progress") else report.sort_by
    if effective_sort_by:
        reverse = (report.sort_order or "asc") == "desc"
        items.sort(key=lambda x: _report_sort_key(x, effective_sort_by), reverse=reverse)
        items.sort(key=lambda x: 1 if x.get(effective_sort_by) is None else 0)

    effective_group_by = None if report.key in ("pip", "progress") else report.group_by
    if effective_group_by:
        groups = {}
        for item in items:
            key = item.get(effective_group_by) or "Без группы"
            if key not in groups:
                groups[key] = []
            groups[key].append(item)

        sorted_groups = sorted(groups.items(), key=lambda x: len(x[1]), reverse=True)

        return {
            "total": len(items),
            "grouped": True,
            "group_field": effective_group_by,
            "groups": [
                {"name": name, "items": group_items, "count": len(group_items)}
                for name, group_items in sorted_groups
            ],
            "items": items
        }

    return {"total": len(items), "grouped": False, "items": items}
