from datetime import date, datetime, timezone
from types import SimpleNamespace as NS
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient
from models import Task, WorkTask, Project, TaskHistory, TaskStatus, Team, User, Deadline, Priority, ProjectStatus, EventOutbox
from metric_models import Metric, MetricPeriod, MetricMeasurement
from services import project_workspace as service
from auth import get_current_user, require_non_business_customer_access
from database import get_db
from routers.projects_router import router


def user():
    return NS(id=1, team_id=10, role_name='', role=NS(customer_portal_only=False,
        **{name+'_access':'none' for name in ('backlog_dmb','backlog_team','reports','analytics','customer','settings','admin')}))


@pytest.fixture
def db(monkeypatch):
    engine=create_engine('sqlite://',poolclass=StaticPool,connect_args={'check_same_thread':False})
    for model in (Task,WorkTask,Project,TaskHistory,TaskStatus,Team,User,Deadline,Priority,ProjectStatus,Metric,MetricPeriod,MetricMeasurement,EventOutbox):
        model.__table__.create(engine)
    fake=NS(id=7,code='TEST',name='Направление',description=None,status=None,pl=None,created_at=None)
    monkeypatch.setattr(service,'project',lambda db,id: fake)
    monkeypatch.setattr(service,'deadlines',lambda db:{1:dict(name='1Q 2026',slots={(2026,1)}),2:dict(name='2026',slots={(2026,0)})})
    with Session(engine) as session:
        original=session.get
        monkeypatch.setattr(session,'get',lambda model,id:fake if model is Project and id==7 else original(model,id))
        yield session
    engine.dispose()


@pytest.mark.parametrize('code,name,expected',[
    ('Q1_2026','I квартал',{(2026,1)}),('Y2026','2026',{(2026,0)}),
    ('','1Q 2026, 2Q 2026',{(2026,1),(2026,2)}),('','Когда-нибудь',set()),
])
def test_planning_does_not_turn_annual_into_q4(code,name,expected):
    assert service.deadline_slots(code,name)==expected


def test_acl_and_annual_planning(db):
    # Only ordinary tasks are inserted. Users/teams/projects/dictionaries remain empty.
    db.add_all([Task(id=1,title='Квартал',team_id=10,project_id=7,deadline_id=1),
                Task(id=2,title='Год',team_id=10,project_id=7,deadline_id=2),
                Task(id=3,title='Скрытая',team_id=20,project_id=7,deadline_id=1),
                Task(id=4,title='Без периода',team_id=10,project_id=7),
                Task(id=5,title='Удалена',team_id=10,project_id=7,is_deleted=True)])
    db.commit()
    result=service.workspace(db,user(),7,2026)
    assert result['backlog_total']==3
    assert result['plan']=={'1':1,'2':0,'3':0,'4':0,'annual':1,'unplanned':1}
    assert service.backlog(db,user(),7,2026,bucket='annual')['total']==1
    assert service.backlog(db,user(),7,2026,bucket='unplanned')['total']==1
    assert service.backlog(db,user(),7,2026,q='Скрытая')['total']==0


def test_moscow_completion_boundary_and_hidden_parent(db):
    db.add(Task(id=1,title='Чужая задача',team_id=20,project_id=7))
    for id,stamp,major,status in [(1,'2026-03-31T20:59:59',None,'done'),(2,'2026-03-31T21:00:00',None,'done'),
                                  (3,'2026-02-01T00:00:00',1,'done'),(4,'2026-02-01T00:00:00',None,'in_progress')]:
        db.add(WorkTask(id=id,title=f'Работа {id}',description='',work_direction='product',execution_team_id=10,
            requester_id=1,created_by=1,major_task_id=major,direct_project_id=None if major else 7,
            status=status,completed_at=datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)))
    db.commit()
    assert [x['id'] for x in service.results(db,user(),7,2026,1)['items']]==[1]
    assert [x['id'] for x in service.results(db,user(),7,2026,2)['items']]==[2]


def test_changes_do_not_disclose_other_team_history(db):
    db.add_all([Task(id=1,title='Доступна',team_id=10,project_id=7),Task(id=2,title='Чужая',team_id=20,project_id=7)])
    db.flush()
    db.add_all([TaskHistory(task_id=id,field_name='deadline_id',old_value='1',new_value='2',changed_at=datetime(2026,4,3)) for id in (1,2)])
    db.commit()
    data=service.results(db,user(),7,2026,2,'moves')
    assert data['total']==1 and data['items'][0]['id']==1
    assert data['items'][0]['before']=='1Q 2026'


def test_metric_results_do_not_include_future_measurements_or_hidden_metrics(db,monkeypatch):
    monkeypatch.setattr(service,'today',lambda:date(2026,10,29))
    for id,team in [(1,10),(2,20)]:
        db.add(Metric(id=id,title=f'Metric {id}',team_id=team,project_id=7))
        db.add(MetricPeriod(id=id,metric_id=id,label='2026',start_date=date(2026,1,1),end_date=date(2026,12,31),state='active',direction='up',baseline=0,target=10))
    db.flush()
    for id in (1,2):
        db.add_all([MetricMeasurement(period_id=id,measured_on=date(2026,3,1),value=2,source='test',author_id=1),
                    MetricMeasurement(period_id=id,measured_on=date(2026,5,1),value=5,source='test',author_id=1)])
    db.commit()
    data=service.results(db,user(),7,2026,1,'metrics')
    assert data['total']==1 and data['items'][0]['summary']['fact']==2


def test_http_bounds_and_route_authorization(db):
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_db]=lambda:db
    app.dependency_overrides[get_current_user]=user
    app.dependency_overrides[require_non_business_customer_access]=user
    client=TestClient(app)
    assert client.get('/projects/7/workspace?year=2026').status_code==200
    for path in ['workspace?year=99999','results?quarter=5','results?kind=unknown','backlog?bucket=5','backlog?page=0']:
        assert client.get('/projects/7/'+path).status_code==422
    del app.dependency_overrides[require_non_business_customer_access]
    app.dependency_overrides[get_current_user]=lambda:NS(id=1,role_name='',role=NS(customer_portal_only=True))
    assert client.get('/projects/7/workspace').status_code==403
