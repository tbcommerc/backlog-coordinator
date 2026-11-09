"""Recovery never runs old startup or persists a derived history refresh."""
from dataclasses import dataclass
from types import SimpleNamespace
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import Column,Integer,MetaData,String,Table,create_engine,select,update,text
from sqlalchemy.pool import StaticPool

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.recovery import ReadOnlyStoreView,readonly_app


def environment():
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    table=Table('synthetic_history',MetaData(),Column('id',Integer,primary_key=True),Column('value',String))
    table.create(engine)
    with engine.begin() as connection:connection.execute(table.insert().values(id=1,value='persisted'))
    return engine,table


def test_recovery_excludes_old_startup_and_mutations_but_preserves_get():
    engine,table=environment();calls=[]
    @asynccontextmanager
    async def startup(app):
        calls.append('startup_or_worker');yield
    legacy=FastAPI(lifespan=startup)
    @legacy.get('/history')
    def history():
        with engine.connect() as connection:return {'value':connection.scalar(select(table.c.value))}
    @legacy.post('/send')
    def send():calls.append('model_or_business_write');return {}
    def authorize(request):
        if request.headers.get('x-actor-ref')!='one':raise AgentError('run_not_found',404)
    app=readonly_app(legacy,engines=[engine],before_read=authorize,service_id='fixture')
    with TestClient(app) as client:
        assert client.get('/health/ready').json()['mode']=='recovery_read_only'
        assert client.get('/history').status_code==404
        assert client.get('/history',headers={'X-Actor-Ref':'one'}).json()=={'value':'persisted'}
        assert client.post('/send').status_code==503
    assert calls==[]
    engine.dispose()


@pytest.mark.parametrize('raw',[False,True])
def test_accidental_get_write_is_blocked_before_sql(raw):
    engine,table=environment();legacy=FastAPI()
    @legacy.get('/bad-get')
    def bad():
        with engine.begin() as connection:
            connection.execute(text("UPDATE synthetic_history SET value='changed'") if raw else
                               update(table).values(value='changed'))
        return {}
    app=readonly_app(legacy,engines=[engine],service_id='fixture')
    with TestClient(app) as client:assert client.get('/bad-get').status_code==503
    with engine.connect() as connection:assert connection.scalar(select(table.c.value))=='persisted'
    engine.dispose()


def test_display_refresh_stays_in_request_memory_and_cannot_touch_history():
    @dataclass
    class State:
        session_id:str='one'
        value:str='persisted'
    stored=State()
    class Store:
        def get(self,identity):return stored
        def save(self,value):pytest.fail('Recovery persisted derived data')
    view=ReadOnlyStoreView(Store());legacy=FastAPI();engine,table=environment()
    @legacy.get('/history')
    def history():
        state=view.get('one');state.value='derived display';view.save(state)
        return {'value':view.get('one').value}
    app=readonly_app(legacy,engines=[engine],service_id='fixture',store_views=[view])
    with TestClient(app) as client:
        assert client.get('/history').json()['value']=='derived display'
        assert client.get('/history').status_code==200
    assert stored.value=='persisted'
    with pytest.raises(AgentError,match='recovery_read_only'):view.save(State())
    engine.dispose()


def test_recovery_readiness_requires_existing_schema():
    engine,table=environment()
    app=readonly_app(FastAPI(),engines=[engine],service_id='fixture',required_tables=['missing_history'])
    with TestClient(app) as client:
        assert client.get('/health/ready').status_code==503
    assert 'missing_history' not in __import__('sqlalchemy').inspect(engine).get_table_names()
    engine.dispose()


def test_legacy_singleton_is_replaced_without_running_constructor(tmp_path):
    from dmb_agent_contracts.recovery import load_without_singleton
    import sys
    path=tmp_path/'legacy_fixture.py'
    path.write_text("def constructor():\n    raise AssertionError('implicit startup')\nsingleton=constructor()\ndef codec(value):\n    return value.upper()\n",encoding='utf-8')
    name='synthetic_recovery_legacy_fixture'
    try:
        module=load_without_singleton(name,'singleton',lambda module:{'read_only':True},source_path=path)
        assert module.singleton=={'read_only':True} and module.codec('history')=='HISTORY'
    finally:
        sys.modules.pop(name,None)


def test_auth_nonce_exception_cannot_write_domain_table():
    from dmb_agent_contracts.recovery import guard_engine
    engine,history=environment()
    nonce=Table('synthetic_auth_nonces',MetaData(),Column('id',String,primary_key=True))
    nonce.create(engine)
    guard_engine(engine,auth_nonce_tables=['synthetic_auth_nonces'])
    with engine.begin() as connection:
        connection.execute(nonce.insert().values(id='one'))
        assert connection.scalar(text("SELECT 'update insert delete'"))=='update insert delete'
        with pytest.raises(AgentError):connection.execute(history.update().values(value='changed'))
        with pytest.raises(AgentError):connection.execute(text("WITH source AS (SELECT 1) UPDATE synthetic_history SET value='changed'"))
    with engine.connect() as connection:assert connection.scalar(select(history.c.value))=='persisted'
    engine.dispose()
