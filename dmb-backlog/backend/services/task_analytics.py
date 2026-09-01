"""Расчётные функции аналитики задач."""
import re
from datetime import date
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from auth import get_current_user, task_read_scope_clause, task_read_scope_team_id
from database import get_db
from models import Deadline, Task, TaskStatus, Team, TeamCompetencyResource, User
from services.task_metrics import calculate_cost_value_ratio


LT_EXCLUDED_TEAM_NAMES = frozenset({"ИТ ЛТ"})
COMPLETED_STATUS_NAMES = frozenset({"ВЫПОЛНЕНА", "СДЕЛАНО", "ЗАВЕРШЕНА", "ЗАКРЫТА"})
TERMINAL_STATUS_NAMES = COMPLETED_STATUS_NAMES | frozenset({"ОТКЛОНЕНА", "НЕ АКТУАЛЬНА"})
REASON_REQUIRED_STATUS_NAMES = frozenset({"ОТКЛОНЕНА", "НЕ АКТУАЛЬНА", "ХОЛД", "ЭСКАЛАЦИЯ НА ЛТ"})


def _lt_task_scope_clause():
    """Exclude teams that must not contribute to Leader Tribe analytics."""
    return ~Task.team.has(Team.name.in_(LT_EXCLUDED_TEAM_NAMES))


def _deadline_period_ids(task: Task, today: date) -> list[str]:
    """Return all report periods that contain the task's single deadline."""
    deadline = task.deadline
    if deadline is None:
        return []
    code = (deadline.code or "").strip().upper()
    q_match = re.match(r"^Q([1-4])[_ -]?(\d{4})$", code)
    if q_match:
        quarter, year = int(q_match.group(1)), int(q_match.group(2))
        result = [f"q{quarter}_{year}", f"y{year}"]
        current_quarter = (today.month - 1) // 3 + 1
        if year == today.year and quarter <= current_quarter:
            result.append(f"ytd_{year}")
        return result
    y_match = re.match(r"^(?:Y|YEAR)[_ -]?(\d{4})$", code)
    if y_match:
        year = int(y_match.group(1))
        result = [f"y{year}"]
        if year == today.year:
            result.append(f"ytd_{year}")
        return result
    return []


def _period_catalog(tasks: list[Task], today: date):
    by_period: dict[str, list[Task]] = {}
    labels: dict[str, str] = {}
    for task in tasks:
        for period_id in _deadline_period_ids(task, today):
            by_period.setdefault(period_id, []).append(task)
            if period_id.startswith("q"):
                match = re.match(r"^q([1-4])_(\d{4})$", period_id)
                if match:
                    labels[period_id] = f"{match.group(1)}Q {match.group(2)}"
            elif period_id.startswith("ytd_"):
                labels[period_id] = f"С начала {period_id[4:]} года"
            else:
                labels[period_id] = f"{period_id[1:]} год"

    current_quarter = (today.month - 1) // 3 + 1
    current_id = f"q{current_quarter}_{today.year}"
    ytd_id = f"ytd_{today.year}"

    def sort_key(period_id: str):
        q_match = re.match(r"^q([1-4])_(\d{4})$", period_id)
        if period_id == current_id:
            return (0, 0, 0)
        if period_id == ytd_id:
            return (1, 0, 0)
        if q_match:
            return (2, int(q_match.group(2)), int(q_match.group(1)))
        if period_id.startswith("y") and not period_id.startswith("ytd_"):
            return (3, int(period_id[1:]), 0)
        return (4, 0, 0)

    periods = sorted(by_period, key=sort_key)
    active = current_id if current_id in by_period else (periods[0] if periods else None)
    return periods, labels, by_period, active


def _role_total(task: Task, prefix: str = "") -> float:
    suffixes = (
        "designee", "analytics", "be", "python_be", "fe", "test", "test_auto", "delivery",
    )
    return round(sum(float(getattr(task, f"{prefix}effort_{suffix}") or 0) for suffix in suffixes), 2)


def _analytics_task(task: Task, team_names: dict[int, str], today: date) -> dict:
    involved_ids = []
    for raw_id in task.involved_teams or []:
        try:
            team_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if team_id == task.team_id or team_id not in team_names or team_id in involved_ids:
            continue
        involved_ids.append(team_id)

    status_name = task.status.name if task.status else None
    return {
        "id": task.id,
        "public_id": task.public_id,
        "title": task.title,
        "team_id": task.team_id,
        "team_name": task.team.name if task.team else None,
        "involved_team_ids": involved_ids,
        "involved_team_names": [team_names[i] for i in involved_ids],
        "department_id": task.department_id,
        "department_name": task.department.name if task.department else None,
        "business_customer_id": task.business_customer_id,
        "business_customer_name": task.business_customer_rel.name if task.business_customer_rel else None,
        "channel_id": task.channel_id,
        "channel_name": task.channel.name if task.channel else None,
        "project_id": task.project_id,
        "project_name": task.project.name if task.project else None,
        "task_type_id": task.task_type_id,
        "task_type_name": task.task_type.name if task.task_type else None,
        "priority_id": task.priority_id,
        "priority_name": task.priority.name if task.priority else None,
        "status_id": task.status_id,
        "status_name": status_name,
        "deadline_id": task.deadline_id,
        "deadline_name": task.deadline.name if task.deadline else None,
        "deadline_code": task.deadline.code if task.deadline else None,
        "period_ids": _deadline_period_ids(task, today),
        "date_received": task.date_received.isoformat() if task.date_received else None,
        "effort_days": float(task.effort_days) if task.effort_days is not None else None,
        "effort_role_total": _role_total(task),
        "actual_effort_days": float(task.actual_effort_days) if task.actual_effort_days is not None else None,
        "actual_effort_role_total": _role_total(task, "actual_"),
        "effort_rub": float(task.effort_rub) if task.effort_rub is not None else None,
        "financial_effect": float(task.financial_effect) if task.financial_effect is not None else None,
        "cv": calculate_cost_value_ratio(task.effort_rub, task.financial_effect),
        "progress": task.progress,
        "owner_id": task.owner_id,
        "owner_name": task.owner.name if task.owner else None,
        "owner_active": task.owner.is_active if task.owner else None,
        "rejection_reason": task.rejection_reason,
        "is_terminal": bool(status_name and status_name.upper() in TERMINAL_STATUS_NAMES),
        "is_completed": bool(status_name and status_name.upper() in COMPLETED_STATUS_NAMES),
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def get_analytics(
    type: str = Query("tribe"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return analytics aggregation data by type (tribe or po-pl)"""
    if type not in ("tribe", "po-pl"):
        raise HTTPException(status_code=400, detail="Invalid analytics type")

    terminal = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")
    scope_clause = task_read_scope_clause(current_user, Task)
    scope_team_id = task_read_scope_team_id(current_user)
    task_query = db.query(Task).filter(Task.is_deleted == False, scope_clause)
    if type == "tribe":
        task_query = task_query.filter(_lt_task_scope_clause())
    tasks = task_query.all()
    team_query = db.query(Team)
    if type == "tribe":
        team_query = team_query.filter(Team.name.notin_(LT_EXCLUDED_TEAM_NAMES))
    if scope_team_id is not None:
        team_query = team_query.filter(Team.id == scope_team_id)
    teams = {t.id: t.name for t in team_query.all()}

    if type == "tribe":
        high_cv = []
        low_cv = []
        for t in tasks:
            cv = calculate_cost_value_ratio(t.effort_rub, t.financial_effect)
            if cv is not None:
                entry = {"id": t.id, "title": t.title, "team": teams.get(t.team_id, ""), "cv": cv, "financial_effect": t.financial_effect}
                if cv <= 0.3:
                    high_cv.append(entry)
                else:
                    low_cv.append(entry)

        high_cv.sort(key=lambda x: x["cv"])
        low_cv.sort(key=lambda x: x["cv"], reverse=True)

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
            Task.is_deleted == False,
            scope_clause,
            _lt_task_scope_clause(),
        ).group_by(Team.name).all()
        risk_by_team = {r[0]: {"total": r[1], "risk": r[2]} for r in risk_rows}

        status_rows = db.query(TaskStatus.name, func.count(Task.id)).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False,
            scope_clause,
            _lt_task_scope_clause(),
        ).group_by(TaskStatus.name).all()
        health_by_status = {r[0]: r[1] for r in status_rows}

        fin_rows = db.query(
            Team.name,
            func.coalesce(func.sum(Task.financial_effect), 0.0)
        ).join(Task, Task.team_id == Team.id).filter(
            Task.is_deleted == False,
            scope_clause,
            _lt_task_scope_clause(),
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
            Task.is_deleted == False,
            scope_clause,
        ).group_by(Team.name).all()
        workload_by_team = {
            r[0]: {"total": r[1], "active": r[2], "avg_progress": round(float(r[3]), 1)}
            for r in workload_rows
        }

        total_tasks = db.query(Task).filter(Task.is_deleted == False, scope_clause).count()
        on_track = db.query(Task).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False,
            scope_clause,
            Task.deadline_id != None,
            TaskStatus.name.in_(terminal)
        ).count()
        overdue = db.query(Task).join(
            TaskStatus, Task.status_id == TaskStatus.id
        ).filter(
            Task.is_deleted == False,
            scope_clause,
            Task.deadline_id != None,
            TaskStatus.name.notin_(terminal)
        ).count()
        no_deadline = db.query(Task).filter(
            Task.is_deleted == False, scope_clause, Task.deadline_id == None
        ).count()
        deadline_pct = round(on_track / total_tasks * 100, 1) if total_tasks else 0

        missing_attrs = {
            "no_effort_days": db.query(Task).filter(Task.is_deleted == False, scope_clause, Task.effort_days == None).count(),
            "no_effort_rub": db.query(Task).filter(Task.is_deleted == False, scope_clause, Task.effort_rub == None).count(),
            "no_financial_effect": db.query(Task).filter(Task.is_deleted == False, scope_clause, Task.financial_effect == None).count(),
            "no_owner": db.query(Task).filter(Task.is_deleted == False, scope_clause, Task.owner_id == None).count(),
            "no_deadline": db.query(Task).filter(Task.is_deleted == False, scope_clause, Task.deadline_id == None).count(),
        }

        return {
            "workload_by_team": workload_by_team,
            "deadline_compliance": {"on_track": on_track, "overdue": overdue, "no_deadline": no_deadline, "compliance_pct": deadline_pct},
            "missing_attributes": missing_attrs
        }

def get_effort_by_type(
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
        task_read_scope_clause(current_user, Task),
        _lt_task_scope_clause(),
    )

    scope = "tribe" if task_read_scope_team_id(current_user) is None else "team"

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

def get_tribe_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Сводные агрегации для дашборда Лидера Трайба:
    Загрузка команд vs ёмкость, матрица приоритет×срок,
    ROI по командам."""
    terminal = ("ВЫПОЛНЕНА", "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА")

    scope_clause = task_read_scope_clause(current_user, Task)
    scope_team_id = task_read_scope_team_id(current_user)
    tasks = db.query(Task).filter(
        Task.is_deleted == False,
        scope_clause,
        _lt_task_scope_clause(),
    ).all()
    team_query = db.query(Team).filter(Team.name.notin_(LT_EXCLUDED_TEAM_NAMES))
    resource_query = db.query(TeamCompetencyResource)
    if scope_team_id is not None:
        team_query = team_query.filter(Team.id == scope_team_id)
        resource_query = resource_query.filter(TeamCompetencyResource.team_id == scope_team_id)
    teams = {t.id: t.name for t in team_query.all()}
    deadline_order = {d.id: d.name for d in db.query(Deadline).all()}

    # --- Загрузка команд vs ёмкость ---
    cap_rows = resource_query.all()
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
        # PostgreSQL DECIMAL values arrive as Decimal.  Normalise them before
        # accumulating into float totals used by the JSON response.
        a["financial_effect"] += float(t.financial_effect or 0)
        a["effort_rub"] += float(t.effort_rub or 0)
    roi_by_team = [
        {
            "team": k,
            "financial_effect": round(v["financial_effect"], 1),
            "effort_rub": round(v["effort_rub"], 1),
            "roi": calculate_cost_value_ratio(v["effort_rub"], v["financial_effect"]),
        }
        for k, v in sorted(roi.items())
    ]

    return {
        "capacity_by_team": capacity_by_team,
        "priority_deadline": priority_deadline,
        "roi_by_team": roi_by_team,
    }

def get_lt_reports(
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
    query = db.query(Task).filter(
        Task.is_deleted == False,
        task_read_scope_clause(current_user, Task),
        _lt_task_scope_clause(),
    )

    scope = "tribe" if task_read_scope_team_id(current_user) is None else "team"

    tasks = query.all()
    team_names = {
        t.id: t.name
        for t in db.query(Team).filter(Team.name.notin_(LT_EXCLUDED_TEAM_NAMES)).all()
    }

    today = date.today()
    periods, period_labels, period_tasks, active_period = _period_catalog(tasks, today)

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
            c = t.department.name if t.department else "Без подразделения"
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
    for pid, ts in period_tasks.items():
        effort_by_type[pid] = effort_rows(ts)
        sankey[pid] = sankey_data(ts)
        map_reports[pid] = map_data(ts)

    return {
        "periods": [{"id": p, "label": period_labels[p]} for p in periods],
        "active_period": active_period,
        "scope": scope,
        "excluded_teams": sorted(LT_EXCLUDED_TEAM_NAMES),
        "tasks": [_analytics_task(task, team_names, today) for task in tasks],
        "effort_by_type": effort_by_type,
        "sankey": sankey,
        "map": map_reports,
    }


def get_po_pl_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dataset for the prototype-style completeness and quality reports."""
    today = date.today()
    tasks = db.query(Task).filter(
        Task.is_deleted == False,
        task_read_scope_clause(current_user, Task),
        _lt_task_scope_clause(),
    ).all()
    team_names = {
        team.id: team.name
        for team in db.query(Team).filter(Team.name.notin_(LT_EXCLUDED_TEAM_NAMES)).all()
    }
    return {
        "scope": "tribe" if task_read_scope_team_id(current_user) is None else "team",
        "excluded_teams": sorted(LT_EXCLUDED_TEAM_NAMES),
        "quality_thresholds": {
            "uniform_share_pct": 80,
            "uniform_min_tasks": 10,
            "cv_good_max": 0.30,
            "cv_warning_max": 1.00,
        },
        "tasks": [_analytics_task(task, team_names, today) for task in tasks],
    }
