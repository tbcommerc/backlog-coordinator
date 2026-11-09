"""Exercise real filters/aggregates without protected tables or reference records."""
from datetime import date, timedelta
from types import SimpleNamespace as NS
from zoneinfo import ZoneInfo
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from models import WorkTask
from routers import work_tasks_router as api
from services import work_tasks as work


def test_workspace_counts_filters_and_access(monkeypatch):
    engine = create_engine('sqlite://')
    WorkTask.__table__.create(engine)
    actor = NS(id=1, team_id=10, role_name='', role=NS(
        task_edit_scope='none', customer_portal_only=False,
        backlog_dmb_access='none', backlog_team_access='none', reports_access='none',
        analytics_access='none', customer_access='none', settings_access='none', admin_access='none'))
    # Only formatting is replaced; real SQL access policy and all filters run.
    monkeypatch.setattr(work, 'response', lambda db, row, user: {'id': row.id})
    today = datetime.now(ZoneInfo('Europe/Moscow')).date()
    with Session(engine) as db:
        for i, values in enumerate([
            dict(assignee_id=1, status='in_progress', due_date=today-timedelta(days=1)),
            dict(assignee_id=None, status='new'),
            dict(assignee_id=2, acceptor_id=1, status='in_acceptance', execution_team_id=20),
            dict(assignee_id=1, status='done', due_date=today-timedelta(days=1)),
            dict(assignee_id=99, requester_id=99, created_by=99, execution_team_id=99, status='new'),
        ], 1):
            data=dict(id=i,title='Работа',description='Результат',work_direction='organizational',execution_team_id=10,
                      requester_id=1,requester_team_id=10,created_by=1,assignment_state='accepted',version=1,is_deleted=False)
            data.update(values);db.add(WorkTask(**data))
        db.commit()
        def listing(**kw):
            return api.list_work(db=db,user=actor,page=1,per_page=30,**kw)
        data=listing(view='all')
        assert data['total']==4
        assert data['collection_counts']==dict(all=4,mine=2,team=3,requested=4,acceptance=1)
        assert data['summary']==dict(total=4,done=1,in_acceptance=1,overdue=1,unassigned=1,active=3,proposals=0)
        assert listing(view='mine')['total']==2
        assert listing(view='acceptance')['items']==[{'id':3}]
        assert listing(view='team',execution_team_id=20)['items']==[{'id':3}]
        assert listing(view='all',unassigned=True)['items']==[{'id':2}]
        assert listing(view='all',overdue=True)['items']==[{'id':1}]
        assert listing(view='all',q='нет совпадений')['summary']['total']==0
        assert listing(view='all',status='active')['total']==3
        assert listing(view='all',execution_team_id=99)['total']==0
        db.get(WorkTask, 2).status = 'cancelled'
        db.commit()
        assert listing(view='all')['summary']['unassigned']==0
        assert listing(view='all',unassigned=True)['items']==[]
    engine.dispose()
