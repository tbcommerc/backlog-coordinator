"""Тесты движка фильтров/сортировки/группировки отчётов (execute_report)."""

import json
from datetime import date, datetime, timedelta, timezone


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


def test_directorate_report_uses_ready_status_without_quarter_filter(client, auth_headers, db):
    from models import Deadline, Priority, ReportingMeeting, Task, TaskReportingStatus, Team

    today = date.today()
    quarter = (today.month - 1) // 3 + 1
    deadline_name = f"{quarter}Q {today.year}"
    deadline = Deadline(code="TEST_DIRECTORATE_PERIOD", name=deadline_name)
    other_deadline = Deadline(code="TEST_DIRECTORATE_OTHER_PERIOD", name=f"1Q {today.year + 2}")
    medium = Priority(name="Средний")
    team = Team(name="Тестовая команда директорской")
    empty_team = Team(name="Команда без готовых статусов")
    db.add_all([deadline, other_deadline, medium, team, empty_team])
    db.flush()
    included = Task(
        title="Готовый статус текущего квартала",
        team_id=team.id,
        deadline_id=deadline.id,
        priority_id=medium.id,
        directorate_status="Устаревший текст задачи",
    )
    included_other_period = Task(
        title="Готовый статус другого квартала",
        team_id=team.id,
        deadline_id=other_deadline.id,
        priority_id=medium.id,
    )
    not_ready = Task(
        title="Заполненный, но не готовый статус",
        team_id=team.id,
        deadline_id=deadline.id,
        priority_id=medium.id,
    )
    previous_meeting = ReportingMeeting(
        kind="directorate",
        occurrence_key="test-directorate-previous",
        scheduled_date=today,
        original_scheduled_date=today,
        state="held",
    )
    meeting = ReportingMeeting(
        kind="directorate",
        occurrence_key="test-directorate-current",
        scheduled_date=today,
        original_scheduled_date=today,
        state="planned",
    )
    db.add_all([included, included_other_period, not_ready, previous_meeting, meeting])
    db.flush()
    db.add_all([
        TaskReportingStatus(
            meeting_id=previous_meeting.id,
            task_id=included.id,
            status_text="Статус предыдущей встречи",
            is_ready=True,
        ),
        TaskReportingStatus(
            meeting_id=meeting.id,
            task_id=included.id,
            status_text="Статус текущей встречи",
            is_ready=True,
            directorate_attention=True,
        ),
        TaskReportingStatus(
            meeting_id=meeting.id,
            task_id=included_other_period.id,
            status_text="Статус вне текущего квартала",
            is_ready=True,
        ),
        TaskReportingStatus(
            meeting_id=meeting.id,
            task_id=not_ready.id,
            status_text="Черновик статуса",
            is_ready=False,
        ),
    ])
    db.commit()

    response = client.get("/api/v1/reports/directorate-report", headers=auth_headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total_tasks"] == 2
    assert data["total_teams"] == 2
    empty_team_data = next(item for item in data["teams"] if item["team_name"] == empty_team.name)
    assert empty_team_data == {"team_name": empty_team.name, "total": 0, "tasks": []}
    tasks = {item["title"]: item for item in data["teams"][0]["tasks"]}
    assert set(tasks) == {"Готовый статус текущего квартала", "Готовый статус другого квартала"}
    assert tasks["Готовый статус текущего квартала"]["directorate_status"] == "Статус текущей встречи"
    assert tasks["Готовый статус текущего квартала"]["previous_directorate_status"] == "Статус предыдущей встречи"
    assert tasks["Готовый статус текущего квартала"]["directorate_attention"] is True
    assert tasks["Готовый статус текущего квартала"]["can_edit_attention"] is True

    marker_response = client.put(
        f"/api/v1/tasks/{included.id}/reporting-statuses/{meeting.id}/directorate-attention",
        headers=auth_headers,
        json={"enabled": False, "version": tasks["Готовый статус текущего квартала"]["reporting_status_version"]},
    )
    assert marker_response.status_code == 200, marker_response.text
    assert marker_response.json()["directorate_attention"] is False


def test_team_weekly_report_prioritizes_attention_and_exposes_next_step(client, auth_headers, db):
    from models import ReportingMeeting, Task, TaskReportingStatus, Team
    from reporting_meetings import current_meeting, ensure_reporting_schedule

    team = Team(name="Команда недельного пульса")
    db.add(team)
    db.flush()
    task = Task(title="Подготовить пилот", team_id=team.id, progress=60)
    db.add(task)
    ensure_reporting_schedule(db)
    meeting = current_meeting(db, "team_weekly")
    db.flush()
    db.add(TaskReportingStatus(
        meeting_id=meeting.id,
        task_id=task.id,
        status_text="Прототип проверен на фокус-группе",
        weekly_payload={
            "signal": "decision",
            "next_step": "Запустить пилот",
            "next_step_due": date.today().isoformat(),
            "decision_request": "Согласовать 20 участников",
        },
        progress_snapshot=60,
        is_ready=True,
    ))
    db.commit()

    response = client.get(
        f"/api/v1/reports/team-weekly-report?team_id={team.id}",
        headers=auth_headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()
    item = next(row for row in data["items"] if row["title"] == task.title)
    assert item["signal"] == "decision"
    assert item["result"] == "Прототип проверен на фокус-группе"
    assert item["next_step"] == "Запустить пилот"
    assert item["decision_request"] == "Согласовать 20 участников"
    assert item["is_ready"] is True
    assert data["summary"]["attention"] >= 1


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


def test_quarterly_goals_report_includes_goals_and_adhoc_and_applies_scope(client, auth_headers, db):
    from models import Deadline, Report, StartShift, Task, TaskStatus, TaskType, Team, User
    from routers.reports_router import (
        _current_quarter_progress,
        _moscow_today,
        _progress_freshness,
        _progress_indicator,
        _progress_is_stale,
        _quarter_progress,
    )

    tasks = _seed(db)
    deadline_name, planned = _current_quarter_progress(_moscow_today())
    current_deadline = db.query(Deadline).filter(Deadline.name == deadline_name).first()
    if current_deadline is None:
        current_deadline = Deadline(code=f"TEST_{deadline_name.replace(' ', '_')}", name=deadline_name)
        db.add(current_deadline)
        db.flush()

    goal_type = TaskType(code="quarterly_goal", name="КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ")
    adhoc_type = TaskType(code="adhoc", name="AD-HOC")
    tech_debt_type = TaskType(code="tech_debt", name="ТЕХДОЛГ")
    hold_status = TaskStatus(code="hold", name="ХОЛД")
    excluded_team = Team(name="Delivery", domain="Delivery")
    shifts = [
        StartShift(code="M1", name="С первого месяца квартала", month_number=1, sort_order=1),
        StartShift(code="M2", name="Со второго месяца квартала", month_number=2, sort_order=2),
        StartShift(code="M3", name="С третьего месяца квартала", month_number=3, sort_order=3),
    ]
    db.add_all([goal_type, adhoc_type, tech_debt_type, hold_status, excluded_team, *shifts])
    db.flush()

    current_user = db.query(User).filter(User.email == "test@dmb.ru").one()
    tasks[0].team.po_id = current_user.id

    tasks[0].deadline_id = current_deadline.id
    tasks[0].task_type_id = goal_type.id
    tasks[0].progress = round(planned)
    tasks[1].deadline_id = current_deadline.id
    tasks[1].task_type_id = adhoc_type.id
    tasks[1].team_id = tasks[2].team_id
    tasks[2].deadline_id = None
    tasks[2].task_type_id = adhoc_type.id
    tasks[3].deadline_id = current_deadline.id
    tasks[3].task_type_id = goal_type.id

    excluded_tasks = [
        Task(title="Техдолг", deadline_id=current_deadline.id, task_type_id=tech_debt_type.id, status_id=tasks[0].status_id, team_id=tasks[0].team_id),
        Task(title="Обеспечивающая команда", deadline_id=current_deadline.id, task_type_id=goal_type.id, status_id=tasks[0].status_id, team_id=excluded_team.id),
        Task(title="Холд", deadline_id=current_deadline.id, task_type_id=goal_type.id, status_id=hold_status.id, team_id=tasks[0].team_id),
    ]
    db.add_all(excluded_tasks)

    report = Report(
        key="quarterly-goals",
        name="Светофоры по квартальным целям",
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
    assert data["total"] == 2
    assert data["grouped"] is False
    included_ids = {item["id"] for item in data["items"]}
    assert included_ids == {tasks[0].id, tasks[1].id}
    item = next(item for item in data["items"] if item["id"] == tasks[0].id)
    assert item["id"] == tasks[0].id
    assert item["planned_progress"] == planned
    assert item["progress_indicator"] == "green"
    assert item["progress_freshness"] == "unconfirmed"
    assert item["progress_freshness_label"] == "Не подтверждён"
    assert item["traffic_reason"] == "Данные требуют обновления"

    assert _current_quarter_progress(date(2026, 7, 1))[1] == 0
    assert _progress_indicator(80, 100) == ("green", 20)
    assert _progress_indicator(79, 100) == ("yellow", 21)
    assert _progress_indicator(41, 100) == ("yellow", 59)
    assert _progress_indicator(40, 100) == ("red", 60)
    assert _progress_indicator(120, 100) == ("green", 0)
    assert _progress_indicator(None, 100) == ("red", None)
    assert _progress_indicator(0, None) == ("green", 0)

    preparation_response = client.get(
        "/api/v1/reports/quarterly-goals/preparation",
        headers=auth_headers,
    )
    assert preparation_response.status_code == 200, preparation_response.text
    preparation = preparation_response.json()
    assert preparation["summary"]["total_tasks"] == 2
    assert [shift["code"] for shift in preparation["start_shifts"]] == ["M1", "M2", "M3"]
    editable = next(item for item in preparation["items"] if item["task_id"] == tasks[0].id)
    assert editable["can_edit"] is True
    cross_team = next(item for item in preparation["items"] if item["task_id"] == tasks[1].id)
    assert cross_team["can_edit"] is True

    cross_team_response = client.put(
        f"/api/v1/reports/quarterly-goals/tasks/{tasks[1].id}",
        headers=auth_headers,
        json={"progress": 40, "start_shift_id": shifts[0].id, "version": cross_team["version"]},
    )
    assert cross_team_response.status_code == 200, cross_team_response.text

    update_response = client.put(
        f"/api/v1/reports/quarterly-goals/tasks/{tasks[0].id}",
        headers=auth_headers,
        json={"progress": 35, "start_shift_id": shifts[2].id, "version": editable["version"]},
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["progress"] == 35
    assert updated["start_shift_id"] == shifts[2].id
    assert updated["planned_progress"] == _quarter_progress(_moscow_today(), 3)
    assert updated["progress_updated_at"] is not None

    recalculated = _exec(client, auth_headers, report.id)
    updated_report_item = next(item for item in recalculated["items"] if item["id"] == tasks[0].id)
    assert updated_report_item["progress"] == 35
    assert updated_report_item["start_shift_month"] == 3
    assert updated_report_item["planned_progress"] == _quarter_progress(_moscow_today(), 3)
    assert updated_report_item["progress_freshness"] == "current"
    assert updated_report_item["progress_freshness_label"] == "Актуален"
    assert updated_report_item["traffic_reason"] != "Данные требуют обновления"

    tasks[0].progress = None
    assert _progress_is_stale(tasks[0]) is True
    assert _progress_freshness(tasks[0]) == ("missing", "Факт не заполнен")
    tasks[0].progress = 35
    tasks[0].progress_updated_at = datetime.now(timezone.utc) - timedelta(days=15)
    assert _progress_is_stale(tasks[0]) is True
    assert _progress_freshness(tasks[0]) == ("stale", "Устарел")


def test_standard_report_registry_reuses_legacy_progress_report(db):
    from models import Report
    from routers.reports_router import ensure_standard_reports

    legacy = Report(
        key="progress",
        name="Светофоры по квартальным задачам",
        description="Старое описание",
        type="standard",
        is_public=True,
    )
    db.add(legacy)
    db.commit()
    legacy_id = legacy.id

    ensure_standard_reports(db)

    migrated = db.query(Report).filter(Report.key == "quarterly-goals").all()
    assert len(migrated) == 1
    assert migrated[0].id == legacy_id
    assert migrated[0].name == "Светофоры по квартальным целям"
    assert migrated[0].description == "Статус квартальных целей и AD-HOC-задач команд трайба"
    assert db.query(Report).filter(Report.key == "progress").count() == 0
