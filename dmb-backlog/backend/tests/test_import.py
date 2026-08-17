"""
Tests for CSV task import flow (backend/tests/test_import.py).

Покрывает таблицу из 15 типов ошибок импорта + позитивные сценарии:
автодетект разделителя, смешанный файл,
task_jira_links (двойная запись), task_history, audit_log.
"""
import pytest

from models import (
    Team, Channel, BusinessCustomer, Department, Project, TaskType,
    Priority, Deadline, TaskStatus, User, FieldLabel, Task, TaskHistory,
    AuditLog, TaskJiraLink,
)


# ==================== FIXTURES / HELPERS ====================

def _seed_field_labels(db):
    rows = [
        ("title", "Название задачи", True),
        ("team_id", "Ответственная команда", True),
        ("description", "Описание задачи", False),
        ("date_received", "Дата получения", False),
        ("channel_id", "Канал поступления", False),
        ("business_customer_id", "Бизнес-заказчик", False),
        ("department_id", "Подразделение Бизнес-заказчика", False),
        ("project_id", "Проект", False),
        ("task_type_id", "Тип задачи", False),
        ("priority_id", "Приоритет", False),
        ("status_id", "Статус задачи", False),
        ("deadline_id", "Срок выполнения", False),
        ("owner_id", "Исполнитель", False),
        ("progress", "Прогресс", False),
        ("effort_days", "Оценка трудозатрат (ЭО) (ч/д)", False),
        ("effort_rub", "Стоимость по ЭО (руб)", False),
        ("link_jira", "Ссылки на Jira", False),
        ("involved_teams", "Другие вовлеченные команды", False),
    ]
    for key, label, required in rows:
        db.add(FieldLabel(key=key, label=label, group="основные",
                          sort_order=0, is_required=required))
    db.commit()


@pytest.fixture
def refs(db):
    """Базовые справочники для валидных строк."""
    _seed_field_labels(db)
    team = Team(name="Команда А")
    channel = Channel(code="ch1", name="Почта")
    bc = BusinessCustomer(name="Заказчик А")
    dept = Department(code="D1", name="Подразделение А")
    project = Project(code="P1", name="Проект А")
    tt = TaskType(code="t1", name="AD-HOC")
    prio = Priority(name="СРЕДНИЙ")
    dl = Deadline(code="dl1", name="1Q 2026")
    st = TaskStatus(code="st1", name="НОВАЯ ЗАДАЧА")
    user = User(name="Иванов Иван", email="ivanov@test.ru",
                password_hash="x", is_active=True)
    for obj in (team, channel, bc, dept, project, tt, prio, dl, st, user):
        db.add(obj)
    db.commit()
    for obj in (team, channel, bc, dept, project, tt, prio, dl, st, user):
        db.refresh(obj)
    return {
        "team": team.id, "channel": channel.id, "customer": bc.id,
        "department": dept.id, "project": project.id, "task_type": tt.id,
        "priority": prio.id, "deadline": dl.id, "status": st.id,
        "user": user.id,
    }


def _import(client, headers, csv_text, filename="tasks.csv"):
    return client.post(
        "/api/v1/tasks/import",
        headers=headers,
        files={"file": (filename, csv_text.encode("utf-8"), "text/csv")},
    )


VALID_HEADERS = (
    "title;team_id;description;date_received;channel_id;"
    "business_customer_id;department_id;project_id;task_type_id;"
    "priority_id;deadline_id;status_id"
)

# Индексы колонок для модификации в тестах ошибок 2-9
COL = {
    "channel": 4, "customer": 5, "department": 6, "project": 7,
    "task_type": 8, "priority": 9, "deadline": 10, "status": 11,
}
DATE_COL = 3


def _valid_row():
    return [
        "Задача тест", "Команда А", "Описание", "2026-01-01",
        "Почта", "Заказчик А", "Подразделение А", "Проект А",
        "AD-HOC", "СРЕДНИЙ", "1Q 2026", "НОВАЯ ЗАДАЧА",
    ]


def _valid_csv(*rows):
    return "\n".join([VALID_HEADERS, *[
        ";".join(r) if isinstance(r, list) else r for r in rows]])


# ==================== POSITIVE SCENARIOS ====================

def test_valid_import_creates_task_history_audit_jira(client, auth_headers, db, refs):
    csv_text = (
        VALID_HEADERS + ";owner_id;progress;effort_days;link_jira\n"
        + ";".join(_valid_row())
        + ";Иванов Иван;50;5;https://jira.example.com/ABC-1,https://jira.example.com/ABC-2\n"
    )
    resp = _import(client, auth_headers, csv_text)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    assert data["created"] == 1
    assert data["skipped"] == 0
    assert data["errors"] == []

    task = db.query(Task).filter(Task.title == "Задача тест").first()
    assert task is not None
    assert task.title == "Задача тест"
    assert task.team_id == refs["team"]
    assert task.channel_id == refs["channel"]
    assert task.business_customer_id == refs["customer"]
    assert task.department_id == refs["department"]
    assert task.project_id == refs["project"]
    assert task.task_type_id == refs["task_type"]
    assert task.priority_id == refs["priority"]
    assert task.deadline_id == refs["deadline"]
    assert task.status_id == refs["status"]
    assert task.owner_id == refs["user"]
    assert task.progress == 50
    assert task.effort_days == 5

    # Jira: двойная запись (task_jira_links + link_jira JSON)
    links = db.query(TaskJiraLink).filter(TaskJiraLink.task_id == task.id).all()
    assert {l.url for l in links} == {
        "https://jira.example.com/ABC-1", "https://jira.example.com/ABC-2"}
    assert task.link_jira == [
        "https://jira.example.com/ABC-1", "https://jira.example.com/ABC-2"]

    # task_history
    history = db.query(TaskHistory).filter(TaskHistory.task_id == task.id).all()
    fields = {h.field_name for h in history}
    assert "title" in fields and "team_id" in fields

    # audit_log
    audit = db.query(AuditLog).filter(AuditLog.entity_type == "task",
                                      AuditLog.action == "import",
                                      AuditLog.entity_id == task.id).first()
    assert audit is not None


def test_russian_labels_headers(client, auth_headers, db, refs):
    csv_text = (
        "Название задачи;Описание задачи;Ответственная команда\n"
        "Задача RU;Описание;Команда А\n"
    )
    resp = _import(client, auth_headers, csv_text)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["created"] == 1, data
    task = db.query(Task).filter(Task.title == "Задача RU").first()
    assert task is not None and task.team_id == refs["team"]


def test_delimiter_autodetect_comma(client, auth_headers, db, refs):
    csv_text = VALID_HEADERS.replace(";", ",") + "\n" + ",".join(_valid_row()) + "\n"
    resp = _import(client, auth_headers, csv_text)
    assert resp.status_code == 200, resp.text
    assert resp.json()["created"] == 1


def test_mixed_valid_and_invalid(client, auth_headers, db, refs):
    bad = _valid_row()
    bad[0] = ""  # пустой title -> required_missing
    csv_text = _valid_csv(_valid_row(), bad)
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 1
    assert data["skipped"] == 1
    assert data["errors"][0]["row"] == 3
    assert data["errors"][0]["type"] == "required_missing"


# ==================== ERROR SCENARIOS ====================

def test_error_1_team_not_found(client, auth_headers, db, refs):
    csv_text = "title;description;team_id\n"
    csv_text += "Задача 1;Описание;НетТакоиКоманды\n"
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 0 and data["skipped"] == 1
    assert data["errors"][0]["type"] == "team_not_found"
    assert "НетТакоиКоманды" in data["errors"][0]["message"]


def test_error_2_channel_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["channel"]] = "НетТакогоКанала"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "channel_not_found"
    assert data["skipped"] == 1


def test_error_3_business_customer_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["customer"]] = "НетТакогоЗаказчика"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "business_customer_not_found"


def test_error_4_department_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["department"]] = "НетТакогоПодразделения"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "department_not_found"


def test_error_5_project_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["project"]] = "НетТакогоПроекта"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "project_not_found"


def test_error_6_task_type_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["task_type"]] = "НетТакогоТипа"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "task_type_not_found"


def test_error_7_priority_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["priority"]] = "НетТакогоПриоритета"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "priority_not_found"


def test_error_8_deadline_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["deadline"]] = "НетТакогоСрока"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "deadline_not_found"


def test_error_9_status_not_found(client, auth_headers, db, refs):
    row = _valid_row()
    row[COL["status"]] = "НетТакогоСтатуса"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "status_not_found"


def test_error_10_owner_not_found_row_imported(client, auth_headers, db, refs):
    csv_text = (
        "title;description;owner_id;team_id\n"
        "Задача 10;Описание;НетТакогоИсполнителя;Команда А\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 1
    assert data["skipped"] == 0
    errs = [e for e in data["errors"] if e["type"] == "owner_not_found"]
    assert len(errs) == 1
    assert errs[0]["fatal"] is False
    task = db.query(Task).filter(Task.title == "Задача 10").first()
    assert task is not None and task.owner_id is None


def test_error_11_required_missing(client, auth_headers, db, refs):
    csv_text = (
        "description;team_id\n"
        "Описание;Команда А\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 0 and data["skipped"] == 1
    types = {e["type"] for e in data["errors"]}
    assert "required_missing" in types


def test_error_12_invalid_date(client, auth_headers, db, refs):
    row = _valid_row()
    row[DATE_COL] = "не-дата"
    data = _import(client, auth_headers, _valid_csv(row)).json()
    assert data["errors"][0]["type"] == "invalid_date"
    assert data["skipped"] == 1


def test_error_13_invalid_number(client, auth_headers, db, refs):
    csv_text = (
        "title;description;effort_days;team_id\n"
        "Задача 13;Описание;abc;Команда А\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["errors"][0]["type"] == "invalid_number"
    assert data["skipped"] == 1


def test_error_14_invalid_progress(client, auth_headers, db, refs):
    csv_text = (
        "title;description;progress;team_id\n"
        "Задача 14;Описание;150;Команда А\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["errors"][0]["type"] == "invalid_progress"
    assert data["skipped"] == 1


def test_involved_teams_by_team_name(client, auth_headers, db, refs):
    db.add(Team(name="Команда Б"))
    db.commit()
    team_b = db.query(Team).filter(Team.name == "Команда Б").first()
    csv_text = (
        "title;description;team_id;involved_teams\n"
        "Задача IT1;Описание;Команда А;Команда Б,Команда А\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 1 and data["skipped"] == 0
    assert data["errors"] == []
    task = db.query(Task).filter(Task.title == "Задача IT1").first()
    assert set(task.involved_teams) == {refs["team"], team_b.id}


def test_involved_teams_not_found_fatal(client, auth_headers, db, refs):
    csv_text = (
        "title;description;team_id;involved_teams\n"
        "Задача IT2;Описание;Команда А;НесуществующаяКоманда\n"
    )
    data = _import(client, auth_headers, csv_text).json()
    assert data["created"] == 0 and data["skipped"] == 1
    errs = [e for e in data["errors"] if e["type"] == "team_not_found"]
    assert len(errs) == 1
    assert errs[0]["fatal"] is True
    assert errs[0]["field"] == "involved_teams"


def test_empty_file_rejected(client, auth_headers, db, refs):
    resp = _import(client, auth_headers, "")
    assert resp.status_code == 400


def test_non_csv_file_rejected(client, auth_headers, db, refs):
    resp = client.post(
        "/api/v1/tasks/import",
        headers=auth_headers,
        files={"file": ("data.xlsx", b"not a csv", "application/octet-stream")},
    )
    assert resp.status_code == 400
