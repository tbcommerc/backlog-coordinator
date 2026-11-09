import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text

from dmb_agent_contracts.run_migration import migrate, validate
from dmb_agent_contracts.run_store import fingerprint
from test_run_facade import environment, headers, request_body


def test_explicit_retry_is_owned_linked_and_idempotent(environment):
    client, store, _ = environment
    original = client.post('/internal/agent/v1/runs',json=request_body(),headers=headers())
    location = original.headers['Location']
    retry = {**request_body(),'retry_of':original.json()['run_id']}
    scoped = {**headers(),'Idempotency-Key':'explicit-retry'}
    assert client.post('/internal/agent/v1/runs',json=retry,headers=scoped).status_code==409
    assert client.post(location+'/cancel',headers=headers()).status_code==200
    accepted = client.post('/internal/agent/v1/runs',json=retry,headers=scoped)
    assert accepted.status_code==202 and accepted.json()['run_id']!=original.json()['run_id']
    status = client.get(accepted.headers['Location'],headers=headers()).json()
    assert status['retry_of']==original.json()['run_id']
    repeated = client.post('/internal/agent/v1/runs',json=retry,headers=scoped)
    assert repeated.status_code==200 and repeated.json()['run_id']==accepted.json()['run_id']
    assert client.post('/internal/agent/v1/runs',json=retry,
        headers={**headers('foreign'),'Idempotency-Key':'foreign-retry'}).status_code==404
    changed = {**retry,'source':{**retry['source'],'ref':'different-source'}}
    assert client.post('/internal/agent/v1/runs',json=changed,
        headers={**headers(),'Idempotency-Key':'changed-source-retry'}).status_code==409


def test_unknown_retry_create_can_be_cancelled_without_dispatch(environment):
    client, store, _ = environment
    original=client.post('/internal/agent/v1/runs',json=request_body(),headers=headers())
    client.post(original.headers['Location']+'/cancel',headers=headers())
    retry={**request_body(),'retry_of':original.json()['run_id']}
    scoped={**headers(),'Idempotency-Key':'unknown-retry'}
    cancelled=client.post('/internal/agent/v1/runs/cancellations',json=retry,headers=scoped)
    late=client.post('/internal/agent/v1/runs',json=retry,headers=scoped)
    assert cancelled.status_code==200 and late.status_code==200
    assert late.json()['run_id']==cancelled.json()['run_id'] and late.json()['status']=='cancelled'
    assert store.claim() is None


def test_unknown_parent_identity_is_resolved_by_owned_idempotency_key(environment):
    client,store,_=environment
    original=client.post('/internal/agent/v1/runs',json=request_body(),headers=headers())
    client.post(original.headers['Location']+'/cancel',headers=headers())
    body={**request_body(),'retry_of_key':'synthetic-key'}
    scoped={**headers(),'Idempotency-Key':'retry-after-lost-create'}
    accepted=client.post('/internal/agent/v1/runs',json=body,headers=scoped)
    assert accepted.status_code==202
    assert store.get(accepted.json()['run_id'])['retry_of']==original.json()['run_id']
    tombstone=client.post('/internal/agent/v1/runs/cancellations',json=body,headers=scoped)
    assert tombstone.status_code==200 and tombstone.json()['status']=='cancelled'
    assert client.post('/internal/agent/v1/runs',json=body,headers=scoped).json()['run_id']==accepted.json()['run_id']
    assert client.post('/internal/agent/v1/runs',json=body,
        headers={**headers('foreign'),'Idempotency-Key':'foreign-parent-key'}).status_code==404


def test_nullable_retry_extension_keeps_old_canonical_hash(environment):
    client,store,_=environment
    accepted=client.post('/internal/agent/v1/runs',json=request_body(),headers=headers())
    row=store.get(accepted.json()['run_id'])
    expected=fingerprint({'canonicalization':1,'request':request_body(),'profile':{'name':'synthetic'},'context':{}})
    assert row['request_hash']==expected
    repeated=client.post('/internal/agent/v1/runs',json={**request_body(),'retry_of':None},headers=headers())
    assert repeated.status_code==200 and repeated.json()['run_id']==row['id']


def test_existing_facade_expansion_requires_backup_and_preserves_history(tmp_path):
    engine=create_engine('sqlite:///'+str(tmp_path/'legacy.sqlite'))
    legacy=Path(__file__).with_name('fixtures').joinpath('run_schema_v1.sql').read_text(encoding='utf-8')
    with engine.begin() as connection:
        for statement in legacy.split(';'):
            if statement.strip():
                connection.exec_driver_sql(statement)
        connection.execute(text("INSERT INTO agent_runs (id,caller,actor,key,request_hash,input,profile,source,operation,trusted_context,status,version,delivery,created_at,deadline_at,result_expired) VALUES (:id,'dmb','synthetic','old-key',:hash,'{}','{}','{}','synthetic.test','{}','failed',3,'unknown','2026-11-04','2026-11-04',0)"),
            {'id':str(uuid4()),'hash':'a'*64})
        before=connection.execute(text('SELECT id,request_hash,status,version FROM agent_runs')).all()
    with pytest.raises(RuntimeError,match='requires_verified_backup'):
        migrate(engine)
    assert 'retry_of' not in {column['name'] for column in inspect(engine).get_columns('agent_runs')}
    migrate(engine,backup_verified=True)
    validate(engine)
    with engine.connect() as connection:
        assert connection.execute(text('SELECT id,request_hash,status,version FROM agent_runs')).all()==before
        assert connection.scalar(text('SELECT retry_of FROM agent_runs')) is None
    engine.dispose()
