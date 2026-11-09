"""Opt-in PostgreSQL integration checks. Uses existing identities; all work writes roll back."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import date
from uuid import uuid4
from copy import deepcopy
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from fastapi import HTTPException
from database import engine
from models import User, WorkTask, RequirementRequest, ReportingMeeting, WorkMeetingSnapshot, Task
from auth import is_customer_portal_only
from services import work_tasks as work
from services.work_reporting import capture, report
from routers.agent_router import can_review_request
from routers.work_resolution_router import split_request, SplitResolution, Resolution, confirm_fulfillment, FulfillmentDecision, fulfillment
from routers.work_tasks_router import transition
from work_contract import WorkCreate, Transition, WorkUpdate


def run():
    assert engine.dialect.name == 'postgresql', 'PostgreSQL required'
    token = 'work-pg-' + uuid4().hex
    checks = []
    with engine.connect() as conn:
        outer = conn.begin()
        db = Session(bind=conn, join_transaction_mode='create_savepoint', expire_on_commit=False)
        try:
            user = next((u for u in db.query(User).filter(User.is_active.is_(True)).all()
                if u.team_id and work.editor(u, u.team_id) and can_review_request(u, u.team_id)), None)
            assert user, 'An existing active team editor/reviewer is required'
            # Prove no existing Task columns change during the complete scenario.
            before = conn.execute(text("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) FROM tasks t")).scalar()
            rows=[]
            for i in range(2):
                rows.append(work.create(db, user, WorkCreate(title=token+str(i),description='Expected result',
                    work_direction='organizational',execution_team_id=user.team_id,assignee_id=user.id,
                    acceptor_id=user.id,acceptance_required=True,due_date=date.today())))
            db.commit()
            req=RequirementRequest(title=token,description='Two parts',user_id=user.id,team_id=user.team_id,
                reviewer_id=user.id,status='in_review',version=0,is_deleted=False,revision_history=[],status_history=[],draft={})
            db.add(req);db.commit()
            command=SplitResolution(version=0,reason='Two independent deliverables',parts=[Resolution(version=0,
                decision='link_work',target_id=r.id,scope_text=f'Part {i}',coverage='partial') for i,r in enumerate(rows)])
            result=split_request(req.id,command,token,db,user)
            assert len(result['works'])==2 and result['legacy_supported'] is False
            assert split_request(req.id,command,token,db,user)==result
            checks.append('atomic split, idempotency and legacy projection')
            for row in rows:
                for status in ('ready','in_progress','in_acceptance','done'):
                    transition(row.id,Transition(version=row.version,status=status,result_text='Accepted evidence'),db,user)
            result=confirm_fulfillment(req.id,FulfillmentDecision(version=req.version,coverage='full',fulfillment='fulfilled',result_text='Both accepted'),db,user)
            assert result['fulfillment']=='fulfilled'
            checks.append('execution, acceptance and full coverage')
            meeting=ReportingMeeting(kind='team_weekly',occurrence_key=token,scheduled_date=date.today(),state='planned',version=0)
            db.add(meeting);db.commit()
            # Exercise the real completion hook (the earliest open weekly instance).
            from reporting_meetings import complete_meeting
            meeting.scheduled_date=date(1900,1,1);db.flush()
            complete_meeting(db,meeting,user_id=user.id,submitted_version=0);db.commit()
            snapshot=db.get(WorkMeetingSnapshot,meeting.id)
            assert snapshot and meeting.state=='held'
            checks.append('meeting completion captures work in the same transaction')
            original=deepcopy(snapshot.payload)
            old_version=rows[0].version
            transition(rows[0].id,Transition(version=old_version,status='ready',reason='Verification failed'),db,user)
            assert fulfillment(db,req,user)['fulfillment']=='needs_verification'
            assert capture(db,meeting).payload==original
            saved=report(db,user,meeting.id)
            assert next(x for x in saved['items'] if x['id']==rows[0].id)['status']=='done'
            assert next(x for x in report(db,user)['items'] if x['id']==rows[0].id)['status']=='ready'
            checks.append('immutable snapshot versus live aggregate and reopened result')
            try:
                with db.begin_nested():
                    db.execute(text('UPDATE work_meeting_snapshots SET schema_version=2 WHERE meeting_id=:id'),{'id':meeting.id})
            except DBAPIError: pass
            else: raise AssertionError('snapshot update allowed')
            try:
                with db.begin_nested():
                    db.execute(text('DELETE FROM work_meeting_snapshots WHERE meeting_id=:id'),{'id':meeting.id})
            except DBAPIError: pass
            else: raise AssertionError('snapshot delete allowed')
            checks.append('PostgreSQL snapshot UPDATE/DELETE guards')
            try: work.update(db,rows[0],user,WorkUpdate(version=old_version,description='stale'))
            except HTTPException as exc: assert exc.status_code==409
            else: raise AssertionError('stale update accepted')
            checks.append('optimistic work version conflict')
            outsider=next((u for u in db.query(User).filter(User.is_active.is_(True)).all()
                if not is_customer_portal_only(u) and u.id!=user.id and u.team_id!=user.team_id
                and not work.get_task_action_scope(u,'edit')=='all' and not work.check_permission(u,'backlog_dmb','read')),None)
            assert outsider, 'An existing restricted user in another team is required'
            assert not {r.id for r in rows} & {x['id'] for x in report(db,outsider,meeting.id)['items']}
            checks.append('snapshot object ACL and counts')
            after=conn.execute(text("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) FROM tasks t")).scalar()
            assert before==after
            checks.append('all existing Task columns preserved')
        finally:
            db.close()
            outer.rollback()
    with engine.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM work_tasks WHERE title LIKE :token'),{'token':token+'%'}).scalar()==0
    for check in checks: print('PASS:',check)
    print('PASS: all temporary work/request/meeting writes rolled back; no protected records written')

if __name__=='__main__': run()
