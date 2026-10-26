from datetime import datetime, timedelta, timezone, date
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException
from models import WorkTask, WorkHistory, User, Team, Task, Project, EventOutbox
from services import work_board, work_tasks
from services.work_query import Filters, Selection
from test_work_tasks import user, row as base_row


def row(**values):
    task=base_row()
    for key,value in values.items():setattr(task,key,value)
    return task


@pytest.fixture
def db(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    for model in (WorkTask,WorkHistory,User,Team,Task,Project,EventOutbox):model.__table__.create(engine)
    monkeypatch.setattr(work_board.settings,'WORK_TASK_BOARD_ENABLED',True)
    with Session(engine) as session:yield session
    engine.dispose()


def populate(db,count=125):
    for status in ('new','ready','in_progress','in_acceptance','done','cancelled'):
        for i in range(count):
            task=row(status=status,priority=('urgent','normal','high','low')[i%4],due_date=date(2026,11,1)+timedelta(days=i%5))
            task.id=None;db.add(task)
    db.commit()


@pytest.mark.parametrize('sort',['attention','priority','due','newest'])
def test_independent_keyset_pages_and_counts_over_100(db,sort):
    populate(db,26)
    filters=Filters(view='all',status='',sort=sort)
    result=work_board.read(db,user(),filters)
    assert result['total']==156==result['summary']['total']
    assert all(c['total']==26 and len(c['items'])==20 for c in result['columns'])
    assert all(x['id']>0 and x['public_id']==f"WRK-{x['id']}" for c in result['columns'] for x in c['items'])
    first=result['columns'][1]
    second=work_board.read(db,user(),filters,status='ready',cursor=first['next_cursor'])['column']
    assert (second['range_start'],second['range_end'])==(21,26)
    assert not set(x['id'] for x in first['items']) & set(x['id'] for x in second['items'])
    previous=work_board.read(db,user(),filters,status='ready',cursor=second['previous_cursor'])['column']
    assert [x['id'] for x in previous['items']]==[x['id'] for x in first['items']]
    assert 'description' not in first['items'][0] and 'checklist' not in first['items'][0]


def test_filtered_is_not_zero_and_same_selection_as_list(db):
    populate(db,2)
    filters=Filters(view='all',status='active',priority='urgent')
    result=work_board.read(db,user(),filters)
    assert result['columns'][-1]['total'] is None
    assert result['cancelled']['state']=='filtered'
    assert result['total']==Selection(db,user(),filters).query.count()==4
    result=work_board.read(db,user(),Filters(view='acceptance',status=''))
    assert all(x['state']=='filtered' for x in result['columns'] if x['status']!='in_acceptance')


def test_cursor_binding_ttl_date_signature_and_concurrent_insert(db):
    populate(db,25);now=datetime(2026,10,21,20,59,tzinfo=timezone.utc)
    f=Filters(view='all',sort='newest');first=work_board.read(db,user(),f,now=now)['columns'][0]
    cursor=first['next_cursor']
    for kwargs,code in [({'user':user(9)},409),({'status':'ready'},409),({'filters':Filters(view='all',sort='due')},409),
                        ({'now':now+timedelta(minutes=31)},409),({'now':now+timedelta(minutes=2)},409),({'cursor':cursor+'x'},400)]:
        args=dict(db=db,user=user(),filters=f,status='new',cursor=cursor,now=now);args.update(kwargs)
        with pytest.raises(HTTPException) as e:work_board.read(**args)
        assert e.value.status_code==code
    added=row();added.id=None;db.add(added);db.commit()
    second=work_board.read(db,user(),f,status='new',cursor=cursor,now=now)['column']
    assert len(second['items'])==5
    assert not set(x['id'] for x in first['items']) & set(x['id'] for x in second['items'])


def test_acl_applied_to_counts_and_pages(db):
    populate(db,1);hidden=row(execution_team_id=99,requester_id=99,assignee_id=99,acceptor_id=99);hidden.id=None;db.add(hidden);db.commit()
    result=work_board.read(db,user(),Filters(view='all',status=''))
    assert result['total']==6
    assert all(x['id']!=hidden.id for c in result['columns'] for x in c['items'])


def test_batched_projection_has_bounded_sql(db):
    populate(db,22);queries=[]
    listener=lambda *args:queries.append(1)
    event.listen(db.get_bind(),'before_cursor_execute',listener)
    try:result=work_board.read(db,user(),Filters(view='all',status=''))
    finally:event.remove(db.get_bind(),'before_cursor_execute',listener)
    assert len(queries)<=15
    assert len(result['columns'][0]['items'])==20


def test_transition_metadata_matches_policy_and_missing_fields(db):
    task=row(status='new',description='',assignee_id=None,due_date=None)
    options=work_board.transition_options(task,user())
    ready=next(x for x in options if x['target']=='ready')
    assert not ready['enabled'] and set(ready['missing_fields'])=={'description','assignee_id','due_date'}
    task=row(status='in_progress',acceptance_required=True)
    assert [x['target'] for x in work_board.transition_options(task,user()) if x['enabled']]==work_tasks.available_actions(task,user())
    assert next(x for x in work_board.transition_options(task,user()) if x['target']=='in_acceptance')['requires_input']==['result_text']


def test_flag_disabled(db,monkeypatch):
    monkeypatch.setattr(work_board.settings,'WORK_TASK_BOARD_ENABLED',False)
    with pytest.raises(HTTPException) as e:work_board.read(db,user(),Filters())
    assert e.value.status_code==404


def test_done_calendar_period_and_unknown_completion(db):
    now=datetime(2026,10,21,12,tzinfo=timezone.utc)
    start=datetime(2026,10,14,21,tzinfo=timezone.utc)
    for i,completed in enumerate([start-timedelta(seconds=1),start,now,now+timedelta(seconds=1),None],1):
        db.add(row(id=i,status='done',completed_at=completed))
    db.add(row(id=6,status='ready'));db.commit()
    selected=Selection(db,user(),Filters(view='all',status='active_done',done_period='7d'),now)
    assert {x.id for x in selected.query}=={2,3,6}
    assert Selection(db,user(),Filters(view='all',status='done'),now).query.count()==5


def test_project_filter_does_not_leak_inaccessible_parent(db,monkeypatch):
    from types import SimpleNamespace
    original_get=db.get
    monkeypatch.setattr(db,'get',lambda model,id:SimpleNamespace(id=7,name='Проект') if model is Project and id==7 else original_get(model,id))
    db.add_all([Task(id=1,title='Доступная',team_id=10,project_id=7,is_deleted=False),
                Task(id=2,title='Недоступная',team_id=20,project_id=7,is_deleted=False)])
    db.add_all([row(id=1,direct_project_id=7),row(id=2,major_task_id=1),row(id=3,major_task_id=2)])
    db.commit()
    query=Selection(db,user(),Filters(view='all',effective_project_id=7)).query
    assert {x.id for x in query}=={1,2}
    hidden=work_board.read(db,user(),Filters(view='all'))['columns'][0]['items']
    item=next(x for x in hidden if x['id']==3)
    assert item['context']=={'kind':'unavailable','title':'Контекст недоступен'} and item['effective_project_id'] is None


def test_http_contract_and_disabled_feature(db,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.work_tasks_router import router
    from database import get_db
    from auth import get_current_user
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_db]=lambda:db
    app.dependency_overrides[get_current_user]=lambda:user()
    populate(db,21)
    with TestClient(app) as client:
        first=client.get('/work-tasks/board?view=all&status=active&selected_id=1')
        assert first.status_code==200
        data=first.json();assert data['selected_matches'] is True and data['columns'][0]['items'][0]['id']>0
        cursor=data['columns'][0]['next_cursor']
        page=client.get('/work-tasks/board/columns/new',params={'view':'all','status':'active','cursor':cursor})
        assert page.status_code==200 and page.json()['column']['range_start']==21
        for path in ('/work-tasks/board?status=unknown','/work-tasks/board?page_size=51','/work-tasks/board?execution_team_id=-1','/work-tasks?status=unknown'):
            assert client.get(path).status_code==422
        assert client.get('/work-tasks/board/columns/new?cursor=bad').status_code==400
        monkeypatch.setattr(work_board.settings,'WORK_TASK_BOARD_ENABLED',False)
        assert client.get('/work-tasks/options').json()['board_enabled'] is False
        assert client.get('/work-tasks/board').status_code==404
        assert client.get('/work-tasks?view=all').status_code==200
