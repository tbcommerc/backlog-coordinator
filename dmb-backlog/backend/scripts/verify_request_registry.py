"""PostgreSQL integration proof. Only ordinary records inside an outer rollback.

Run from backend: python -B scripts/verify_request_registry.py
Existing users, roles, teams and dictionaries are read only. No login secrets.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from database import engine
from models import User, RequirementRequest as R, WorkTask, WorkResolution, RequestWorkLink, Notification
from auth import get_request_review_access
from services.request_registry import registry
from services.request_state import state_expression, today
from services.request_lifecycle import execute, LifecycleCommand
from routers.work_resolution_router import confirm_fulfillment, FulfillmentDecision
from services.customer_queue import queue_page

assert engine.dialect.name=='postgresql','This proof requires PostgreSQL'
marker='qa-request-registry-'+uuid4().hex
with engine.connect() as conn:
    transaction=conn.begin()
    db=Session(bind=conn,join_transaction_mode='create_savepoint',expire_on_commit=False)
    try:
        users=db.query(User).filter(User.is_active.is_(True)).all()
        reviewer=next(u for u in users if get_request_review_access(u)=='all' and u.team_id)
        owner=next(u for u in users if u.id!=reviewer.id)
        rows=[R(title=f'{marker}-{i}',user_id=owner.id,team_id=reviewer.team_id,status='rejected',version=0,is_deleted=False,
                draft={},revision_history=[],status_history=[],created_at=datetime.now(timezone.utc)-timedelta(days=i)) for i in range(260)]
        db.add_all(rows);db.flush()
        result=registry(db,reviewer,q=marker,limit=25)
        assert result['total']==260 and len(result['items'])==25 and result['counts']['all']==260
        assert registry(db,reviewer,q=marker+'-259',limit=25)['total']==1
        assert registry(db,reviewer,q=marker,mode='history',status='rejected')['total']==260
        req=rows[-1]
        execute(db,reviewer,req.id,LifecycleCommand(action='reconsider',version=req.version,reason='Changed priority'))
        req.status='in_review';req.reviewer_id=reviewer.id;db.flush()
        execute(db,reviewer,req.id,LifecycleCommand(action='accept',version=req.version,reason='Accepted demand',coordinator_id=reviewer.id,next_action='Plan delivery',next_action_due=today()))
        assert registry(db,reviewer,q=marker+'-259',status='accepted')['total']==1
        assert registry(db,reviewer,q=marker+'-259',mode='due')['total']==1
        task=WorkTask(title=marker,description='Expected result',execution_team_id=reviewer.team_id,work_direction='product',
            requester_id=reviewer.id,requester_team_id=reviewer.team_id,created_by=reviewer.id,acceptor_id=reviewer.id,
            acceptance_required=True,status='done',assignment_state='accepted',version=1,result_revision=1,result_text='Accepted result',is_deleted=False)
        db.add(task);db.flush()
        req.status='in_progress'
        db.add(WorkResolution(request_id=req.id,review_decision='link_work',decided_by=reviewer.id,coverage='full',fulfillment='not_started'))
        db.add(RequestWorkLink(request_id=req.id,work_task_id=task.id,scope_text='Full demand',coverage='full',request_revision=1,requirement_snapshot={},created_by=reviewer.id,is_active=True));db.flush()
        def state():return db.scalar(select(state_expression()).where(R.id==req.id))
        assert state()=='awaiting_confirmation'
        confirm_fulfillment(req.id,FulfillmentDecision(version=req.version,coverage='full',fulfillment='fulfilled',result_text='Demand fulfilled'),db,reviewer)
        assert state()=='fulfilled'
        assert registry(db,reviewer,q=marker+'-259',mode='history')['items'][0]['effective_status']=='fulfilled'
        assert queue_page(db,owner,[],q=marker+'-259',group='complete').total==1
        task.result_revision+=1;db.flush()
        assert state()=='needs_verification'
        assert registry(db,reviewer,q=marker+'-259',mode='verification')['total']==1
        assert queue_page(db,owner,[],q=marker+'-259',group='work').total==1
        assert db.query(Notification).filter(Notification.action_url==f'#/customer/request/{req.id}').count()>=3
        print('PASS: global search beyond 250, history, reconsideration, planning, due queue, confirmation, customer parity, changed-result verification, notifications')
    finally:
        db.close()
        transaction.rollback()
print('All synthetic ordinary records rolled back; protected data unchanged')
