"""No DB connection, no fixtures creating users/dictionaries: parsing and SQL only."""
import sys
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import HTTPException, FastAPI
from sqlalchemy import true
from sqlalchemy.orm import Session
from sqlalchemy.dialects import postgresql
from services.filter_values import filter_values
from services import work_query


@pytest.mark.parametrize('value,expected',[(None,[]),('',[]),('7',[7]),('[7,8,7]',[7,8])])
def test_numeric_values(value,expected):
    assert filter_values(value,numeric=True)==expected


@pytest.mark.parametrize('value',['[0,2]','[-1]','[true]','[null]','[[1]]','["no"]','[]','[1,','[1.5]'])
def test_invalid_numeric_values(value):
    with pytest.raises(HTTPException) as error:filter_values(value,numeric=True)
    assert error.value.status_code==422


def test_names_keep_commas_and_unicode():
    assert filter_values('["Команда, А","Команда Б"]')==['Команда, А','Команда Б']


def test_work_selection_or_and_counts_share_query(monkeypatch):
    monkeypatch.setattr(work_query.work,'read_scope',lambda user:true())
    filters=work_query.Filters(view='all',status='["ready","done"]',execution_team_id='[2,3]',
        assignee_id='[7,8]',priority='["high","urgent"]',work_direction='["product","organizational"]')
    with Session() as db:
        selection=work_query.Selection(db,SimpleNamespace(id=1,team_id=2),filters)
        compiled=selection.query.statement.compile(dialect=postgresql.dialect())
        values=list(compiled.params.values())
        assert [2,3] in values and [7,8] in values
        assert ['high','urgent'] in values
        assert {'ready','done'} in [set(value) for value in values if isinstance(value,list)]
        assert selection.included('done') and not selection.included('cancelled')
        assert ' AND ' in str(compiled) and ' IN ' in str(compiled)


def test_work_status_alias_union(monkeypatch):
    monkeypatch.setattr(work_query.work,'read_scope',lambda user:true())
    with Session() as db:
        selection=work_query.Selection(db,SimpleNamespace(id=1,team_id=2),work_query.Filters(status='["active","done"]'))
        assert all(selection.included(status) for status in ['new','ready','in_progress','in_acceptance','done'])
        assert not selection.included('cancelled')


def test_invalid_enum_values_rejected():
    with pytest.raises(HTTPException):work_query.Filters(priority='["urgent","invented"]')


def test_work_api_dependency_schema_still_builds():
    from routers.work_tasks_router import router
    app=FastAPI();app.include_router(router)
    assert '/work-tasks' in app.openapi()['paths']


def capture_queries(monkeypatch):
    from sqlalchemy.orm import Query
    captured=[]
    def all_rows(query):
        captured.append(query.statement.compile(dialect=postgresql.dialect()))
        return []
    monkeypatch.setattr(Query,'all',all_rows)
    monkeypatch.setattr(Query,'count',lambda query:0)
    return captured


def test_metric_api_uses_every_selected_value(monkeypatch):
    from routers import metrics_router
    captured=capture_queries(monkeypatch)
    monkeypatch.setattr(metrics_router,'task_read_scope_clause',lambda *args:true())
    with Session() as db:
        result=metrics_router.listing(period='2026-10-01|2026-12-31',q='',team_id='[1,2]',
            owner_id='[3,4]',project_id='[5,6]',state='["draft","active"]',scope='all',
            attention='["active","missing"]',archived=False,sort='title',page=1,per_page=25,
            db=db,user=SimpleNamespace(id=1))
    assert result['total']==0
    values=list(captured[0].params.values())
    assert [1,2] in values and [3,4] in values and [5,6] in values
    assert ['draft','active'] in values


def test_audit_api_uses_every_selected_value(monkeypatch):
    from routers.admin_router import get_audit_log
    captured=capture_queries(monkeypatch)
    with Session() as db:
        get_audit_log(page=1,per_page=20,user_id='[1,2]',action='["create","update"]',
            entity_type='["task","project"]',date_from=None,date_to=None,search=None,db=db,
            current_user=SimpleNamespace(id=1))
    values=list(captured[0].params.values())
    assert [1,2] in values and ['create','update'] in values and ['task','project'] in values


def test_notification_union_keeps_user_boundary(monkeypatch):
    import notifications
    from models import Notification
    captured=capture_queries(monkeypatch)
    monkeypatch.setattr(notifications,'_visible_notifications_query',lambda db,user_id,user:db.query(Notification).filter(Notification.user_id==user_id))
    with Session() as db:
        notifications.get_notifications(db,77,category='["task","request"]',importance='["high","critical"]',views='["unread","resolved"]')
    compiled=captured[0]
    values=list(compiled.params.values())
    assert 77 in values and ['task','request'] in values and ['high','critical'] in values
    assert ' OR ' in str(compiled) and 'user_id =' in str(compiled)
