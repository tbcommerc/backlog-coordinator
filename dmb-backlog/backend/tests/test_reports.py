"""Тесты движка фильтров/сортировки/группировки отчётов (execute_report)."""

import json


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
