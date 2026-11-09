"""Metric API regressions on PostgreSQL; only disposable metric rows are written.
Existing users/dictionaries are read. An outer transaction rolls everything back.
Run: python -m pytest metric_tests --confcutdir=metric_tests -q
"""
from datetime import date, timedelta
from types import SimpleNamespace as NS
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.orm import Session
from database import engine, get_db
from models import User, Team, Task, TaskType, ReportingMeeting, WorkTask
from metric_models import Metric, MetricPeriod
from auth import get_current_user, get_task_action_scope, is_customer_portal_only, can_access_task
from routers.metrics_router import router
from services.metric_rules import summarize, due_dates, today
from config import settings

def base(**kw):
    values=dict(start_date=date(2026,1,1),end_date=date(2026,3,31),baseline=100,target=200,upper=None,direction='up',state='active',cadence='monthly',interval_days=None,first_due_date=date(2026,1,31))
    values.update(kw);return NS(**values)
def point(value,day=31):return NS(id=1,value=value,measured_on=date(2026,1,day))

@pytest.mark.parametrize('direction,baseline,target,value,expected',[('up',100,200,150,50),('up',100,200,80,-20),('up',100,200,220,120),('down',100,0,0,100),('down',100,0,120,-20)])
def test_progress(direction,baseline,target,value,expected):
    assert summarize(base(direction=direction,baseline=baseline,target=target),[point(value)],date(2026,1,31))['progress']==expected
def test_no_data_is_not_zero():
    assert summarize(base(),[])['fact'] is None
    assert summarize(base(),[point(0)])['fact']==0
def test_calendar_months_keep_anchor():
    assert due_dates(base())==[date(2026,1,31),date(2026,2,28),date(2026,3,31)]
def test_range_violations_and_no_data():
    p=base(direction='range',target=90,upper=110)
    assert summarize(p,[],date(2026,1,31))['outcome']=='no_data'
    assert summarize(p,[point(120,30),point(100)],date(2026,1,31))['outcome']=='violated'
    assert summarize(p,[point(100)],date(2026,1,31))['progress'] is None
def test_schedule_late_measurement_does_not_cover_missed_slot():
    p=base(first_due_date=date(2026,1,10),cadence='weekly')
    s=summarize(p,[point(5,12)],date(2026,1,18))
    assert s['missed_count']==1 and s['next_due']==date(2026,1,10)

def test_manual_schedule_and_optional_baseline():
    p=base(cadence='none',baseline=None,first_due_date=date(2026,1,1))
    assert due_dates(p)==[]
    empty=summarize(p,[],date(2026,2,1))
    assert empty['fact'] is None and empty['freshness']=='missing'
    s=summarize(p,[point(220)],date(2026,2,1))
    assert s['progress'] is None and s['achieved'] and s['deviation']==20
    assert s['next_due'] is None and s['missed_count']==0 and s['freshness']=='current'

def test_manual_range_cannot_confirm_whole_period():
    p=base(cadence='none',direction='range',baseline=None,target=90,upper=110)
    s=summarize(p,[point(100)],date(2026,4,1))
    assert s['achieved'] and s['outcome']=='unconfirmed' and s['deviation']==0
    s=summarize(p,[point(120,30),point(100)],date(2026,4,1))
    assert s['achieved'] and s['outcome']=='violated' and s['violation_count']==1

@pytest.fixture
def api(tmp_path,monkeypatch):
    assert engine.dialect.name=='postgresql','Integration suite requires PostgreSQL'
    conn=engine.connect();outer=conn.begin()
    db=Session(bind=conn,join_transaction_mode='create_savepoint')
    users=db.query(User).filter_by(is_active=True).all()
    user=next(u for u in users if get_task_action_scope(u,'edit')=='all' and not is_customer_portal_only(u))
    team=db.query(Team).first()
    state={'user':user}
    application=FastAPI();application.include_router(router,prefix='/api/v1')
    def session_dependency():
        try:yield db
        finally:db.rollback()
    application.dependency_overrides[get_db]=session_dependency
    application.dependency_overrides[get_current_user]=lambda:state['user']
    monkeypatch.setattr(settings,'ATTACHMENT_STORAGE_DIR',tmp_path)
    monkeypatch.setattr(settings,'CLAMAV_HOST',None)
    def protect(conn,cursor,statement,*args):
        import re
        match=re.match(r'\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+["]?([a-z_]+)',statement,re.I)
        if match:assert match[1] in {'kr_metrics','kr_periods','kr_measurements','kr_history','kr_comments','kr_links','kr_files','kr_reporting_statuses','idempotency_records'},'Protected/unexpected write: '+match[1]
    event.listen(conn,'before_cursor_execute',protect)
    client=TestClient(application)
    try:yield client,db,state,user,team
    finally:
        event.remove(conn,'before_cursor_execute',protect)
        db.close();outer.rollback();conn.close()

def passport(user,team):return dict(title='QA metric API',team_id=team.id,owner_id=user.id,unit='шт',method='Счёт',source='QA')
def create(api):
    c,db,state,user,team=api
    r=c.post('/api/v1/metrics',json=passport(user,team))
    assert r.status_code==201,r.text
    return r.json()
def command(api,m,suffix,body,expected=200,method='post'):
    response=getattr(api[0],method)('/api/v1/metrics/'+str(m['id'])+suffix,json={'version':m['version'],**body})
    assert response.status_code==expected,response.text
    return response.json()
def active(api,**kw):
    m=create(api);t=today()
    payload=dict(label='QA period',start_date=str(t-timedelta(days=7)),end_date=str(t+timedelta(days=20)),
        baseline=100,baseline_date=str(t-timedelta(days=7)),target=200,direction='up',cadence='weekly',first_due_date=str(t))
    payload.update(kw)
    m=command(api,m,'/periods',payload,201);p=m['periods'][0]
    return command(api,m,f"/periods/{p['id']}/transition",{'action':'activate'}),p,payload
def test_options_list_migration(api):
    c,db,_,_,_=api
    r=c.get('/api/v1/metrics/options');assert r.status_code==200,r.text
    r=c.get('/api/v1/metrics');assert r.status_code==200,r.text
    original=db.query(Task).join(TaskType,TaskType.id==Task.task_type_id).filter(TaskType.code=='metric_kr').all()
    for t in original:
        m=db.get(Metric,t.metric_id)
        assert m and m.legacy_task_id==t.id and m.owner_id==t.owner_id
        assert m.legacy_snapshot['metric_kr_fact']==t.metric_kr_fact
        if can_access_task('read',m,api[3]):
            detail=c.get('/api/v1/metrics/'+str(m.id));assert detail.status_code==200,detail.text
def test_create_and_idempotency(api):
    c,_,_,user,team=api;payload=passport(user,team);headers={'Idempotency-Key':'metric-test-key-12345'}
    first=c.post('/api/v1/metrics',json=payload,headers=headers);assert first.status_code==201,first.text
    second=c.post('/api/v1/metrics',json=payload,headers=headers);assert second.status_code==201,second.text
    assert first.json()['id']==second.json()['id']

def simple_period(**kw):
    return dict(label='Простая цель',start_date=str(today()-timedelta(days=7)),
                end_date=str(today()+timedelta(days=7)),direction='down',target=0,
                cadence='none',start_immediately=True,**kw)

def test_combined_creation_manual_measurement_and_history(api):
    c,db,_,user,team=api
    payload={**passport(user,team),'method':'','initial_period':simple_period()}
    headers={'Idempotency-Key':'simple-metric-test-creation'}
    response=c.post('/api/v1/metrics',json=payload,headers=headers)
    assert response.status_code==201,response.text
    m=response.json();p=m['periods'][0]
    assert p['state']=='active' and p['baseline'] is None and p['method_snapshot']==''
    assert {h['action'] for h in m['history']}=={'created','period_created','activate'}
    retry=c.post('/api/v1/metrics',json=payload,headers=headers).json()
    assert retry['id']==m['id'] and len(retry['periods'])==1 and len(retry['history'])==3
    # An omitted measurement source inherits the period snapshot, even after passport edits.
    m=command(api,m,'',{**passport(user,team),'source':'Новый источник'},method='patch')
    m=command(api,m,f"/periods/{p['id']}/measurements",dict(value=0,measured_on=str(today())),201)
    assert m['measurements'][0]['source']=='QA'
    summary=m['periods'][0]['summary']
    assert summary['achieved'] and summary['progress'] is None and summary['deviation']==0
    assert summary['next_due'] is None and summary['missed_count']==0
    point=m['measurements'][0]
    m=command(api,m,'/measurements/'+str(point['id']),dict(value=2,measured_on=str(today()),reason='Уточнение'),method='patch')
    assert any(h['action']=='measurement_corrected' and h['before']['value']==0 for h in m['history'])
    persisted=c.get('/api/v1/metrics/'+str(m['id'])).json()
    assert persisted['measurements'][0]['value']==2
    assert len(persisted['history'])==len(m['history'])

def test_combined_creation_failure_is_atomic_and_retryable(api):
    c,db,_,user,team=api
    title='QA atomic simple metric'
    payload={**passport(user,team),'title':title,'initial_period':{**simple_period(),'direction':'range','target':10,'upper':5}}
    headers={'Idempotency-Key':'simple-metric-atomic-test'}
    response=c.post('/api/v1/metrics',json=payload,headers=headers)
    assert response.status_code==422,response.text
    assert not db.query(Metric).filter_by(title=title).first()
    payload['initial_period']['upper']=10
    response=c.post('/api/v1/metrics',json=payload,headers=headers)
    assert response.status_code==201,response.text
    assert response.json()['periods'][0]['state']=='active'

def test_combined_draft_and_start_with_optional_method(api):
    c,_,_,user,team=api
    period={**simple_period(),'target':None,'start_immediately':False}
    response=c.post('/api/v1/metrics',json={**passport(user,team),'method':'','initial_period':period})
    assert response.status_code==201,response.text
    m=response.json();p=m['periods'][0]
    assert p['state']=='draft'
    m=command(api,m,f"/periods/{p['id']}",{**simple_period(),'target':10},method='patch')
    assert m['periods'][0]['state']=='active'
    assert any(h['action']=='activate' for h in m['history'])

def test_optional_baseline_pair_and_required_schedule(api):
    c,_,_,user,team=api
    for updates in [{'baseline':10},{'baseline_date':str(today()-timedelta(days=7))},
                    {'cadence':'weekly'},{'cadence':'interval','interval_days':3}]:
        response=c.post('/api/v1/metrics',json={**passport(user,team),'initial_period':{**simple_period(),**updates}})
        assert response.status_code==422,response.text

def test_new_active_period_preserves_previous_period_and_history(api):
    m,p,_=active(api)
    m=command(api,m,f"/periods/{p['id']}/measurements",dict(value=150,measured_on=str(today()),source='QA'),201)
    previous=m['periods'][0];points=m['measurements'];history_ids={h['id'] for h in m['history']}
    new_period={**simple_period(), 'start_date':str(today()+timedelta(days=21)),
                'end_date':str(today()+timedelta(days=40))}
    m=command(api,m,'/periods',new_period,201)
    assert len(m['periods'])==2 and m['periods'][0]['state']=='active'
    assert next(x for x in m['periods'] if x['id']==p['id'])==previous
    assert m['measurements']==points
    assert history_ids.issubset({h['id'] for h in m['history']})
def test_measurement_correction_close_reopen(api):
    m,p,_=active(api);pid=p['id'];url=f'/periods/{pid}/measurements'
    m=command(api,m,url,dict(value=0,measured_on=str(today()),source='QA'),201)
    assert m['periods'][0]['summary']['fact']==0
    mid=m['measurements'][0]['id']
    command(api,m,url,dict(value=10,measured_on=str(today()),source='QA'),409)
    m=command(api,m,'/measurements/'+str(mid),dict(value=220,measured_on=str(today()),source='QA',reason='Исправление'),method='patch')
    assert m['periods'][0]['summary']['progress']==120
    assert any(h['action']=='measurement_corrected' and h['before']['value']==0 for h in m['history'])
    m=command(api,m,f'/periods/{pid}/transition',dict(action='complete',reason='Итог'))
    command(api,m,url,dict(value=10,measured_on=str(today()),source='QA'),409)
    m=command(api,m,f'/periods/{pid}/transition',dict(action='reopen',reason='Повторный расчёт'))
    assert m['periods'][0]['state']=='active'
def test_version_and_invalid_dates(api):
    m,p,_=active(api)
    command(api,m,'/comments',{'text':'устаревшая версия','version':m['version']-1},409)
    command(api,m,f"/periods/{p['id']}/measurements",dict(value=10,measured_on=str(today()+timedelta(days=1)),source='QA'),422)
    command(api,m,f"/periods/{p['id']}/measurements",dict(value=10,measured_on=str(today()-timedelta(days=10)),source='QA'),422)
def test_period_overlap_goal_reason_and_archive(api):
    m,p,payload=active(api)
    command(api,m,'/periods',payload,422)
    command(api,m,f"/periods/{p['id']}",{**payload,'target':250},422,method='patch')
    command(api,m,'/archive',dict(archive=True,reason='QA'),422)
    m=command(api,m,f"/periods/{p['id']}/transition",dict(action='cancel',reason='QA'))
    m=command(api,m,'/archive',dict(archive=True,reason='QA'));assert m['is_archived']
    command(api,m,'/comments',dict(text='QA'),409)
    m=command(api,m,'/archive',dict(archive=False,reason='QA'));assert not m['is_archived']
def test_files_and_comments(api):
    c=api[0];m=create(api);m=command(api,m,'/comments',{'text':'QA comment'},201)
    assert m['comments'][0]['text']=='QA comment'
    r=c.post(f"/api/v1/metrics/{m['id']}/files",data={'version':m['version']},files={'file':('qa.txt',b'hello','text/plain')})
    assert r.status_code==201,r.text
    m=r.json();f=m['files'][0]
    r=c.get(f"/api/v1/metrics/{m['id']}/files/{f['id']}/download");assert r.content==b'hello'
    r=c.delete(f"/api/v1/metrics/{m['id']}/files/{f['id']}?version={m['version']}");assert r.status_code==200,r.text
    assert not r.json()['files']
    assert c.get(f"/api/v1/metrics/{m['id']}/files/{f['id']}/download").status_code==404
def test_links_and_reporting_snapshot(api):
    c,db,_,user,_=api;m,p,_=active(api)
    t=next((t for t in db.query(Task).filter(Task.is_deleted.is_(False),Task.metric_id.is_(None)) if can_access_task('read',t,user)),None)
    if t:
        m=command(api,m,'/links',dict(kind='task',target_id=t.id),201);assert len(m['links'])==1
        r=c.delete(f"/api/v1/metrics/{m['id']}/links/{m['links'][0]['id']}?version={m['version']}");assert r.status_code==200,r.text;m=r.json()
    meeting=db.query(ReportingMeeting).filter_by(state='planned').first()
    if meeting:
        m=command(api,m,'/reports',dict(period_id=p['id'],meeting_id=meeting.id,text='QA snapshot'));assert m['reports'][0]['snapshot']['target']==200
def test_read_scope_and_denied_write(api):
    c,db,state,user,team=api;m=create(api)
    readers=[u for u in db.query(User).filter_by(is_active=True) if not is_customer_portal_only(u) and can_access_task('read',NS(team_id=team.id),u) and get_task_action_scope(u,'edit')=='none']
    if readers:
        state['user']=readers[0];assert c.get('/api/v1/metrics/'+str(m['id'])).status_code==200
        command(api,m,'/periods',dict(label='QA',start_date=str(today()),end_date=str(today())),403)
    customer=next((u for u in db.query(User).filter_by(is_active=True) if is_customer_portal_only(u)),None)
    if customer:
        state['user']=customer;assert c.get('/api/v1/metrics').status_code==403

