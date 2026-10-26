"""Ephemeral work tables only. No protected table is created or populated."""
import os
os.environ.update(DATABASE_URL="sqlite:///:memory:", RUN_STARTUP_SEED="false",
                  RUN_STARTUP_MAINTENANCE="false", RUN_NOTIFICATION_SCHEDULER="false")
import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from models import Task, RequirementRequest, Notification, EventOutbox
from services import customer_result as result

@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://")
    for model in (Task, RequirementRequest, Notification, EventOutbox):
        model.__table__.create(engine)
    monkeypatch.setattr(result, "task_status_name", lambda session, task:
        {1: "ВЫПОЛНЕНА", 2: "НЕ АКТУАЛЬНА", 3: "ОТКЛОНЕНА", 4: "ХОЛД"}.get(task.status_id))
    with Session(engine) as session:
        session.execute(Task.__table__.insert().values(id=1, team_id=1, title="Synthetic", version=0))
        session.execute(RequirementRequest.__table__.insert().values(
            id=1, task_id=1, user_id=7, title="Synthetic", status="in_progress", version=0,
            status_history=[{"status": "in_progress"}]))
        session.commit()
        yield session
    engine.dispose()

@pytest.mark.parametrize("status,outcome", [(1,"completed"),(2,"not_relevant"),(3,"task_rejected")])
def test_terminal_atomic_and_replay(db,status,outcome):
    task=db.get(Task,1); req=db.get(RequirementRequest,1)
    task.status_id=status
    db.commit()
    assert req.status==outcome and req.version==1 and len(req.status_history)==2
    note=db.scalars(select(Notification)).one()
    assert note.user_id==7 and note.task_id is None and note.action_url=="#/customer/request/1"
    assert note.type==f"request.task.{outcome}"
    note.is_read=True; note.is_dismissed=True; db.commit()
    before=db.query(EventOutbox).count()
    task.status_id=status; task.title="Another edit"; db.commit()
    assert req.version==1 and len(req.status_history)==2
    assert db.query(Notification).count()==1 and note.is_read and note.is_dismissed and note.group_count==1
    assert db.query(EventOutbox).count()==before+1 # task event only
    assert db.query(EventOutbox).filter_by(event_type="requirement.updated").count()==1
    assert db.query(EventOutbox).filter_by(event_type="notification.created").count()==1


def test_reopen_recomplete_delete_restore(db):
    task=db.get(Task,1); req=db.get(RequirementRequest,1)
    for status in [1,4,1,2,3]:
        task.status_id=status; db.commit()
    assert req.version==5 and req.status=="task_rejected"
    task.is_deleted=True; db.commit()
    assert req.status=="task_deleted"
    task.is_deleted=False; db.commit()
    assert req.status=="task_rejected" and req.version==7
    assert db.query(Notification).count()==7
    assert len({n.group_key for n in db.query(Notification)})==7

@pytest.mark.parametrize("state", ["rejected","returned","in_review","submitted","approved"])
def test_review_decisions_untouched(db,state):
    req=db.get(RequirementRequest,1);req.status=state;db.commit()
    db.get(Task,1).status_id=1;db.commit()
    assert req.status==state and req.version==0 and db.query(Notification).count()==0


def test_deleted_request_and_progress_are_not_completion(db):
    req=db.get(RequirementRequest,1);task=db.get(Task,1)
    task.progress=100; db.commit()
    assert req.status=="in_progress" and req.version==0
    req.is_deleted=True; db.commit()
    task.status_id=1;db.commit()
    assert req.status=="in_progress" and db.query(Notification).count()==0


def test_rollback_is_atomic(db):
    task=db.get(Task,1);task.status_id=1;db.flush()
    assert db.query(Notification).count()==1
    db.rollback()
    assert db.get(Task,1).status_id is None
    assert db.get(RequirementRequest,1).status=="in_progress"
    assert db.query(Notification).count()==db.query(EventOutbox).count()==0


def test_stale_request_rolls_back_task_and_notifications(db):
    req=db.get(RequirementRequest,1)
    db.execute(update(RequirementRequest).where(RequirementRequest.id==1).values(version=1),
               execution_options={"synchronize_session":False})
    db.get(Task,1).status_id=1
    with pytest.raises(StaleDataError): db.commit()
    db.rollback()
    assert db.get(Task,1).status_id is None
    assert db.query(Notification).count()==db.query(EventOutbox).count()==0


def test_link_existing_terminal_task(db):
    req=db.get(RequirementRequest,1);req.task_id=None;db.commit()
    db.get(Task,1).status_id=1;db.commit()
    req.task_id=1;db.commit()
    assert req.status=="completed" and db.query(Notification).count()==1
