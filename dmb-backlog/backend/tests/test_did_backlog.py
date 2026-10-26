"""Run with --noconftest: no seed, protected tables, or application startup."""
from datetime import date
from io import BytesIO
from types import SimpleNamespace as NS
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from auth import get_current_user
from database import get_db
from models import User, Role, UserReportPreference, Task, Deadline
from routers import did_backlog_router as routes
from services.did_backlog import (COLUMNS, current_quarter, deadline_quarters, clean_prefs,
    task_row, apply_view, summary, value_key, report_quarters)
from services.did_backlog_export import workbook, print_html


def row(id=1, effect=0, **kwargs):
    task = NS(id=id, title="Платежи", financial_effect=effect,
              team=NS(name="Команда"), project=NS(name="Проект"),
              task_type=NS(name="Квартальная/годовая цель"), deadline=NS(name="3Q 2026"),
              did_client_group=NS(name="ЦУП", sort_order=2),
              department=NS(name="Подразделение"), business_customer_rel=NS(name="И. Иванов"))
    task.__dict__.update(kwargs)
    return task_row(task)


def test_quarter_normalization_and_br02():
    assert current_quarter(date(2026, 9, 4)) == "3Q 2026"
    assert deadline_quarters("Q1 2027, 2Q 2027") == {"1Q 2027", "2Q 2027"}
    assert deadline_quarters("Y2026") == {"4Q 2026"}
    assert deadline_quarters("2027") == {"4Q 2027"}
    assert deadline_quarters("Без срока") == set()
    assert deadline_quarters("1Q 20260") == set()
    assert report_quarters("Y2026", "AD-HOC") == set()
    assert report_quarters("Y2026", "Квартальная/годовая цель") == {"4Q 2026"}


def test_gaps_zero_and_missing_title():
    clean = row()
    assert clean["gaps"] == []
    absent = row(2, None, title="(без названия)", did_client_group=None)
    assert set(absent["gaps"]) == {"financial_effect", "title", "did_client_group"}
    assert summary([clean, absent]) == {"empty_values": 3, "tasks_with_gaps": 1}
    assert set(clean) == {key for key, _, _ in COLUMNS} | {"id", "gaps", "group_order"}


def test_reference_fields_follow_business_order_not_alphabet():
    rows = [
        row(1, task_type=NS(name="ТЕХДОЛГ"), deadline=NS(name="4Q 2026")),
        row(2, task_type=NS(name="AD-HOC"), deadline=NS(name="1Q 2026")),
        row(3, task_type=NS(name="КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ"), deadline=NS(name="2Q 2026")),
    ]
    orders = {
        "task_type": {"квартальная/годовая цель": 1, "ad-hoc": 2, "техдолг": 3},
        "deadline": {"1q 2026": 1, "2q 2026": 2, "4q 2026": 4},
    }
    by_type = apply_view(rows, {"sortField": "task_type_name", "sortDir": "asc"}, orders)
    by_deadline = apply_view(rows, {"sortField": "deadline_name", "sortDir": "asc"}, orders)
    assert [item["id"] for item in by_type] == [3, 2, 1]
    assert [item["id"] for item in by_deadline] == [2, 3, 1]


def test_filters_numeric_and_empty_last_both_directions():
    rows = [row(1, None), row(2, 10), row(3, 1000), row(4, 0)]
    assert value_key(1000.0) == "1000"
    assert [r["id"] for r in apply_view(rows, {"filters": {"financial_effect": ["1000"]}})] == [3]
    assert [r["id"] for r in apply_view(rows, {"sortField": "financial_effect", "sortDir": "asc"})] == [4, 2, 3, 1]
    assert [r["id"] for r in apply_view(rows, {"sortField": "financial_effect", "sortDir": "desc"})] == [3, 2, 4, 1]
    assert apply_view(rows, {"filters": {"project_name": ["Другой"]}}) == []


def test_prefs_untrusted_and_default_order():
    prefs = clean_prefs({"sortField": [], "sortDir": {}, "widths": {"title": -5}, "unknown": True, "filters": {"password": ["x"]}})
    assert prefs["sortField"] is None and prefs["filters"] == {}
    assert sum(prefs["widths"].values()) == 100
    assert [r["id"] for r in apply_view([row(2, 500, did_client_group=None), row(1, 0)], {})] == [1, 2]


def test_sql_selection_types_statuses_deleted_and_scope():
    """Evaluate the actual query over literal CTEs; no reference records written."""
    engine = create_engine('sqlite://')
    user = User(id=101, role=Role(backlog_dmb_access='read'))
    with Session(engine) as db:
        query = routes.portfolio_query(db, user).with_entities(Task.id, Deadline.name)
        sql = str(query.statement.compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True}))
        prefix = """WITH
        tasks(id,is_deleted,task_type_id,deadline_id,status_id,team_id,business_customer_id) AS
          (VALUES (1,0,1,1,1,1,NULL),(2,0,2,1,NULL,1,NULL),(3,0,3,1,1,1,NULL),
          (4,0,1,1,2,1,NULL),(5,0,1,1,3,1,NULL),(6,0,1,1,4,1,NULL),
          (7,1,1,1,1,1,NULL),(8,0,1,2,1,1,NULL)),
        task_types(id,name) AS (VALUES (1,'квартальная/годовая цель'),(2,'ad-hoc'),(3,'технический долг')),
        deadlines(id,name) AS (VALUES (1,'3Q 2026'),(2,'Q1 2027, 3Q 2026')),
        statuses(id,name) AS (VALUES (1,'выполнена'),(2,'холд'),(3,'отклонена'),(4,'не актуальна'))
        """
        with engine.connect() as connection:
            connection.connection.create_function('lower_unicode', 1, lambda s: s.lower() if s else s)
            selected = connection.exec_driver_sql(prefix + sql).all()
        assert {r[0] for r in selected if '3Q 2026' in deadline_quarters(r[1])} == {1, 2, 8}
    engine.dispose()


def test_excel_valid_numeric_styles_and_print_escaping():
    rows = [row(1, 1000), row(2, None, title="=HYPERLINK(\"bad\")"), row(3, 0, title="<script>alert(1)</script>")]
    prefs = clean_prefs({})
    with ZipFile(BytesIO(workbook("3Q 2026", rows, prefs["widths"]))) as archive:
        for name in archive.namelist():
            ET.fromstring(archive.read(name))
        xml = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        assert xml.find('.//s:c[@r="I7"]/s:v', ns).text == "1000.0"
        assert xml.find('.//s:c[@r="I8"]', ns).attrib['s'] == '2'
        assert xml.find('.//s:c[@r="D8"]', ns).attrib['t'] == 'inlineStr'
        assert not xml.findall('.//s:f', ns)
    html = print_html("3Q 2026", rows, prefs["widths"])
    assert '<script>' not in html and '&lt;script&gt;' in html
    assert 'A4 landscape' in html and 'table-header-group' in html and 'class="gap"' in html


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    # Only the ordinary preferences table is created. No users or dictionaries.
    UserReportPreference.__table__.create(engine)
    db = Session(engine)
    role = Role(reports_access="read", backlog_dmb_access="read", can_export=True)
    current = {"user": User(id=101, role=role, can_export=True)}
    app = FastAPI()
    app.include_router(routes.router, prefix="/report")
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(routes, 'portfolio_rows', lambda db, user, quarter: [row()])
    with TestClient(app) as client:
        yield client, current, role
    db.close(); engine.dispose()


def test_preferences_isolation_unknown_keys_and_reset(api):
    client, current, role = api
    assert client.put('/report/preferences', json={"quarter": "4Q 2026", "user_id": 999}).status_code == 422
    assert client.put('/report/preferences', json={"quarter": "4Q 2026", "unknown": "x"}).status_code == 200
    assert client.get('/report/preferences').json()['saved'] is True
    current['user'] = User(id=102, role=role, can_export=True)
    assert client.get('/report/preferences').json()['saved'] is False
    assert client.delete('/report/preferences').status_code == 200
    current['user'] = User(id=101, role=role, can_export=True)
    assert client.get('/report/preferences').json()['prefs']['quarter'] == '4Q 2026'
    client.delete('/report/preferences')
    assert client.get('/report/preferences').json()['saved'] is False


def test_permissions_invalid_quarter_and_export_view(api):
    client, current, role = api
    assert client.get('/report?quarter=Y2026').status_code == 422
    assert client.get('/report?quarter=3Q%202026').json()['total_tasks'] == 1
    body = {"quarter": "3Q 2026", "ordered_ids": [1]}
    assert client.post('/report/export/xlsx', json=body).status_code == 200
    assert client.post('/report/export/xlsx', json={**body, "ordered_ids": [999]}).status_code == 409
    assert client.post('/report/export/xlsx', json={**body, "ordered_ids": []}).status_code == 409
    assert client.post('/report/export/pdf', json={**body, "filters": {"title": ["Нет"]}, "ordered_ids": []}).status_code == 200
    current['user'].can_export = False
    assert client.post('/report/export/xlsx', json=body).status_code == 403
    role.reports_access = 'none'
    assert client.get('/report').status_code == 403
    assert client.get('/report/preferences').status_code == 403


def test_import_missing_group_and_ambiguous_contact_do_not_create_references(monkeypatch):
    import import_service
    monkeypatch.setattr(import_service, '_build_task', lambda db, data, links, user: data)
    mapping = {key: key for key in ('title', 'did_client_group_id', 'business_customer_id', 'department_id')}
    refs = {'did_client_groups': {'цуп': 3}, 'business_customers': {'и. иванов': 4},
            'contacts_by_name': {'и. иванов': [(4, 1), (5, 2)]}, 'departments': {'цр': 2}}
    task, errors = import_service.process_row(1, {'title': 'Задача', 'did_client_group_id': 'Неизвестный',
        'business_customer_id': 'И. Иванов'}, mapping, {}, refs, {'title'}, None, 101)
    assert task['did_client_group_id'] is None and task['business_customer_id'] is None
    assert len(errors) == 2 and not any(e['fatal'] for e in errors)
    task, errors = import_service.process_row(1, {'title': 'Задача', 'business_customer_id': 'И. Иванов',
        'department_id': 'ЦР'}, mapping, {}, refs, {'title'}, None, 101)
    assert task['business_customer_id'] == 5 and errors == []
