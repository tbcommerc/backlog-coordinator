"""ASGI boundary tests without database connections or persisted users."""
import asyncio
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
import pytest
from config import settings
from database import get_db
from services.auth_limits import sensitive_limit


def test_public_http_headers_origin_and_private_validation(monkeypatch):
    from main import app
    monkeypatch.setattr(settings,'AUTH_ORIGINS',['http://127.0.0.1:8000'])
    app.dependency_overrides[get_db]=lambda:MagicMock()
    app.dependency_overrides[sensitive_limit]=lambda:None
    try:
        client=TestClient(app,base_url='http://127.0.0.1:8000')
        response=client.get('/api/v1/auth/password-policy')
        assert response.status_code==200
        assert response.headers['cache-control']=='no-store'
        assert response.headers['referrer-policy']=='no-referrer'
        assert response.headers['x-content-type-options']=='nosniff'
        response=client.post('/api/v1/auth/password/setup',headers={'Origin':'https://evil.example'},json={'token':'secret','new_password':'secret'})
        assert response.status_code==403
        response=client.post('/api/v1/auth/password/setup',headers={'Origin':'http://127.0.0.1:8000'},json={'token':'secret','new_password':'secret','role_id':1})
        assert response.status_code==422
        assert 'secret' not in response.text
        response=client.get('/api/v1/auth/password-policy',headers={'Host':'evil.example'})
        assert response.status_code==400
    finally:
        app.dependency_overrides.pop(get_db,None)
        app.dependency_overrides.pop(sensitive_limit,None)


def test_sse_closed_when_server_session_is_revoked(monkeypatch):
    from account_middleware import AccountSecurityMiddleware
    import auth,database
    monkeypatch.setattr(auth,'decode_token',lambda _:dict(sub='1',sid='session',auth_version=1,type='access'))
    db=MagicMock();db.get.return_value=None
    session_factory=MagicMock();session_factory.return_value.__enter__.return_value=db
    monkeypatch.setattr(database,'SessionLocal',session_factory)
    original_wait=asyncio.wait
    async def fast_wait(tasks,timeout):return await original_wait(tasks,timeout=0.01)
    monkeypatch.setattr(asyncio,'wait',fast_wait)
    stopped=[];sent=[]
    async def app(scope,receive,send):
        await send({'type':'http.response.start','status':200,'headers':[(b'content-type',b'text/event-stream')]})
        try:
            await asyncio.sleep(30)
        finally:stopped.append(True)
    async def receive():return {'type':'http.request','body':b''}
    async def send(message):sent.append(message)
    scope={'type':'http','method':'GET','path':'/api/v1/events/stream','headers':[(b'authorization',b'Bearer synthetic')]}
    asyncio.run(AccountSecurityMiddleware(app)(scope,receive,send))
    assert stopped==[True]
    assert sent[-1]=={'type':'http.response.body','body':b'','more_body':False}


@pytest.mark.parametrize('path',['/api/v1/auth/refresh','/api/v1/notifications','/api/v1/tasks/1/viewers','/api/v1/tasks/1/lock','/api/v1/agent/status'])
def test_passive_requests_do_not_touch_activity(monkeypatch,path):
    from account_middleware import AccountSecurityMiddleware
    import auth,database
    monkeypatch.setattr(auth,'decode_token',lambda _:dict(sub='1',sid='session',auth_version=1,type='access'))
    session_factory=MagicMock();monkeypatch.setattr(database,'SessionLocal',session_factory)
    async def app(scope,receive,send):
        await send({'type':'http.response.start','status':200,'headers':[]})
        await send({'type':'http.response.body','body':b'{}'})
    async def receive():return {'type':'http.request','body':b''}
    async def send(message):pass
    asyncio.run(AccountSecurityMiddleware(app)({'type':'http','method':'GET','path':path,'headers':[(b'authorization',b'Bearer synthetic')]},receive,send))
    session_factory.assert_not_called()
