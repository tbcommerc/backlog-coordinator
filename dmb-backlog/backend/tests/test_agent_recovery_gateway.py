"""Mock identities only; recovery fences run before any business DB dependency."""
import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import APIRouter,Depends,FastAPI,Request
from fastapi.testclient import TestClient

from auth import get_current_user
from config import settings
from database import get_db
from routers import agent_router,agent_v2_router
from services import agent_recovery,agent_v2_gateway


@pytest.mark.parametrize('path',[
    '/api/v1/agent/chat','/api/v1/agent/send-for-review',
    '/api/v1/agent-v2/chat','/api/v1/agent-v2/objects/task/1/workspace',
])
def test_recovery_blocks_ai_mutation_before_any_business_database(monkeypatch,path):
    monkeypatch.setattr(settings,'AGENT_RECOVERY_READ_ONLY',True)
    monkeypatch.setattr(settings,'AGENT_V2_RECOVERY_READ_ONLY',True)
    app=FastAPI()
    app.include_router(agent_router.router,prefix='/api/v1')
    app.include_router(agent_v2_router.router,prefix='/api/v1/agent-v2')
    app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id=17)
    def forbidden():raise AssertionError('Recovery reached a business database')
    app.dependency_overrides[get_db]=forbidden
    with TestClient(app) as client:
        response=client.post(path,json={'user_id':999,'session_id':'synthetic'})
    assert response.status_code==503
    assert response.json()['detail']['code']=='agent_recovery_read_only'


def test_recovery_keeps_manual_request_decisions_and_history_activation_separate(monkeypatch):
    monkeypatch.setattr(settings,'AGENT_RECOVERY_READ_ONLY',True)
    for method,path in [('GET','/api/v1/agent/sessions'),
        ('POST','/api/v1/agent/session/synthetic/activate'),
        ('PUT','/api/v1/agent/requests/1/status')]:
        agent_recovery.guard_v1(Request({'type':'http','method':method,'path':path,'headers':[]}))


def test_concurrent_gateway_headers_use_only_authenticated_actor(monkeypatch):
    monkeypatch.setattr(settings,'AGENT_SECRET','synthetic-service')
    monkeypatch.setattr(settings,'AGENT_V2_SECRET','synthetic-v2-service')
    def v1_transport(service,request,**options):
        assert request.get_header('X-agent-caller')=='dmb'
        return b'{}'
    monkeypatch.setattr(agent_router,'request_with_resilience',v1_transport)
    @contextmanager
    def v2_transport(request,**options):
        assert request.get_header('X-agent-caller')=='dmb'
        yield SimpleNamespace(status=200,read=lambda:b'{}',headers={'Content-Type':'application/json'})
    monkeypatch.setattr(agent_v2_gateway,'_opener',SimpleNamespace(open=v2_transport))
    app=FastAPI();router=APIRouter(dependencies=[Depends(agent_recovery.bind_actor)])
    async def identity(request:Request):return SimpleNamespace(id=int(request.headers['x-test-actor']))
    app.dependency_overrides[get_current_user]=identity
    @router.post('/probe')
    async def probe(request:Request):
        forged=await request.json()
        await asyncio.sleep(0)
        headers=agent_router._agent_headers()
        agent_router._call_agent('POST','/synthetic',forged)
        agent_v2_gateway.proxy_request(method='POST',path='synthetic',body=b'{"user_id":999}')
        return {'actor':headers['X-Actor-Ref']}
    app.include_router(router)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
            values=await asyncio.gather(*(client.post('/probe',headers={'X-Test-Actor':str(actor)},
                json={'user_id':999,'role':'admin'}) for actor in (17,18)))
        assert [response.json()['actor'] for response in values]==['17','18']
    asyncio.run(run())
    assert agent_recovery.trusted_headers()=={}
