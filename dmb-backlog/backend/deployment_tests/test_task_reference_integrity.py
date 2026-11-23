import pytest

from deployment_tests.test_stand_setup import client, activate_and_login
from models import Task, Tag, Department, DidClientGroup, BusinessCustomer


def create_payload(client, db):
    user, _ = activate_and_login(client, db)
    refs = client.get('/api/v1/tasks/reference').json()
    fields = {field: refs[key][0]['id'] for field, key in [
        ('team_id','teams'), ('task_type_id','task_types'), ('channel_id','channels'),
        ('status_id','statuses'), ('priority_id','priorities'), ('deadline_id','deadlines'), ('project_id','projects')]}
    return {**fields,'title':'Isolated reference integrity','date_received':'2026-11-23','owner_id':user.id}


@pytest.mark.parametrize('method', ['post','patch','put'])
@pytest.mark.parametrize('field,value', [('department_id',987654321),('involved_teams',[987654321])])
def test_unknown_reference_is_a_field_error_without_partial_write(client, db, method, field, value):
    payload = create_payload(client, db)
    if method == 'post':
        before = db.query(Task).count()
        response = client.post('/api/v1/tasks/',json={**payload,field:value})
        assert db.query(Task).count() == before
    else:
        task = client.post('/api/v1/tasks/',json=payload).json()
        response = getattr(client,method)('/api/v1/tasks/'+str(task['id']),json={'version':task['version'],field:value})
        assert getattr(db.get(Task,task['id']),field) != value
    assert response.status_code == 422, response.text
    assert response.json()['detail'][0]['loc'][:2] == ['body',field]


def test_archived_tag_not_offered_but_existing_task_link_survives(client, db):
    payload = create_payload(client,db)
    tag=Tag(name='Isolated retained tag',is_active=True)
    db.add(tag);db.commit()
    task=client.post('/api/v1/tasks/',json={**payload,'tags':[tag.name]}).json()
    tag.is_active=False;db.commit()
    assert all(item['id']!=tag.id for item in client.get('/api/v1/tasks/reference').json()['tags'])
    response=client.patch('/api/v1/tasks/'+str(task['id']),json={'version':task['version'],'title':'Renamed without changing tags'})
    assert response.status_code==200,response.text
    assert any(item['id']==tag.id for item in response.json()['tags'])


def test_all_eleven_foreign_keys_roundtrip(client, db):
    payload = create_payload(client,db)
    department=Department(code='integrity_department',name='Isolated department')
    group=DidClientGroup(code='integrity_group',name='Isolated DID group')
    db.add_all([department,group]);db.flush()
    customer=BusinessCustomer(name='Isolated customer',department_id=department.id)
    db.add(customer);db.flush()
    payload.update(department_id=department.id,did_client_group_id=group.id,business_customer_id=customer.id,involved_teams=[payload['team_id']])
    db.commit()
    response=client.post('/api/v1/tasks/',json=payload)
    assert response.status_code==201,response.text
    task=client.get('/api/v1/tasks/'+str(response.json()['id'])).json()
    for key,value in payload.items():
        if key.endswith('_id') or key=='involved_teams':assert task[key]==value,key
    assert all(task.get(key) for key in ['team_name','task_type_name','channel_name','status_name','priority_name','deadline_name','project_name','department_name','did_client_group_name','business_customer_name','owner_name'])
