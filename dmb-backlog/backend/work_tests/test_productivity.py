"""Real SQL policies and conflicts without any protected fixture records."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
from pydantic import ValidationError
from models import WorkTask, WorkTaskTemplate, WorkHistory, EventOutbox
from services import work_tasks as work, work_templates
from routers import work_tasks_router as api
from work_contract import WorkCreate, WorkUpdate, ChecklistToggle, TemplateCreate, TemplateUpdate
from test_work_tasks import user, row


@pytest.fixture
def db(monkeypatch):
    engine=create_engine('sqlite://')
    for model in (WorkTask, WorkTaskTemplate, WorkHistory, EventOutbox): model.__table__.create(engine)
    monkeypatch.setattr(work, 'notify_work', lambda *args: None)
    with Session(engine) as session: yield session
    engine.dispose()


@pytest.mark.parametrize('values', [dict(priority='other'),dict(priority=None),dict(checklist=None),
    dict(checklist=[dict(id='a',title=' ')]),dict(checklist=[dict(id='a',title='X'),dict(id='a',title='Y')]),
    dict(checklist=[dict(id=str(i),title='X') for i in range(51)])])
def test_invalid_priority_and_checklist(values):
    with pytest.raises(ValidationError): WorkUpdate(version=1,**values)


def test_backward_defaults():
    req=WorkCreate(title='Работа',work_direction='product',execution_team_id=10)
    assert req.priority=='normal' and req.checklist==[]


def test_priority_sort_filter_and_acl(db,monkeypatch):
    monkeypatch.setattr(work,'response',lambda db,task,actor:{'id':task.id})
    for i,priority in enumerate(['low','high','normal','urgent'],1):
        task=row(priority=priority);task.id=i;db.add(task)
    hidden=row(priority='urgent');hidden.id=5;hidden.execution_team_id=99;hidden.requester_id=99;hidden.assignee_id=99;hidden.acceptor_id=99;db.add(hidden);db.commit()
    result=api.list_work(view='all',sort='priority',page=1,per_page=30,db=db,user=user())
    assert [x['id'] for x in result['items']]==[4,2,3,1]
    assert api.list_work(view='all',priority='urgent',page=1,per_page=30,db=db,user=user())['total']==1


def test_editor_changes_structure_assignee_only_checks_and_conflicts_are_atomic(db):
    task=row(checklist=[dict(id='a',title='Проверить',completed=False)]);db.add(task);db.commit()
    assignee=user(2,scope='none')
    with pytest.raises(HTTPException) as exc: work.update(db,task,assignee,WorkUpdate(version=1,priority='urgent'))
    assert exc.value.status_code==403
    with pytest.raises(HTTPException): work.update(db,task,assignee,WorkUpdate(version=1,checklist=[]))
    work.toggle_checklist(db,task,assignee,'a',ChecklistToggle(version=1,completed=True));db.commit()
    assert task.checklist[0]['completed'] and task.version==2 and task.result_revision==1
    with pytest.raises(HTTPException) as exc: work.toggle_checklist(db,task,assignee,'a',ChecklistToggle(version=1,completed=False))
    assert exc.value.status_code==409 and task.checklist[0]['completed']
    assert db.query(WorkHistory).count()==1
    work.update(db,task,user(),WorkUpdate(version=2,priority='high',checklist=[dict(id='a',title='Уточнить',completed=True),dict(id='b',title='Проверить снова')]))
    db.commit();assert task.version==3 and len(task.checklist)==2
    with pytest.raises(HTTPException): work.toggle_checklist(db,task,user(8,team=20,scope='none'),'a',ChecklistToggle(version=3,completed=False))
    with pytest.raises(HTTPException) as exc: work.toggle_checklist(db,task,user(),'missing',ChecklistToggle(version=3,completed=True))
    assert exc.value.status_code==404
    task.status='done';db.commit()
    with pytest.raises(HTTPException) as exc: work.toggle_checklist(db,task,assignee,'a',ChecklistToggle(version=3,completed=False))
    assert exc.value.status_code==422


def test_templates_owned_versioned_and_independent(db):
    req=TemplateCreate(name='Подготовка',content=dict(title='Встреча',priority='high',checklist=['Повестка']))
    created=work_templates.create(db,user(),req)
    assert work_templates.scope(db,user(2)).count()==0
    with pytest.raises(HTTPException) as exc: work_templates.change(db,user(2),created['id'],1,{'name':'Чужой'})
    assert exc.value.status_code==404
    copy=created['content'].copy();copy['checklist']=[dict(id='copy',title='Повестка',completed=False)]
    task=row(priority=copy['priority'],checklist=copy['checklist']);db.add(task);db.commit()
    updated=work_templates.change(db,user(),created['id'],1,{'content':{'title':'Новый шаблон','priority':'low','checklist':[]}})
    assert updated['version']==2 and task.priority=='high' and len(task.checklist)==1
    with pytest.raises(HTTPException) as exc: work_templates.change(db,user(),created['id'],1,{'name':'Устаревший'})
    assert exc.value.status_code==409
    work_templates.change(db,user(),created['id'],2,{'is_deleted':True})
    assert work_templates.scope(db,user()).count()==0 and db.get(WorkTask,task.id).checklist


@pytest.mark.parametrize('field,value',[('assignee_id',2),('execution_team_id',10),('due_date','2026-12-01'),('checklist',[{'title':'Пункт','completed':True}])])
def test_template_cannot_capture_assignment_or_completed_flags(field,value):
    with pytest.raises(ValidationError): TemplateCreate(name='Шаблон',content={'title':'Задача',field:value})


def test_template_permission_and_validation(db):
    with pytest.raises(HTTPException) as exc: work_templates.scope(db,user(scope='none'))
    assert exc.value.status_code==403
    with pytest.raises(ValidationError): TemplateCreate(name=' ',content={'title':'Работа'})
    with pytest.raises(ValidationError): TemplateCreate(name='X',content={'title':'Работа','checklist':[' ']})
    with pytest.raises(ValidationError): TemplateUpdate(name='X',content={'title':'Работа'},version=0)
