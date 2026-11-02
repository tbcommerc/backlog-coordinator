"""Pure decisions and isolated ordinary records only; no protected tables/data."""
from types import SimpleNamespace as NS
from datetime import timedelta
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from models import RequirementRequest, WorkResolution, RequestWorkLink, Notification, EventOutbox, User
from services import request_lifecycle as lifecycle
from services.request_state import lifecycle_actions, today
from routers import agent_router


def actor(id=1, reviewer=True):
    return NS(id=id, name='Test actor', reviewer=reviewer, is_active=True, role_name='', role=NS(customer_portal_only=not reviewer))


@pytest.fixture
def context(monkeypatch):
    engine=create_engine('sqlite://')
    for model in (RequirementRequest, WorkResolution, RequestWorkLink, Notification, EventOutbox): model.__table__.create(engine)
    monkeypatch.setattr(agent_router,'can_review_request',lambda user, team: user.reviewer)
    monkeypatch.setattr(lifecycle,'effective_state',lambda db,req:req.status)
    with Session(engine) as db:
        original=db.get
        monkeypatch.setattr(db,'get',lambda cls,id,*a,**kw:actor(id) if cls is User else original(cls,id,*a,**kw))
        req=RequirementRequest(title='Test request',user_id=2,team_id=10,status='in_review',reviewer_id=1,version=0,
            draft={},revision_history=[],status_history=[],is_deleted=False)
        db.add(req);db.commit()
        yield db,req
    engine.dispose()


def command(req,action,**kw):
    return lifecycle.LifecycleCommand(action=action,version=req.version,reason='Business reason',**kw)


def test_reconsider_preserves_identity_history_and_notifies(context):
    db,req=context; req.status='rejected';req.reject_reason='Old decision';db.commit();identifier=req.id
    lifecycle.execute(db,actor(),req.id,command(req,'reconsider'))
    assert req.id==identifier and req.status=='submitted' and req.reject_reason=='Old decision'
    assert req.status_history[-1]['metadata']['previous_status']=='rejected'
    assert req.next_action_due==today() and req.coordinator_id==1
    assert db.query(Notification).filter_by(type='request.review.reconsider').count()==1


def test_accept_defer_reconsider(context):
    db,req=context
    values=dict(coordinator_id=1,next_action='Discuss priority',next_action_due=today()+timedelta(days=1))
    lifecycle.execute(db,actor(),req.id,command(req,'accept',**values))
    assert req.status=='accepted' and req.task_id is None
    lifecycle.execute(db,actor(),req.id,command(req,'defer',**values))
    assert req.status=='deferred'
    lifecycle.execute(db,actor(),req.id,command(req,'reconsider'))
    assert req.status=='submitted' and len(req.status_history)>=3


@pytest.mark.parametrize('values',[{},dict(next_action=' ',next_action_due=today()),dict(next_action='Review',next_action_due=today()-timedelta(days=1))])
def test_planning_requires_action_and_valid_date(context,values):
    db,req=context
    with pytest.raises(HTTPException) as exc:lifecycle.execute(db,actor(),req.id,command(req,'accept',**values))
    assert exc.value.status_code==422 and req.status=='in_review'


def test_owner_withdraws_without_hiding_and_cannot_reconsider(context):
    db,req=context;owner=actor(2,False)
    lifecycle.execute(db,owner,req.id,command(req,'withdraw'))
    assert req.status=='withdrawn' and not req.is_deleted
    with pytest.raises(HTTPException):lifecycle.execute(db,owner,req.id,command(req,'reconsider'))
    lifecycle.execute(db,actor(),req.id,command(req,'reconsider'))
    assert req.status=='submitted'


def test_foreign_owner_stale_version_and_claim_protection(context):
    db,req=context
    with pytest.raises(HTTPException) as exc:lifecycle.execute(db,actor(3,False),req.id,command(req,'withdraw'))
    assert exc.value.status_code==404
    stale=command(req,'withdraw');req.version+=1;db.commit()
    with pytest.raises(HTTPException) as exc:lifecycle.execute(db,actor(2,False),req.id,stale)
    assert exc.value.status_code==409
    req.reviewer_id=7
    assert 'accept' not in lifecycle_actions(req,actor(),True)


def test_linked_withdrawal_reuses_resolution_on_reconsider(context):
    db,req=context;req.status='in_progress'
    db.add(WorkResolution(request_id=req.id,review_decision='link_work',decided_by=1,coverage='full',fulfillment='not_started'));db.commit()
    lifecycle.execute(db,actor(2,False),req.id,command(req,'withdraw'))
    lifecycle.execute(db,actor(),req.id,command(req,'reconsider'))
    assert req.status=='in_progress' and db.query(WorkResolution).count()==1
    assert db.query(WorkResolution).one().fulfillment=='needs_verification'


def test_read_only_customer_actions():
    req=NS(status='rejected',user_id=2,reviewer_id=1)
    assert lifecycle_actions(req,actor(2,False),False)==[]
    assert lifecycle_actions(req,actor(),True)==['reconsider']


def test_work_change_notifies_without_mutating_request_or_decision(context):
    from services.request_followup import work_changed
    db,req=context;req.status='in_progress';req.coordinator_id=1
    decision=WorkResolution(request_id=req.id,review_decision='link_work',decided_by=1,coverage='full',fulfillment='fulfilled',confirmed_work_revisions={'5':1})
    db.add(decision)
    db.add(RequestWorkLink(request_id=req.id,work_task_id=5,scope_text='Full',coverage='full',request_revision=1,requirement_snapshot={},created_by=1,is_active=True));db.commit()
    version=req.version
    work_changed(db,NS(id=5,status='in_progress',version=3,result_revision=2),actor(3),{'status':'done','result_revision':1})
    db.flush()
    assert req.version==version and decision.fulfillment=='fulfilled'
    assert db.query(Notification).filter_by(type='request.needs_verification').count()==2
