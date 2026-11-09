from datetime import date, datetime, timedelta, timezone
from fastapi import HTTPException
from pydantic import ValidationError
import pytest
from models import Task, ProjectTaskPlan, TaskHistory, WorkTask
from project_contract import TaskPlanUpdate
from services import project_management as service
from project_tests.test_project_workspace import db, user


def editor():
    u=user();u.role.task_edit_scope='team';return u


def add_task(db,**kw):
    task=Task(id=kw.pop('id',1),title='Результат проекта',team_id=kw.pop('team_id',10),project_id=kw.pop('project_id',7),**kw)
    db.add(task);db.commit();return task


def test_horizons_unknown_and_acl(db):
    add_task(db,deadline_id=1)
    add_task(db,id=2,deadline_id=2)
    add_task(db,id=3)
    add_task(db,id=4,team_id=20,deadline_id=1)
    rows=service.management(db,user(),7,2026,1)
    assert rows['summary']['planned']==2
    assert rows['summary']['undated']==1
    assert rows['summary']['milestones']==0
    assert {r['id'] for r in rows['items']}=={1,2}
    assert all(r['precision']=='period' for r in rows['items'])
    assert service.management(db,user(),7,2026,1,horizon='undated')['items'][0]['precision']=='unknown'
    assert service.task_rows(db,user(),7,4)==[]


def test_save_milestone_baseline_and_version(db):
    task=add_task(db,deadline_id=1)
    first=TaskPlanUpdate(version=task.version,starts_on=date(2026,4,1),ends_on=date(2026,4,30),is_milestone=True,expected_result='Принятый результат')
    result=service.update_plan(db,editor(),7,1,first)
    assert result['version']==1
    assert service.management(db,user(),7,2026,1)['summary']['planned']==0
    assert service.management(db,user(),7,2026,2)['summary']['milestones']==1
    with pytest.raises(HTTPException) as e:service.update_plan(db,editor(),7,1,first)
    assert e.value.status_code==409
    with pytest.raises(HTTPException) as e:service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=1,starts_on=date(2026,4,1),ends_on=date(2026,5,10)))
    assert e.value.status_code==422
    service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=1,starts_on=date(2026,4,1),ends_on=date(2026,5,10),is_milestone=True,change_reason='Уточнена оценка'))
    plan=db.get(ProjectTaskPlan,1)
    assert plan.baseline_end==date(2026,4,30)
    assert db.query(TaskHistory).filter_by(field_name='project_plan').count()==2
    assert service.task_rows(db,user(),7)[0]['delay_days']==10
    assert db.get(Task,1).deadline_id==1
    service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=2,starts_on=date(2026,4,1),ends_on=date(2026,5,10),is_milestone=True,expected_result='Уточнённый результат'))
    assert db.get(ProjectTaskPlan,1).change_reason=='Уточнена оценка'


def test_readonly_wrong_project_and_lock(db):
    task=add_task(db)
    payload=TaskPlanUpdate(version=0,is_milestone=True)
    for u,pid,expected in [(user(),7,403),(editor(),8,404)]:
        with pytest.raises(HTTPException) as e:service.update_plan(db,u,pid,1,payload)
        assert e.value.status_code==expected
    task.lock_owner_id=99;task.lock_until=datetime.now(timezone.utc)+timedelta(minutes=5);db.commit()
    with pytest.raises(HTTPException) as e:service.update_plan(db,editor(),7,1,payload)
    assert e.value.status_code==423
    assert db.query(ProjectTaskPlan).count()==0


def test_no_dates_no_fake_milestone(db):
    add_task(db)
    service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=0,is_milestone=True))
    row=service.task_rows(db,user(),7)[0]
    assert row['is_milestone'] and row['milestone_on'] is None and not row['spans']
    assert service.management(db,user(),7,2026,1)['summary']['milestones']==0


def test_attention_deduplicates_and_stays_project_wide(db,monkeypatch):
    monkeypatch.setattr(service,'today',lambda:date(2026,11,3))
    add_task(db)
    service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=0,starts_on=date(2026,1,1),ends_on=date(2026,1,30)))
    service.update_plan(db,editor(),7,1,TaskPlanUpdate(version=1,starts_on=date(2026,1,1),ends_on=date(2026,2,10),change_reason='Перенос'))
    r=service.management(db,user(),7,2026,4,view='deviations')
    assert r['total']==1 and r['summary']['planned']==0
    assert r['items'][0]['issues']==['overdue','shifted']


def test_pagination_axis_and_hidden_work_parent(db):
    for i in range(1,33):add_task(db,id=i,deadline_id=1)
    add_task(db,id=50,team_id=20)
    db.add(WorkTask(id=1,title='Не раскрывать',description='',work_direction='product',execution_team_id=10,requester_id=1,created_by=1,major_task_id=50,status='in_acceptance'))
    db.commit()
    r=service.management(db,user(),7,2026,1,horizon='all',page=2)
    assert r['total']==32 and len(r['items'])==2
    assert r['chart_start']==date(2026,1,1) and r['chart_end']==date(2026,3,31)
    assert all(x['kind']=='backlog' for x in r['attention'])
    assert service.management(db,user(),7,2026,1,q='NOT FOUND')['total']==0


@pytest.mark.parametrize('payload',[
    {'version':0,'starts_on':'2026-01-01'},
    {'version':0,'starts_on':'2026-02-01','ends_on':'2026-01-01'},
    {'version':0,'team_id':20},
])
def test_contract_rejects_partial_dates_and_protected_fields(payload):
    with pytest.raises(ValidationError):TaskPlanUpdate(**payload)


def test_http_management_validation_and_task_acl(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from auth import get_current_user, require_non_business_customer_access
    from database import get_db
    from routers.projects_router import router
    add_task(db,deadline_id=1)
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_db]=lambda:db
    app.dependency_overrides[get_current_user]=user
    app.dependency_overrides[require_non_business_customer_access]=user
    client=TestClient(app)
    assert client.get('/projects/7/management?year=2026&quarter=1').json()['summary']['planned']==1
    assert client.get('/projects/7/tasks/1/plan').json()['can_edit'] is False
    assert client.get('/projects/8/tasks/1/plan').status_code==404
    for query in ['year=1999','year=2026&quarter=5','year=2026&horizon=nope','year=2026&page=0']:
        assert client.get('/projects/7/management?'+query).status_code==422
    assert client.put('/projects/7/tasks/1/plan',json={'version':0,'is_milestone':True}).status_code==403
    app.dependency_overrides[get_current_user]=editor
    assert client.put('/projects/7/tasks/1/plan',json={'version':0,'is_milestone':True}).status_code==200
    assert client.put('/projects/7/tasks/1/plan',json={'version':0,'is_milestone':False}).status_code==409


def test_quarterly_metric_uses_explicit_fact_not_observation(db,monkeypatch):
    from metric_models import Metric,MetricPeriod,MetricMeasurement
    from metric_quarterly_models import FactRevision
    from services import project_workspace
    FactRevision.__table__.create(db.get_bind())
    monkeypatch.setattr(project_workspace,'today',lambda:date(2026,11,3))
    db.add(Metric(id=1,title='Цель',team_id=10,project_id=7,model_version='quarterly_v2'))
    db.add(MetricPeriod(id=1,metric_id=1,label='IV квартал',start_date=date(2026,10,1),end_date=date(2026,12,31),state='active',direction='up',baseline=0,target=10,model_version='quarterly_v2'))
    db.flush()
    db.add(MetricMeasurement(period_id=1,measured_on=date(2026,11,1),value=99,source='test',author_id=1));db.commit()
    assert project_workspace.results(db,user(),7,2026,4,'metrics')['items'][0]['summary']['fact'] is None
    fact=FactRevision(id=1,period_id=1,revision_no=1,value=3,as_of_date=date(2026,11,1),status='interim',source='manual',author_id=1)
    db.add(fact);db.flush();db.get(MetricPeriod,1).current_fact_revision_id=1;db.commit()
    assert project_workspace.results(db,user(),7,2026,4,'metrics')['items'][0]['summary']['fact']==3
