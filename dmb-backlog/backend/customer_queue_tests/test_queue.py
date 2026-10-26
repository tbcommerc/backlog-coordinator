"""Read-only API tests against ephemeral work rows; protected tables never created."""
import os
os.environ.update(DATABASE_URL="sqlite:///:memory:", RUN_STARTUP_SEED="false",
    RUN_STARTUP_MAINTENANCE="false", RUN_NOTIFICATION_SCHEDULER="false")
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import patch
import pytest
from sqlalchemy import create_engine, select, literal, Integer, String, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import customer_queue as queue
from models import Task, RequirementRequest, Notification
from routers.customer_router import router
from auth import get_current_user
from database import get_db

USER = NS(id=7, business_customer_id=9)
NOW = datetime(2026, 10, 17, 10, tzinfo=timezone.utc)
DRAFTS = [dict(session_id="one", title="Черновик поиск", has_draft=True, active=True, updated_at=NOW.isoformat()),
          dict(session_id="two", title="Второй черновик", phase="draft_ready", updated_at=NOW.isoformat()),
          dict(session_id="sent", title="Already sent", has_draft=True, request_id=11),
          dict(session_id="archived", has_draft=True, archived=True)]

@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    @event.listens_for(engine, "connect")
    def unicode_lower(connection, _):
        connection.create_function("lower", 1, lambda v: v.lower() if isinstance(v, str) else v)
    # Lookup relations are SELECT doubles, not tables or inserted reference/user records.
    for name, value in [("Team", "Команда"), ("User", "Ревьюер"), ("TaskStatus", "ВЫПОЛНЕНА"), ("Deadline", "2026-12-01")]:
        table = select(literal(1, Integer).label("id"), literal(value, String).label("name")).subquery(name.lower())
        monkeypatch.setattr(queue, name, NS(__table__=table))
    Notification.__table__.create(engine)
    Task.__table__.create(engine)
    RequirementRequest.__table__.create(engine)
    with Session(engine) as session:
        for i in range(1, 254):
            session.execute(Task.__table__.insert().values(id=i, title="СВЕРКА 100%_\\" if i==251 else f"Task {i}",
                team_id=1, public_id=f"TASK-{i:06d}", business_customer_id=10 if i==252 else 9,
                is_deleted=i==253, created_at=NOW, updated_at=NOW, status_id=1 if i==201 else None))
        for i, user, task in [(11,7,1),(12,7,None),(13,8,2)]:
            session.execute(RequirementRequest.__table__.insert().values(id=i,user_id=user,task_id=task,
                title=f"Request {i}", status="submitted", created_at=NOW,updated_at=NOW,is_deleted=False))
        session.commit()
        yield session
    engine.dispose()


def test_all_pages_and_stable_ties(db):
    first=queue.queue_page(db,USER,DRAFTS,per_page=25)
    assert first.total==254 and first.pages==11 and first.counts["all"]==254
    items=[]
    for page in range(1,12):items+=queue.queue_page(db,USER,DRAFTS,page=page).items
    assert len({(x.kind,x.id) for x in items})==254
    assert any(x.task_id==251 for x in items)
    assert not any(x.kind=="task" and x.task_id in [1,252,253] for x in items)
    assert not any(x.kind=="request" and x.id=="13" for x in items)
    again=queue.queue_page(db,USER,DRAFTS).items
    assert [(x.kind,x.id) for x in again]==[(x.kind,x.id) for x in first.items]
    oldest=queue.queue_page(db,USER,DRAFTS,sort="oldest",per_page=100).items
    assert [(x.kind,x.id) for x in oldest]==[(x.kind,x.id) for x in reversed(items)][0:100]


def test_search_filters_before_pagination_and_escapes_literals(db):
    for query in ["сверка", "100%_", "TASK-000251"]:
        result=queue.queue_page(db,USER,DRAFTS,q=query,page=99)
        assert result.total==1 and result.page==1 and result.items[0].task_id==251
    assert queue.queue_page(db,USER,DRAFTS,q="%_").total==1
    assert queue.queue_page(db,USER,DRAFTS,q="not present").total==0
    result=queue.queue_page(db,USER,DRAFTS,q="ПОИСК",group="draft")
    assert result.total==1 and result.items[0].session_id=="one"
    assert result.counts["all"]==254 and result.preferred_draft.session_id=="one"
    assert queue.queue_page(db,USER,DRAFTS,group="complete").items[0].task_id==201
    assert queue.queue_page(db,USER,DRAFTS,q="Task 1",group="draft").total==0


def test_dedup_before_search_and_no_customer_binding(db):
    assert queue.queue_page(db,USER,[],q="Task 1").items[0].id != "task-1"
    result=queue.queue_page(db,NS(id=7,business_customer_id=None),[])
    assert result.total==2 and all(x.kind=="request" for x in result.items)
    assert queue.queue_page(db,NS(id=99,business_customer_id=None),[]).total==0


def test_typed_dates_and_safe_projection(db):
    result=queue.queue_page(db,USER,DRAFTS)
    assert all(x.updated_at.tzinfo is not None for x in result.items)
    fields=set(result.items[0].model_dump())
    assert not fields & {"financial_effect","password_hash","draft","lock_owner_id","business_customer_id"}


def test_http_auth_validation_and_partial_drafts(db):
    app=FastAPI();app.include_router(router,prefix="/customer")
    app.dependency_overrides[get_db]=lambda: db
    client=TestClient(app)
    assert client.get("/customer/queue").status_code==401
    app.dependency_overrides[get_current_user]=lambda: USER
    from fastapi import HTTPException
    with patch("routers.agent_router.agent_sessions",side_effect=HTTPException(503,"offline")):
        response=client.get("/customer/queue",params={"q":"сверка","page":2})
        assert response.status_code==200
        data=response.json();assert data["total"]==1 and data["page"]==1 and data["warnings"]
    for params in [{"page":0},{"per_page":101},{"group":"unknown"},{"sort":"bad"},{"q":"a"*201}]:
        assert client.get("/customer/queue",params=params).status_code==422
    with patch("routers.agent_router.agent_sessions",return_value={"sessions":DRAFTS}) as sessions:
        data=client.get("/customer/queue",params={"group":"draft"}).json()
        assert data["total"]==2 and data["warnings"]==[]
        assert sessions.call_args.kwargs["current_user"] is USER


def test_queue_executes_only_select_and_handles_missing_dates(db):
    # Modify only an ephemeral ordinary task, never a protected table.
    db.execute(Task.__table__.update().where(Task.id==251).values(created_at=None,updated_at=None))
    statements=[]
    def observe(conn,cursor,statement,parameters,context,many): statements.append(statement)
    event.listen(db.bind,"before_cursor_execute",observe)
    try:
        result=queue.queue_page(db,USER,DRAFTS,q="сверка",sort="oldest")
    finally:
        event.remove(db.bind,"before_cursor_execute",observe)
    assert result.items[0].created_at is None and result.items[0].updated_at is None
    assert statements and all(s.lstrip().upper().startswith("SELECT") for s in statements)


def test_production_projection_compiles_for_postgres():
    from sqlalchemy.dialects import postgresql
    sql=str(select(queue.projection(USER)).compile(dialect=postgresql.dialect()))
    assert "UNION ALL" in sql and "NOT (EXISTS" in sql
    assert "requirement_requests.user_id" in sql and "tasks.business_customer_id" in sql
    assert "financial_effect" not in sql and "password_hash" not in sql


def test_display_public_number_search_without_stored_id(db):
    db.execute(Task.__table__.update().where(Task.id==251).values(public_id=None))
    result=queue.queue_page(db,USER,[],q="task-000-251")
    assert result.total==1 and result.items[0].task_id==251
    assert queue.queue_page(db,USER,[],q="TASK-000-252").total==0


def test_customer_events_persist_read_state_scope_and_new_arrivals(db):
    from models import EventOutbox
    from notifications import mark_read
    from services.customer_events import request_events
    from routers.customer_router import get_customer_request_events
    from fastapi import HTTPException
    EventOutbox.__table__.create(db.bind)
    for i, user, url, dismissed in [(1,7,11,False),(2,8,11,False),(3,7,12,False),(4,7,11,True)]:
        db.execute(Notification.__table__.insert().values(id=i,user_id=user,category="request",
            action_url=f"#/customer/request/{url}",type="request.review.returned",title="Новое замечание",
            message="Synthetic",is_read=False,is_dismissed=dismissed))
    db.commit()
    assert request_events(db,7,11)["total"]==1
    assert get_customer_request_events(11,db,USER)["items"][0]["id"]==1
    with pytest.raises(HTTPException) as forbidden: get_customer_request_events(13,db,USER)
    assert forbidden.value.status_code==404
    page=queue.queue_page(db,USER,[],q="Request 11")
    assert next(i for i in page.items if i.id=="11").unread_event_count==1
    mark_read(db,[1,2],7);db.commit();db.expire_all()
    assert request_events(db,7,11)["total"]==0
    assert request_events(db,8,11)["total"]==1
    assert request_events(db,7,12)["total"]==1
    assert next(i for i in queue.queue_page(db,USER,[],q="Request 11").items if i.id=="11").unread_event_count==0
    db.execute(Notification.__table__.insert().values(id=5,user_id=7,category="request",
        action_url="#/customer/request/11",type="request.task.completed",title="Есть результат",message="Synthetic"))
    db.commit()
    # Replaying acknowledgement of old IDs must not read a newly arrived event.
    assert mark_read(db,[1],7)["changed_ids"]==[]
    db.commit();db.expire_all()
    assert [n["id"] for n in request_events(db,7,11)["items"]]==[5]


def test_customer_scope_personal_requests_and_shared_tasks_http(db):
    from importlib import import_module
    api = import_module("routers.customer_router")
    from schemas import CustomerTaskResponse
    app=FastAPI();app.include_router(router,prefix="/customer")
    app.dependency_overrides[get_db]=lambda:db
    client=TestClient(app)
    assert client.get("/customer/tasks/2").status_code==401
    actor=NS(id=7,business_customer_id=9)
    app.dependency_overrides[get_current_user]=lambda:actor
    # Replace protected lookup rendering only; execute real task/request ACL queries.
    def project(task):
        return CustomerTaskResponse(id=task.id,public_id=f"TASK-{task.id//1000:03d}-{task.id%1000:03d}",
            title=task.title,description=task.description,progress=task.progress or 0,
            created_at=task.created_at,updated_at=task.updated_at)
    with patch.object(api,"_task_to_customer_response",side_effect=project), patch(
            "routers.agent_router.agent_sessions",return_value={"sessions":[]}):
        data=client.get("/customer/queue",params={"q":"Request"}).json()
        assert {i["id"] for i in data["items"]}=={"11","12"} # never another author's request
        assert client.get("/customer/tasks/2").status_code==200 # shared task linked to another author's request
        for identifier in [252,253,999]:
            assert client.get(f"/customer/tasks/{identifier}").status_code==404
        actor=NS(id=8,business_customer_id=9)
        data=client.get("/customer/queue",params={"q":"Request"}).json()
        assert {i["id"] for i in data["items"]}=={"13"}
        assert client.get("/customer/requests/11/events").status_code==404
        actor=NS(id=7,business_customer_id=None)
        assert client.get("/customer/tasks").json()["total"]==0
        data=client.get("/customer/queue").json()
        assert {i["id"] for i in data["items"]}=={"11","12"}
        assert client.get("/customer/tasks/1").status_code==200 # own request retains linked-task access
        assert client.get("/customer/tasks/2").status_code==404
        actor=NS(id=7,business_customer_id=10)
        assert client.get("/customer/tasks/252").status_code==200
        assert client.get("/customer/tasks/2").status_code==404
        assert client.get("/customer/tasks/1").status_code==200
        data=client.get("/customer/queue").json()
        assert {(i["kind"],i["id"]) for i in data["items"]}=={("request","11"),("request","12"),("task","task-252")}
