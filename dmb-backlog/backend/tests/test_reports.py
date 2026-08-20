"""Тесты движка фильтров/сортировки/группировки отчётов (execute_report)."""

import json
from datetime import date


def _seed(db):
    from models import (
        BusinessCustomer, Channel, Deadline, Department, Priority, Project,
        Task, TaskStatus, TaskType, Team, User,
    )
    p_high = Priority(name="Высокий")
    p_mid = Priority(name="Средний")
    p_low = Priority(name="Низкий")
    s_req = TaskStatus(code="S_REQ", name="Сбор требований")
    s_done = TaskStatus(code="S_DONE", name="Выполнена")
    team_a = Team(name="Команда А")
    team_b = Team(name="Команда Б")
    proj = Project(code="P_1", name="Проект 1")
    dl_q3 = Deadline(code="D_Q3", name="3Q 2026")
    dl_q4 = Deadline(code="D_Q4", name="4Q 2026")
    tt_kr = TaskType(code="TT_KR", name="МЕТРИЧЕСКИЕ KR")
    tt_reg = TaskType(code="TT_REG", name="Обычная")
    dept = Department(code="DEP_A", name="Департамент А")
    chan = Channel(code="CH_A", name="Канал А")
    bc = BusinessCustomer(name="Заказчик 1")
    owner = User(email="owner@dmb.ru", name="Владелец 1", password_hash="x")
    db.add_all([
        p_high, p_mid, p_low, s_req, s_done, team_a, team_b, proj,
        dl_q3, dl_q4, tt_kr, tt_reg, dept, chan, bc, owner,
    ])
    db.commit()
    for o in [p_high, p_mid, p_low, s_req, s_done, team_a, team_b, proj,
              dl_q3, dl_q4, tt_kr, tt_reg, dept, chan, bc, owner]:
        db.refresh(o)

    tasks = [
        Task(
            team_id=team_a.id, title="Задача 1", priority_id=p_high.id,
            status_id=s_req.id, deadline_id=dl_q3.id, project_id=proj.id,
            owner_id=owner.id, task_type_id=tt_kr.id,
            business_customer_id=bc.id, department_id=dept.id, channel_id=chan.id,
            did_status="В работе", progress=100,
            financial_effect=10.5,
        ),
        Task(
            team_id=team_a.id, title="Задача 2", priority_id=p_low.id,
            status_id=s_done.id, deadline_id=dl_q4.id, task_type_id=tt_reg.id,
            did_status="", progress=0,
            financial_effect=0,
        ),
        Task(
            team_id=team_b.id, title="Задача 3", priority_id=p_mid.id,
            status_id=s_req.id, deadline_id=dl_q3.id,
            did_status="Требует решения", progress=50,
        ),
        Task(
            team_id=team_b.id, title="Задача 4 (без статуса)", priority_id=p_mid.id,
            deadline_id=dl_q3.id, progress=20,
        ),
    ]
    db.add_all(tasks)
    db.commit()
    return tasks


def _create_report(client, headers, name, filters=None, group_by=None, sort_by=None, sort_order="asc"):
    payload = {
        "name": name,
        "description": None,
        "is_public": False,
        "fields": None,
        "filters": json.dumps(filters) if filters else None,
        "group_by": group_by,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }
    resp = client.post("/api/v1/reports/", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _exec(client, headers, report_id):
    resp = client.get(f"/api/v1/reports/{report_id}/execute", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_standard_filters(client, auth_headers, db):
    _seed(db)
    h = auth_headers

    # PIP: status_name != "Выполнена" — включая задачи без статуса
    pip = _create_report(client, h, "PIP", [{"field": "status_name", "operator": "not_equals", "value": "Выполнена"}])
    data = _exec(client, h, pip)
    assert data["total"] == 3
    assert all(i["status_name"] != "Выполнена" for i in data["items"])

    # Бэклог ДИД: did_status != "" (не пусто)
    did = _create_report(client, h, "ДИД", [{"field": "did_status", "operator": "not_equals", "value": ""}])
    data = _exec(client, h, did)
    assert data["total"] == 2
    assert all(i["did_status"] for i in data["items"])

    # Рег. директора: priority_name == "Высокий" (регистронезависимо)
    reg = _create_report(client, h, "Рег. директора", [{"field": "priority_name", "operator": "equals", "value": "Высокий"}])
    data = _exec(client, h, reg)
    assert data["total"] == 1
    assert data["items"][0]["priority_name"] == "Высокий"

    # Регистр значения не важен (справочники могут храниться в верхнем регистре)
    reg_low = _create_report(client, h, "Рег. директора (lower)", [{"field": "priority_name", "operator": "equals", "value": "высокий"}])
    data = _exec(client, h, reg_low)
    assert data["total"] == 1


def test_joined_field_filters(client, auth_headers, db):
    _seed(db)
    h = auth_headers

    def make(field, operator, value):
        rid = _create_report(client, h, field, [{"field": field, "operator": operator, "value": value}])
        return _exec(client, h, rid)

    assert make("deadline_name", "equals", "3Q 2026")["total"] == 3
    assert make("owner_name", "equals", "Владелец 1")["total"] == 1
    assert make("task_type_name", "equals", "Обычная")["total"] == 1
    assert make("business_customer_name", "equals", "Заказчик 1")["total"] == 1
    assert make("department_name", "equals", "Департамент А")["total"] == 1
    assert make("channel_name", "equals", "Канал А")["total"] == 1
    assert make("team_name", "contains", "Команда")["total"] == 4

    # in-оператор по справочному полю
    data = make("status_name", "in", ["Выполнена", "Сбор требований"])
    assert data["total"] == 3

    # contains по прямому полю
    data = make("title", "contains", "Задача")
    assert data["total"] == 4


def test_numeric_and_priority_sort(client, auth_headers, db):
    _seed(db)
    h = auth_headers

    rid = _create_report(client, h, "По прогрессу", None, sort_by="progress", sort_order="desc")
    data = _exec(client, h, rid)
    progresses = [i["progress"] for i in data["items"]]
    assert progresses == sorted(progresses, reverse=True)
    assert progresses[0] == 100

    rid = _create_report(client, h, "По приоритету", None, sort_by="priority_name", sort_order="asc")
    data = _exec(client, h, rid)
    names = [i["priority_name"] for i in data["items"] if i["priority_name"]]
    assert names == ["Низкий", "Средний", "Средний", "Высокий"]


def test_grouping(client, auth_headers, db):
    _seed(db)
    h = auth_headers

    rid = _create_report(client, h, "По командам", None, group_by="team_name")
    data = _exec(client, h, rid)
    assert data["grouped"] is True
    assert data["group_field"] == "team_name"
    group_names = sorted(g["name"] for g in data["groups"])
    assert group_names == ["Команда А", "Команда Б"]
    assert sum(g["count"] for g in data["groups"]) == data["total"]


def test_pip_report_uses_managed_status_and_exposes_planning_fields(client, auth_headers, db):
    from models import Report, TaskStatus

    tasks = _seed(db)
    decision = TaskStatus(code="S_DECISION", name="Принятие решения")
    db.add(decision)
    db.flush()

    tasks[0].status_id = decision.id
    tasks[0].effort_days = 12
    tasks[0].effort_rub = 2.5
    tasks[0].priority_score = 87

    # Имитируем старую конфигурацию в БД: системная логика PIP не должна
    # позволить ей вернуть задачи из других статусов.
    report = Report(
        key="pip",
        name="PI-планирование трайба",
        type="standard",
        filters='[{"field":"status_name","operator":"not_equals","value":"Выполнена"}]',
        fields='["id","title"]',
        group_by="team_name",
        sort_by="progress",
        sort_order="desc",
        is_public=True,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    data = _exec(client, auth_headers, report.id)

    assert data["total"] == 1
    assert data["grouped"] is False
    item = data["items"][0]
    assert item["id"] == tasks[0].id
    assert item["status_name"] == "Принятие решения"
    assert item["task_type_name"] == "МЕТРИЧЕСКИЕ KR"
    assert item["team_name"] == "Команда А"
    assert item["effort_days"] == 12
    assert item["effort_rub"] == 2.5
    assert item["financial_effect"] == 10.5
    assert item["cv"] == 4.2
    assert item["priority_score"] == 87


def test_progress_report_uses_current_quarter_and_relative_traffic_light(client, auth_headers, db):
    from models import Deadline, Report
    from routers.reports_router import _current_quarter_progress, _progress_indicator

    tasks = _seed(db)
    deadline_name, planned = _current_quarter_progress(date.today())
    current_deadline = db.query(Deadline).filter(Deadline.name == deadline_name).first()
    if current_deadline is None:
        current_deadline = Deadline(code=f"TEST_{deadline_name.replace(' ', '_')}", name=deadline_name)
        db.add(current_deadline)
        db.flush()

    tasks[0].deadline_id = current_deadline.id
    tasks[0].progress = round(planned)
    tasks[1].deadline_id = None
    tasks[2].deadline_id = None
    tasks[3].deadline_id = None

    report = Report(
        key="progress",
        name="Прогресс по задачам",
        type="standard",
        filters=None,
        fields='["id"]',
        group_by="team_name",
        sort_by="progress",
        sort_order="desc",
        is_public=True,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    data = _exec(client, auth_headers, report.id)
    assert data["total"] == 1
    assert data["grouped"] is False
    item = data["items"][0]
    assert item["id"] == tasks[0].id
    assert item["planned_progress"] == planned
    assert item["progress_indicator"] == "green"

    assert _progress_indicator(79, 100)[0] == "yellow"
    assert _progress_indicator(50, 100)[0] == "yellow"
    assert _progress_indicator(49, 100)[0] == "red"
    assert _progress_indicator(120, 100)[0] == "green"
