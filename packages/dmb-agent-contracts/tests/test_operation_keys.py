"""Identical delivery keys in separate operations must never share receipts."""
from copy import deepcopy
import os

import pytest
from sqlalchemy import create_engine, inspect, MetaData, UniqueConstraint, select
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_store import Store, metadata


def test_operation_scopes_create_cancel_and_retry_by_key(tmp_path):
    engine=create_engine(os.environ.get('AGENT_OPERATION_TEST_DATABASE_URL') or
        'sqlite:///'+(tmp_path/'operations.sqlite').as_posix())
    assert not inspect(engine).get_table_names(), 'A new disposable database is required'
    metadata.create_all(engine)
    store=Store(engine)
    body={'contract_version':'1.0','operation':'value.estimate','conversation_ref':None,
        'source':{'kind':'work_item','ref':'synthetic','revision':1,'snapshot_hash':'sha256:'+'0'*64},
        'input':{'text':'synthetic'}}
    other={**deepcopy(body),'operation':'priority.estimate'}
    try:
        first,_=store.create('dmb','actor','same-key',body,{},600,64)
        second,_=store.cancel_key('dmb','actor','same-key',other,{},600)
        assert first['id']!=second['id']
        assert store.get(first['id'])['status']=='queued'
        assert store.find_key('dmb','actor','same-key','priority.estimate')['id']==second['id']
        repeated,replayed=store.create('dmb','actor','same-key',other,{},600,64)
        assert replayed and repeated['id']==second['id']
        retry,_=store.create('dmb','actor','retry',{**other,'retry_of_key':'same-key'}, {},600,64)
        assert retry['retry_of']==second['id']
        with pytest.raises(AgentError,match='invalid_retry_source'):
            store.create('dmb','actor','retry',{**body,'retry_of_key':'same-key'}, {},600,64)
        assert store.get(first['id'])['status']=='queued'
    finally:
        metadata.drop_all(engine)
        engine.dispose()


def test_constraint_migration_preserves_original_hash_and_receipt(tmp_path):
    from dmb_agent_contracts.run_migration import migrate, validate
    engine=create_engine(os.environ.get('AGENT_OPERATION_TEST_DATABASE_URL') or
        'sqlite:///'+(tmp_path/'upgrade.sqlite').as_posix())
    assert not inspect(engine).get_table_names(), 'A new disposable database is required'
    legacy=MetaData()
    table=metadata.tables['agent_runs'].to_metadata(legacy)
    table.constraints.remove(next(c for c in table.constraints if isinstance(c,UniqueConstraint)))
    table.append_constraint(UniqueConstraint('caller','actor','key',name='uq_agent_run_idempotency'))
    metadata.tables['agent_run_events'].to_metadata(legacy)
    legacy.create_all(engine)
    store=Store(engine)
    body={'contract_version':'1.0','operation':'value.estimate','conversation_ref':None,
        'source':{'kind':'work_item','ref':'synthetic','revision':1,'snapshot_hash':'sha256:'+'0'*64},
        'input':{'text':'synthetic'}}
    try:
        row,_=store.cancel_key('dmb','actor','same-key',body,{},600)
        with engine.connect() as connection:
            before=[dict(value) for value in connection.execute(select(metadata.tables['agent_runs'])).mappings()]
            events_before=connection.execute(select(metadata.tables['agent_run_events'])).all()
        with pytest.raises(RuntimeError,match='requires_verified_backup'):
            migrate(engine)
        migrate(engine,backup_verified=True)
        validate(engine)
        migrate(engine)  # Idempotent on the current schema.
        with engine.connect() as connection:
            assert [dict(value) for value in connection.execute(select(metadata.tables['agent_runs'])).mappings()]==before
            assert connection.execute(select(metadata.tables['agent_run_events'])).all()==events_before
        repeated,replayed=store.create('dmb','actor','same-key',body,{},600,64)
        assert replayed and repeated['id']==row['id']
        distinct,_=store.create('dmb','actor','same-key',{**body,'operation':'priority.estimate'}, {},600,64)
        assert distinct['id']!=row['id']
    finally:
        metadata.drop_all(engine)
        engine.dispose()
