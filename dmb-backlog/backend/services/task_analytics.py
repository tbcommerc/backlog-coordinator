"""Расчётные функции аналитики задач."""
import re
from datetime import date
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from auth import check_permission, get_current_user
from database import get_db
from models import Deadline, Task, TaskStatus, Team, TeamCompetencyResource, User

def get_analytics(
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

def get_tribe_dashboard(
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

