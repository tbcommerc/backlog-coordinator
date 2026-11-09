"""Quarterly acceptance tests. PostgreSQL writes are rolled back and guarded."""
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pytest
from services.metric_quarterly_rules import result, annual, quarter_dates, decimal_value, validate_plan


def plan(kind='volume',target='100',baseline=None,direction='up',upper=None):
    return NS(result_type=kind,target=Decimal(target),baseline=Decimal(baseline) if baseline else None,
              direction=direction,upper=Decimal(upper) if upper else None,baseline_date=date(2025,12,31),start_date=date(2026,1,1))


@pytest.mark.parametrize('value,expected',[('80','80'),('120','120'),('0','0')])
def test_volume(value,expected):
    assert result(plan(),Decimal(value))['progress']==expected


def test_zero_plan_and_missing():
    assert result(plan(target='0'),Decimal(0))['progress'] is None
    assert result(plan(target='0'),Decimal(0))['outcome']=='achieved'
    assert result(plan(),None)['outcome']=='no_data'


def test_change_and_threshold_range():
    p=plan('change','5','10','down')
    assert result(p,Decimal(6))['progress']=='80'
    assert result(p,Decimal(11))['progress']=='-20'
    with pytest.raises(ValueError):validate_plan(plan('change','10','10'),date(2026,1,1))
    assert result(plan('threshold','-1',direction='down'),Decimal('-2'))['outcome']=='achieved'
    assert result(plan('threshold','0',direction='up'),Decimal('0'))['outcome']=='achieved'
    assert result(plan('threshold','0',direction='up'),Decimal('-1'))['outcome']=='not_achieved'
    p=plan('range','0',direction='range',upper='1')
    assert result(p,Decimal('1'))['outcome']=='within_range'
    assert result(p,Decimal('1.0000000001'))['outcome']=='outside_range'


@pytest.mark.parametrize('value',['NaN','Infinity','0.00000000001','1000000000000001',1.2,'1e3',' 1'])
def test_decimal_rejects(value):
    with pytest.raises(ValueError):decimal_value(value)


def test_calendar():
    assert quarter_dates(2024,1)==(date(2024,1,1),date(2024,3,31))
    assert quarter_dates(2026,4)==(date(2026,10,1),date(2026,12,31))


def annual_period(value,state='completed',**fact):
    return dict(state=state,plan=dict(result_type='volume',target='100',unit_snapshot='шт',method_snapshot='сумма',direction='up'),
                fact=dict(value=str(value),status='final' if state=='completed' else 'preliminary',**fact))


def test_annual_coverage():
    periods={q:annual_period(v) for q,v in enumerate([100,120,80,150],1)}
    assert annual(periods,[1,2,3,4],'sum')['final_value']=='450'
    del periods[2]
    out=annual(periods,[1,2,3,4],'sum')
    assert out['final_value'] is None and out['confirmed_value']=='330' and out['coverage']['missing']==[2]
    del periods[4]
    assert annual(periods,[1,2,3,4],'last')['confirmed_value'] is None
    assert annual({1:annual_period(5,'cancelled')},[1],'sum')['final_value'] is None
    adjusted=annual({1:annual_period(100)},[1,2],'sum',exclusions={'2':'Не ведётся'})
    assert adjusted['final_value']=='100' and adjusted['scope_adjusted'] and adjusted['coverage']['excluded']=={'2':'Не ведётся'}
    incompatible={1:annual_period(100),2:annual_period(100)}
    incompatible[2]['plan']['method_snapshot']='Другая методика'
    assert annual(incompatible,[1,2],'sum')['reason']=='not_comparable'


def test_ratio():
    periods={1:annual_period(90,numerator='90',denominator='100'),2:annual_period(10,numerator='1',denominator='10')}
    assert annual(periods,[1,2],'ratio')['final_value']=='82.7272727273'
    periods[2]['fact'].pop('numerator')
    assert annual(periods,[1,2],'ratio')['reason']=='missing_components'


@pytest.fixture
def api2(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from database import engine,get_db
    from auth import get_current_user,get_task_action_scope,is_customer_portal_only
    from models import User,Team
    from routers.metrics_quarterly_router import router
    from routers.metrics_router import router as v1
    assert engine.dialect.name=='postgresql'
    conn=engine.connect();outer=conn.begin();db=Session(bind=conn,join_transaction_mode='create_savepoint')
    users=db.query(User).filter_by(is_active=True).all()
    user=next(u for u in users if get_task_action_scope(u,'edit')=='all' and not is_customer_portal_only(u))
    team=db.query(Team).first();state={'user':user}
    app=FastAPI();app.include_router(router,prefix='/api/v2');app.include_router(v1,prefix='/api/v1')
    def session():
        try:yield db
        finally:db.rollback()
    app.dependency_overrides[get_db]=session;app.dependency_overrides[get_current_user]=lambda:state['user']
    def guard(conn,cursor,statement,*args):
        import re
        match=re.match(r'\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+["]?([a-z_]+)',statement,re.I)
        if match:assert match[1] in {'kr_metrics','kr_periods','kr_measurements','kr_history','kr_comments','kr_files','kr_links','kr_reporting_statuses','kr_period_plan_revisions','kr_period_fact_revisions','kr_period_closure_revisions','kr_year_settings','kr_pause_intervals','idempotency_records'},'Protected write '+match[1]
    event.listen(conn,'before_cursor_execute',guard)
    try:yield TestClient(app),db,state,user,team
    finally:event.remove(conn,'before_cursor_execute',guard);db.close();outer.rollback();conn.close()


def payload(api):
    return dict(title='Quarterly acceptance',team_id=api[4].id,owner_id=api[3].id,unit='шт',source='QA',year=2025,
        preferred_result_type='volume',annual_aggregation='sum',expected_quarters=[1,2,3,4],save_mode='start',
        plans=[dict(quarter=q,target='100') for q in range(1,5)])


def create(api,body=None):
    response=api[0].post('/api/v2/metrics',json=body or payload(api),headers={'Idempotency-Key':'quarterly-create-123'})
    assert response.status_code==201,response.text
    return response.json()


def command(api,m,path,body,key,method='post',status=200):
    response=getattr(api[0],method)(f"/api/v2/metrics/{m['id']}"+path,json={'version':m['version'],**body},headers={'Idempotency-Key':key})
    assert response.status_code==status,response.text
    return response.json()


def test_atomic_creation_idempotency_and_legacy_guard(api2):
    m=create(api2);again=create(api2)
    assert m['id']==again['id'] and len(m['periods'])==4
    assert api2[0].get(f"/api/v1/metrics/{m['id']}").status_code==409
    from metric_models import Metric
    count=api2[1].query(Metric).count()
    body=payload(api2);body['plans'][2]['target']='-1'
    r=api2[0].post('/api/v2/metrics',json=body,headers={'Idempotency-Key':'quarterly-bad-plan'})
    assert r.status_code==422,r.text
    assert api2[1].query(Metric).count()==count


def test_fact_measurement_close_correction(api2):
    m=create(api2);pid=m['periods'][0]['id']
    m=command(api2,m,f'/periods/{pid}/measurements',dict(value='80',measured_on='2025-03-20'),'quarterly-measurement',status=201)
    assert m['periods'][0]['fact'] is None
    mid=api2[0].get(f"/api/v2/metrics/{m['id']}/periods/{pid}/measurements").json()['items'][0]['id']
    body=dict(value='80',as_of_date='2025-03-20',source_measurement_id=mid)
    old=m;m=command(api2,m,f'/periods/{pid}/fact',body,'quarterly-fact','put')
    replay=command(api2,old,f'/periods/{pid}/fact',body,'quarterly-fact','put')
    assert replay['version']==m['version']
    m=command(api2,m,f'/measurements/{mid}',dict(value='90',measured_on='2025-03-20',reason='Ошибка'),'quarterly-correct-measurement','patch')
    assert m['periods'][0]['fact']['value']=='80' and m['periods'][0]['source_measurement_changed']
    m=command(api2,m,f'/periods/{pid}/close',dict(value='80',as_of_date='2025-03-31',confirm_final=True),'quarterly-close')
    first=m['periods'][0]['closure_revision_id'];closed_at=m['periods'][0]['closed_at']
    assert m['periods'][0]['state']=='completed' and m['periods'][0]['result']['outcome']=='not_achieved'
    m=command(api2,m,f'/periods/{pid}/fact-corrections',dict(value='120',as_of_date='2025-03-31',confirm_final=True,reason='Сверка'),'quarterly-final-correction')
    assert m['periods'][0]['closure_revision_id']!=first and m['periods'][0]['closed_at']==closed_at


def test_future_and_version(api2):
    body=payload(api2);body['year']=2090
    m=create(api2,body);pid=m['periods'][0]['id']
    command(api2,m,f'/periods/{pid}/fact',dict(value='0',as_of_date='2090-01-01'),'quarterly-future','put',422)
    command(api2,m,f'/periods/{pid}/close',dict(value='0',as_of_date='2090-03-31',confirm_final=True),'quarterly-future-close',status=422)
    command(api2,m,f'/periods/{pid}/measurements',dict(value='0',measured_on='2090-01-01'),'quarterly-future-point',status=422)
    old=m;m=command(api2,m,'/lifecycle',dict(action='pause',reason='Пауза'),'quarterly-pause')
    command(api2,old,'/lifecycle',dict(action='pause',reason='Пауза'),'quarterly-conflict',status=409)


def test_registry_same_period_filters_and_zero(api2):
    m=create(api2);pid=m['periods'][0]['id']
    m=command(api2,m,f'/periods/{pid}/close',dict(value='0',as_of_date='2025-03-31',confirm_final=True),'quarterly-zero-close')
    base=f"/api/v2/metrics?year=2025&view=year&q=MET-{m['id']}"
    r=api2[0].get(base+'&period_state=active&attention=not_achieved');assert r.status_code==200,r.text
    assert r.json()['total']==0
    r=api2[0].get(base+'&period_state=completed&attention=not_achieved');assert r.status_code==200,r.text
    assert r.json()['total']==1
    r=api2[0].get(base+'&attention=missing_fact');assert r.json()['total']==1
    assert r.json()['summary']['not_achieved']==1
    r=api2[0].get(base,params={'team_id':'['+str(m['team_id'])+',2147483647]','period_state':'["active","completed"]','attention':'["missing_fact","not_achieved"]','scope':'mine'})
    assert r.status_code==200 and r.json()['total']==1
    assert r.json()['summary']['missing_fact']==1 and r.json()['summary']['not_achieved']==1
    assert api2[0].get(f"/api/v2/metrics/{m['id']}?year=2025").json()['annual']['confirmed_value']=='0'


def test_owner_gate_and_foreign_ids(api2):
    from models import User
    from auth import get_task_action_scope,is_customer_portal_only
    m=create(api2);pid=m['periods'][0]['id']
    other=next((u for u in api2[1].query(User).filter(User.id!=api2[3].id,User.is_active.is_(True)) if get_task_action_scope(u,'edit')=='all' and not is_customer_portal_only(u)),None)
    assert other is not None,'Existing second authorized profile required'
    api2[2]['user']=other
    command(api2,m,f'/periods/{pid}/close',dict(value='1',as_of_date='2025-03-31',confirm_final=True),'quarterly-wrong-owner',status=403)
    command(api2,m,'/periods/2147483647/fact',dict(value='1',as_of_date='2025-03-31'),'quarterly-foreign','put',404)


def test_close_boundary_and_early_confirmation(api2,monkeypatch):
    from services import metric_quarterly_service as service
    from routers import metrics_quarterly_router as router
    m=create(api2);pid=m['periods'][0]['id']
    monkeypatch.setattr(router,'today',lambda:date(2025,3,31));monkeypatch.setattr(service,'today',lambda:date(2025,3,31))
    command(api2,m,f'/periods/{pid}/close',dict(value='100',as_of_date='2025-03-31',confirm_final=True),'quarterly-last-day',status=422)
    monkeypatch.setattr(router,'today',lambda:date(2025,4,1));monkeypatch.setattr(service,'today',lambda:date(2025,4,1))
    body=dict(value='100',as_of_date='2025-03-20',confirm_final=True)
    command(api2,m,f'/periods/{pid}/close',body,'quarterly-early-date',status=422)
    m=command(api2,m,f'/periods/{pid}/close',{**body,'confirm_early_as_of':True},'quarterly-early-date')
    assert m['periods'][0]['fact']['as_of_date']=='2025-03-20'


def test_closed_plan_revision_preserves_initial(api2):
    from metric_quarterly_models import PlanRevision,ClosureRevision
    m=create(api2);p=m['periods'][0];pid=p['id'];original=p['plan']['revision_id']
    m=command(api2,m,f'/periods/{pid}/close',dict(value='80',as_of_date='2025-03-31',confirm_final=True),'quarterly-revise-close')
    closure=m['periods'][0]['closure_revision_id']
    m=command(api2,m,f'/periods/{pid}/plan-revisions',dict(quarter=1,target='75',reason='Пересмотр объёма',confirm_revision=True),'quarterly-revise-plan')
    assert m['periods'][0]['result']['outcome']=='achieved'
    assert api2[1].get(PlanRevision,original).data['target']=='100'
    assert api2[1].get(ClosureRevision,closure).snapshot['result']['outcome']=='not_achieved'
    assert m['periods'][1]['plan']['target']=='100'


def test_range_fact_independent_of_observations(api2):
    body=payload(api2);body['preferred_result_type']='range';body['default_direction']='range'
    for p in body['plans']:p.update(target='10',upper='20')
    m=create(api2,body);pid=m['periods'][0]['id']
    m=command(api2,m,f'/periods/{pid}/measurements',dict(value='30',measured_on='2025-03-20'),'quarterly-range-measure',status=201)
    m=command(api2,m,f'/periods/{pid}/close',dict(value='15',as_of_date='2025-03-31',confirm_final=True),'quarterly-range-close')
    assert m['periods'][0]['result']['outcome']=='within_range'
    assert m['periods'][0]['observations']['violation_count']==1


def test_rollback_switch_preserves_reads(api2,monkeypatch):
    from config import settings
    m=create(api2);pid=m['periods'][0]['id']
    monkeypatch.setattr(settings,'METRICS_QUARTERLY_WRITE_ENABLED',False)
    assert api2[0].get(f"/api/v2/metrics/{m['id']}?year=2025").status_code==200
    command(api2,m,f'/periods/{pid}/fact',dict(value='1',as_of_date='2025-03-31'),'quarterly-disabled','put',503)
    assert api2[0].post(f"/api/v1/metrics/{m['id']}/archive",json={'version':m['version'],'archive':True,'reason':'test'}).status_code==409


def test_migration_no_implicit_fact_or_closure(api2):
    from metric_models import MetricHistory
    c,db,_,user,team=api2
    r=c.post('/api/v1/metrics',json=dict(title='Legacy transition QA',team_id=team.id,owner_id=user.id,unit='шт',source='QA',initial_period=dict(label='2025 Q1',start_date='2025-01-01',end_date='2025-03-31',target=100,direction='up',cadence='none',start_immediately=True)))
    assert r.status_code==201,r.text
    legacy=r.json();pid=legacy['periods'][0]['id']
    r=c.post(f"/api/v1/metrics/{legacy['id']}/periods/{pid}/transition",json=dict(version=legacy['version'],action='complete',reason='Прежнее закрытие',confirm_no_data=True))
    assert r.status_code==200;r=r.json();before=db.query(MetricHistory).count()
    preview=c.post(f"/api/v2/metrics/{r['id']}/migration-preview")
    assert preview.status_code==200 and db.query(MetricHistory).count()==before
    assert preview.json()['periods'][0]['proposed_fact'] is None
    body=dict(choices=[dict(period_id=pid,result_type='volume')],reason='Проверенный переход')
    command(api2,r,'/migrate',body,'quarterly-migration',status=422)
    body['choices'][0]['fact']=dict(version=r['version'],value='80',as_of_date='2025-03-31',source='Сверенный отчёт',confirm_final=True)
    converted=command(api2,r,'/migrate',body,'quarterly-migration')
    detail=c.get(f"/api/v2/metrics/{r['id']}?year=2025").json()
    assert detail['periods'][0]['id']==pid and detail['periods'][0]['state']=='completed'
    assert detail['periods'][0]['closed_at']==r['periods'][0]['closed_at']
    event=db.query(MetricHistory).filter_by(metric_id=r['id'],action='model_migrated').one()
    assert event.before['state']=='completed' and event.before['model_version']=='legacy_v1'


def test_pause_resume_excludes_pause_slots(api2,monkeypatch):
    from services import metric_quarterly_service as service
    from routers import metrics_quarterly_router as router
    def at(day):
        monkeypatch.setattr(service,'today',lambda:date(2025,1,day));monkeypatch.setattr(router,'today',lambda:date(2025,1,day))
    at(3);body=payload(api2);body['plans'][0].update(cadence='daily',first_due_date='2025-01-01')
    m=create(api2,body);assert m['periods'][0]['schedule']['missed_count']==2
    m=command(api2,m,'/lifecycle',dict(action='pause',reason='Пауза'),'quarterly-pause-start')
    at(10);m=command(api2,m,'/lifecycle',dict(action='resume',reason='Продолжение'),'quarterly-resume')
    d=api2[0].get(f"/api/v2/metrics/{m['id']}?year=2025").json()['periods'][0]['schedule']
    assert d==dict(missed_count=2,overdue=False,next_due='2025-01-11')


def test_manual_legacy_coverage_preserves_original(api2):
    from metric_models import MetricPeriod
    c,db,_,user,team=api2
    r=c.post('/api/v1/metrics',json=dict(title='Legacy year coverage QA',team_id=team.id,owner_id=user.id,unit='шт',source='QA',initial_period=dict(label='2025',start_date='2025-01-01',end_date='2025-12-31',target=1000,direction='up',cadence='none',start_immediately=True)))
    assert r.status_code==201,r.text
    m=r.json();pid=m['periods'][0]['id']
    before=(db.get(MetricPeriod,pid).target,db.get(MetricPeriod,pid).state)
    body=dict(reason='Ручное покрытие',choices=[dict(period_id=pid,result_type='volume',coverage_year=2025,coverage_plans=[dict(quarter=1,result_type='volume',target='120'),dict(quarter=3,result_type='volume',target='80')])])
    command(api2,m,'/migrate',body,'manual-coverage-123')
    out=c.get(f"/api/v2/metrics/{m['id']}?year=2025").json()
    assert out['model_version']=='mixed' and [p['quarter'] for p in out['periods']]==[1,3]
    assert all(p['fact'] is None for p in out['periods'])
    assert out['legacy_periods'][0]['id']==pid
    original=c.get(f"/api/v2/metrics/{m['id']}/legacy-periods/{pid}")
    assert original.status_code==200 and original.json()['period']['target']==1000
    assert (db.get(MetricPeriod,pid).target,db.get(MetricPeriod,pid).state)==before
    assert out['annual']['final_value'] is None


def test_draft_first_approved_plan_and_archive(api2):
    body=payload(api2);body['save_mode']='draft'
    m=create(api2,body);pid=m['periods'][0]['id']
    assert m['periods'][0]['original_plan'] is None
    m=command(api2,m,f'/periods/{pid}/activate',{},'approve-plan-test')
    assert m['periods'][0]['original_plan']['data']['approval_state']=='active'
    m=command(api2,m,'/lifecycle',dict(action='start'),'start-before-archive')
    m=api2[0].get(f"/api/v2/metrics/{m['id']}?year=2025").json()
    command(api2,m,'/archive',dict(archive=True,reason='Архив'),'archive-blocked-123',status=409)
    for p in m['periods']:
        m=command(api2,m,f"/periods/{p['id']}/cancel",dict(reason='Проверка'),'cancel-archive-'+str(p['id']))
        # Commands return their own year; archive returns the current year.
    m=command(api2,m,'/archive',dict(archive=True,reason='Архив'),'archive-ready-123')
    assert m['is_archived']
    m=command(api2,m,'/archive',dict(archive=False,reason='Возвращение'),'archive-restore-123')
    assert not m['is_archived'] and m['lifecycle_state']=='paused'


def test_existing_roles_v2(api2):
    from models import User
    from auth import get_task_action_scope,is_customer_portal_only,can_access_task
    from metric_models import Metric
    m=create(api2);pid=m['periods'][0]['id'];row=api2[1].get(Metric,m['id'])
    users=api2[1].query(User).filter_by(is_active=True).all()
    customer=next(u for u in users if is_customer_portal_only(u))
    api2[2]['user']=customer
    assert api2[0].get('/api/v2/metrics').status_code==403
    readonly=next(u for u in users if not is_customer_portal_only(u) and can_access_task('read',row,u) and not can_access_task('edit',row,u))
    api2[2]['user']=readonly
    out=api2[0].get(f"/api/v2/metrics/{m['id']}?year=2025").json()
    assert not out['permissions']['edit'] and not any(out['periods'][0]['capabilities'].values())
    command(api2,m,f'/periods/{pid}/fact',dict(value='1',as_of_date='2025-03-31'),'readonly-fact-123','put',403)
    api2[2]['user']=api2[3]
    # Owner assignment is an ordinary metric field, never a user/team mutation.
    m=command(api2,m,'',dict(owner_id=readonly.id),'readonly-owner-123','patch')
    api2[2]['user']=readonly
    command(api2,m,f'/periods/{pid}/close',dict(value='1',as_of_date='2025-03-31',confirm_final=True),'readonly-close-123',status=403)
    foreign=next((u for u in users if not is_customer_portal_only(u) and u.team_id and u.team_id!=row.team_id and get_task_action_scope(u,'edit')=='team'),None)
    assert foreign is not None,'Existing foreign-team QA profile required'
    api2[2]['user']=foreign
    assert api2[0].get(f"/api/v2/metrics/{m['id']}").status_code==(200 if can_access_task('read',row,foreign) else 404)
    command(api2,m,f'/periods/{pid}/fact',dict(value='1',as_of_date='2025-03-31'),'foreign-team-fact','put',403 if can_access_task('read',row,foreign) else 404)


def test_moscow_date_boundary(monkeypatch):
    from datetime import datetime,timezone
    from services import metric_rules
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):
            return datetime(2025,12,31,21,0,tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(metric_rules,'datetime',Clock)
    assert metric_rules.today()==date(2026,1,1)


def test_retry_close_plans_and_duplicate_date(api2):
    from metric_models import MetricHistory
    from metric_quarterly_models import PlanRevision,ClosureRevision
    m=create(api2);pid=m['periods'][0]['id'];old=m
    body=dict(plans=[dict(quarter=1,target='110',reason='Уточнение'),dict(quarter=2,target='120',reason='Уточнение')])
    m=command(api2,m,'/years/2025/plans',body,'replay-plans-123','put')
    count=api2[1].query(PlanRevision).count();history=api2[1].query(MetricHistory).count()
    command(api2,old,'/years/2025/plans',body,'replay-plans-123','put')
    assert api2[1].query(PlanRevision).count()==count and api2[1].query(MetricHistory).count()==history
    point=dict(value='0',measured_on='2025-03-31')
    m=command(api2,m,f'/periods/{pid}/measurements',point,'duplicate-date-first',status=201)
    out=command(api2,m,f'/periods/{pid}/measurements',point,'duplicate-date-second',status=409)
    assert out['detail']['code']=='duplicate_measurement_date' and out['detail']['measurement_id']
    old=m;body=dict(value='80',as_of_date='2025-03-31',confirm_final=True)
    m=command(api2,m,f'/periods/{pid}/close',body,'replay-close-123')
    count=api2[1].query(ClosureRevision).count();history=api2[1].query(MetricHistory).count()
    command(api2,old,f'/periods/{pid}/close',body,'replay-close-123')
    assert api2[1].query(ClosureRevision).count()==count and api2[1].query(MetricHistory).count()==history

    # Confirming an unchanged value retains its observation provenance.
    pid=m['periods'][1]['id']
    m=command(api2,m,f'/periods/{pid}/measurements',dict(value='20',measured_on='2025-06-30'),'provenance-point-123',status=201)
    point_id=api2[0].get(f"/api/v2/metrics/{m['id']}/periods/{pid}/measurements").json()['items'][0]['id']
    m=command(api2,m,f'/periods/{pid}/fact',dict(value='20',as_of_date='2025-06-30',source_measurement_id=point_id),'provenance-fact-123','put')
    m=command(api2,m,f'/periods/{pid}/close',dict(value='20',as_of_date='2025-06-30',confirm_final=True),'provenance-close-123')
    assert m['periods'][1]['fact']['source_measurement_id']==point_id


def test_precision_passport_and_source_snapshot(api2):
    m=create(api2);pid=m['periods'][0]['id']
    command(api2,m,'',dict(unit='кг'),'unit-change-denied','patch',422)
    m=command(api2,m,'',dict(source='Новый источник',method='Новая методика'),'source-passport-123','patch')
    m=command(api2,m,f'/periods/{pid}/fact',dict(value='99.9999999999',as_of_date='2025-03-31'),'precision-fact-123','put')
    assert m['periods'][0]['fact']['value']=='99.9999999999'
    assert m['periods'][0]['fact']['source']=='QA' and m['periods'][0]['result']['outcome']=='not_achieved'
    response=api2[0].get('/api/v1/metrics?q=does-not-match-quarterly')
    assert response.status_code==200


def test_readonly_previews_do_not_write(api2):
    from metric_models import MetricHistory
    m=create(api2);pid=m['periods'][0]['id']
    m=command(api2,m,f'/periods/{pid}/close',dict(value='80',as_of_date='2025-03-31',confirm_final=True),'preview-closed-123')
    count=api2[1].query(MetricHistory).count()
    response=api2[0].post(f"/api/v2/metrics/{m['id']}/periods/{pid}/plan-preview",json=dict(quarter=1,target='75'))
    assert response.status_code==200,response.text
    assert response.json()['before']['outcome']=='not_achieved' and response.json()['after']['outcome']=='achieved'
    assert api2[1].query(MetricHistory).count()==count
    response=api2[0].post('/api/v2/metrics/ratio-preview',json=dict(numerator='91',denominator='110',scale=100))
    assert response.status_code==200 and response.json()['value']=='82.7272727273'


def test_migration_keeps_materials_and_report_snapshot(api2):
    from metric_models import Metric,MetricComment,MetricFile,MetricLink,MetricReportingStatus
    from models import Task,ReportingMeeting
    from uuid import uuid4
    c,db,_,user,team=api2
    response=c.post('/api/v1/metrics',json=dict(title='Legacy materials QA',team_id=team.id,owner_id=user.id,unit='шт',source='QA',initial_period=dict(label='2025 Q1',start_date='2025-01-01',end_date='2025-03-31',target=100,direction='up',cadence='none',start_immediately=True)))
    assert response.status_code==201,response.text
    m=response.json();pid=m['periods'][0]['id'];mid=m['id']
    task=db.query(Task).filter(Task.metric_id.is_(None)).first();meeting=db.query(ReportingMeeting).first()
    assert task and meeting,'Existing task and meeting references required'
    record=db.get(Metric,mid);record.legacy_snapshot={'immutable':'original KR passport'}
    comment=MetricComment(metric_id=mid,period_id=pid,author_id=user.id,text='Original comment')
    file=MetricFile(metric_id=mid,period_id=pid,author_id=user.id,filename='original.txt',storage_key=uuid4().hex,size=17)
    link=MetricLink(metric_id=mid,task_id=task.id,created_by=user.id)
    report=MetricReportingStatus(metric_id=mid,period_id=pid,meeting_id=meeting.id,author_id=user.id,text='Original status',snapshot={'fact':17,'legacy':True})
    db.add_all([comment,file,link,report]);db.commit()
    preserved=(comment.id,file.id,file.storage_key,link.id,report.id,report.snapshot.copy())
    command(api2,m,'/migrate',dict(choices=[dict(period_id=pid,result_type='volume')],reason='Explicit conversion'),'materials-migrate-123')
    assert (comment.id,file.id,file.storage_key,link.id,report.id,report.snapshot)==preserved
    assert db.get(Metric,mid).legacy_snapshot=={'immutable':'original KR passport'}
    assert c.get(f'/api/v2/metrics/{mid}/comments').json()['items'][0]['id']==comment.id
    assert c.get(f'/api/v2/metrics/{mid}/files').json()['items'][0]['id']==file.id
    out=c.get(f'/api/v2/metrics/{mid}?year=2025').json()
    out=command(api2,out,f'/periods/{pid}/close',dict(value='80',as_of_date='2025-03-31',confirm_final=True),'materials-close-123')
    command(api2,out,f'/periods/{pid}/plan-revisions',dict(quarter=1,target='75',confirm_revision=True,reason='Revised target'),'materials-revise-123')
    db.expire(report)
    assert report.snapshot==preserved[-1]


def test_incomplete_draft_and_strict_commands(api2):
    body=payload(api2);body.update(save_mode='draft',source='',unit='',owner_id=None,preferred_result_type=None)
    body['plans']=[dict(quarter=1)]
    m=create(api2,body);pid=m['periods'][0]['id']
    assert m['periods'][0]['state']=='draft' and m['periods'][0]['plan']['target'] is None
    command(api2,m,'/lifecycle',dict(action='start'),'incomplete-start-123',status=422)
    command(api2,m,f'/periods/{pid}/close',dict(confirm_final=True),'no-fact-close-123',status=422)
    command(api2,m,f'/periods/{pid}/fact',dict(value='0',as_of_date='2025-03-31',unexpected=True),'unknown-field-123','put',422)
