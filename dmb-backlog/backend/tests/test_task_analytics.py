from datetime import date

from models import Deadline, Department, Role, Task, TaskType, Team, User
from services.task_analytics import (
    get_lt_reports,
    get_po_pl_reports,
    get_tribe_dashboard,
)
from services.task_metrics import calculate_cost_value_ratio


def test_lt_analytics_excludes_it_lt_as_owner_and_involved_team(db):
    regular_team = Team(name="Core")
    excluded_team = Team(name="ИТ ЛТ")
    task_type = TaskType(code="AD_HOC", name="AD-HOC")
    current_quarter = (date.today().month - 1) // 3 + 1
    deadline = Deadline(
        code=f"Q{current_quarter}_{date.today().year}",
        name=f"{current_quarter}Q {date.today().year}",
    )
    role = Role(name="Лидер трайба", backlog_dmb_access="read")
    db.add_all([regular_team, excluded_team, task_type, deadline, role])
    db.flush()

    user = User(
        email="lt-analytics@example.test",
        password_hash="not-used",
        name="LT Analytics",
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    db.add_all([
        Task(
            team_id=regular_team.id,
            title="Visible task",
            task_type_id=task_type.id,
            deadline_id=deadline.id,
            effort_days=5,
            involved_teams=[excluded_team.id],
        ),
        Task(
            team_id=excluded_team.id,
            title="Excluded task",
            task_type_id=task_type.id,
            deadline_id=deadline.id,
            effort_days=13,
            involved_teams=[regular_team.id],
        ),
    ])
    db.commit()

    reports = get_lt_reports(db=db, current_user=user)

    assert reports["excluded_teams"] == ["ИТ ЛТ"]
    period = reports["active_period"]
    assert period is not None
    assert reports["effort_by_type"][period] == [
        {
            "type": "AD-HOC",
            "tasks": 1,
            "days": 5.0,
            "by_team": {"Core": {"tasks": 1, "days": 5.0}},
        }
    ]
    assert reports["map"][period]["edges"] == []
    assert [task["title"] for task in reports["tasks"]] == ["Visible task"]
    assert all(
        "ИТ ЛТ" not in (link["source"], link["target"])
        for link in reports["sankey"][period]["links"]
    )

    dashboard = get_tribe_dashboard(db=db, current_user=user)
    assert all(row["team"] != "ИТ ЛТ" for row in dashboard["capacity_by_team"])
    assert all(row["team"] != "ИТ ЛТ" for row in dashboard["roi_by_team"])

    po_pl = get_po_pl_reports(db=db, current_user=user)
    assert [task["title"] for task in po_pl["tasks"]] == ["Visible task"]


def test_lt_reports_expose_periods_department_and_cost_value_ratio(db):
    team = Team(name="Core")
    department = Department(code="SALES", name="Продажи")
    task_type = TaskType(code="GOAL", name="Цель")
    deadline = Deadline(code="Q3_2026", name="3Q 2026")
    role = Role(name="Лидер трайба", backlog_dmb_access="read")
    db.add_all([team, department, task_type, deadline, role])
    db.flush()
    user = User(
        email="lt-periods@example.test",
        password_hash="not-used",
        name="LT Periods",
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(Task(
        team_id=team.id,
        title="Quarter task",
        task_type_id=task_type.id,
        deadline_id=deadline.id,
        department_id=department.id,
        effort_days=10,
        effort_rub=250_000,
        financial_effect=2,
    ))
    db.commit()

    reports = get_lt_reports(db=db, current_user=user)
    assert {period["id"] for period in reports["periods"]} >= {"q3_2026", "y2026"}
    task = reports["tasks"][0]
    assert task["department_name"] == "Продажи"
    assert task["cv"] == 0.125
    sankey = reports["sankey"]["q3_2026"]
    assert sankey["customers"] == ["Продажи"]


def test_cost_value_ratio_requires_both_positive_values():
    assert calculate_cost_value_ratio(300_000, 2) == 0.15
    assert calculate_cost_value_ratio(None, 2) is None
    assert calculate_cost_value_ratio(300_000, None) is None
    assert calculate_cost_value_ratio(0, 2) is None
    assert calculate_cost_value_ratio(300_000, 0) is None
