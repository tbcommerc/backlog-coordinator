from datetime import datetime,timedelta,timezone

import pytest
from sqlalchemy import create_engine,select
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts import run_store
from dmb_agent_contracts.key_retention import MARKER


def check_frozen_key_policy(module,monkeypatch,tmp_path):
    engine=create_engine('sqlite:///'+(tmp_path/'retention.sqlite').as_posix())
    module.metadata.create_all(engine)
    clock=[datetime(2026,11,4,tzinfo=timezone.utc)]
    monkeypatch.setattr(module,'now',lambda:clock[0])
    body={'contract_version':'1.0','operation':'meeting.extract','conversation_ref':None,
        'source':{'kind':'meeting_capture','ref':'synthetic','revision':1,'snapshot_hash':'sha256:'+'0'*64},
        'input':{'transcript':'Synthetic meeting'}}
    profile={'model':'offline-key-fixture'}
    try:
        old_store=module.Store(engine,retention={'idempotency_days':30})
        old,_=old_store.cancel_key('dmb','actor','old',body,profile,600)
        assert old['profile']==profile
        clock[0]+=timedelta(days=10)
        changed=module.Store(engine,retention={'idempotency_days':7})
        changed.expire()
        assert changed.get(old['id'])['result_expired']==1
        with pytest.raises(AgentError,match='result_expired'):
            changed.create('dmb','actor','old',body,profile,600,10)
        short,_=changed.cancel_key('dmb','actor','new',body,profile,600)
        active,_=changed.create('dmb','actor','active',body,profile,100*86400,10)
        clock[0]+=timedelta(days=8)
        changed.expire()
        assert changed.get(old['id'])['status']=='cancelled'
        assert changed.get(active['id'])['status']=='queued'
        with pytest.raises(AgentError,match='run_not_found'):
            changed.get(short['id'])
        with engine.connect() as connection:
            tombstone=connection.execute(select(module.runs.c.profile).where(module.runs.c.id==old['id'])).scalar_one()
        assert set(tombstone)=={MARKER}
        clock[0]+=timedelta(days=13)
        changed.expire()
        with pytest.raises(AgentError,match='run_not_found'):
            changed.get(old['id'])
    finally:
        engine.dispose()


def test_retention_reconfiguration_cannot_shorten_existing_key(monkeypatch,tmp_path):
    check_frozen_key_policy(run_store,monkeypatch,tmp_path)
