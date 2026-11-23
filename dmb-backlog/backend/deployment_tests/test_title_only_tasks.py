"""Only isolated synthetic fixtures; never use the application database."""
import pytest
from deployment_tests.test_stand_setup import client, activate_and_login
from models import Task


@pytest.mark.parametrize('demo', [False, True])
def test_create_with_only_title_and_reload(client, db, demo):
    activate_and_login(client, db, demo=demo)
    response = client.post('/api/v1/tasks/', json={'title': '  Только название  '})
    assert response.status_code == 201, response.text
    task = response.json()
    assert task['title'] == 'Только название'
    for field in ['team_id', 'task_type_id', 'channel_id', 'business_customer_id', 'department_id']:
        assert task[field] is None, field
    assert client.get('/api/v1/tasks/'+str(task['id'])).status_code == 200
    assert any(row['id'] == task['id'] for row in client.get('/api/v1/tasks/').json()['items'])
    assert db.get(Task, task['id']).team_id is None


def test_optional_fields_can_be_explicitly_cleared(client, db):
    activate_and_login(client, db)
    ref=client.get('/api/v1/tasks/reference').json()
    payload={'title':'Clear optional attributes', **{field:ref[key][0]['id'] for field,key in [
        ('team_id','teams'),('task_type_id','task_types'),('channel_id','channels')]}, 'date_received':'2026-11-23'}
    created=client.post('/api/v1/tasks/',json=payload)
    assert created.status_code == 201,created.text
    task=created.json()
    for method in ['patch','put']:
        response=getattr(client,method)('/api/v1/tasks/'+str(task['id']),json={
            'version':task['version'],'team_id':None,'task_type_id':None,'channel_id':None,'date_received':None})
        assert response.status_code == 200,response.text
        task=response.json()
        assert all(task[field] is None for field in ['team_id','task_type_id','channel_id','date_received'])


@pytest.mark.parametrize('payload',[{}, {'title':''}, {'title':'   '}, {'title':None}])
def test_empty_title_remains_rejected(client,db,payload):
    activate_and_login(client,db,demo=False)
    response=client.post('/api/v1/tasks/',json=payload)
    assert response.status_code == 422,response.text
    assert db.query(Task).count()==0


def test_csv_with_only_title_and_no_reference_data(client,db):
    activate_and_login(client,db,demo=False)
    response=client.post('/api/v1/tasks/import',files={'file':('title-only.csv','title\nИмпорт только названия\n'.encode('utf-8'),'text/csv')})
    assert response.status_code == 200,response.text
    assert response.json()['created']==1,response.text
    assert db.query(Task).one().team_id is None


def test_team_editor_uses_own_team_without_requiring_a_selection(client,db):
    user,_=activate_and_login(client,db)
    assert user.team_id is not None
    user.role.task_edit_scope='team'
    db.commit()
    response=client.post('/api/v1/tasks/',json={'title':'Team context is automatic'})
    assert response.status_code==201,response.text
    task=response.json()
    assert task['team_id']==user.team_id
    assert client.get('/api/v1/tasks/'+str(task['id'])).status_code==200
    cleared=client.patch('/api/v1/tasks/'+str(task['id']),json={'version':task['version'],'team_id':None})
    assert cleared.status_code==403,cleared.text
    imported=client.post('/api/v1/tasks/import',files={'file':('title-only.csv',b'title\nTeam CSV context\n','text/csv')})
    assert imported.status_code==200,imported.text
    assert imported.json()['created']==1,imported.text
    assert all(row.team_id==user.team_id for row in db.query(Task).all())
