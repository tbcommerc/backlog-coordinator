"""Origin enforcement, privacy headers and periodic stream revocation checks."""
import asyncio
from starlette.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from config import settings


class AccountSecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        headers = dict(scope.get('headers', []))
        sensitive = path.startswith('/api/v1/auth') or path.startswith('/api/v1/admin/users') or path.startswith('/api/v1/admin/roles') or path.startswith('/api/v1/admin/security-events')
        if sensitive and scope['method'] not in {'GET', 'HEAD', 'OPTIONS'}:
            origin = headers.get(b'origin', b'').decode()
            if (not origin and not settings.DEBUG) or (origin and origin not in settings.AUTH_ORIGINS):
                return await JSONResponse({'detail': 'UNTRUSTED_ORIGIN'}, 403)(scope, receive, send)
        payload = None
        auth = headers.get(b'authorization', b'').decode()
        if auth.startswith('Bearer '):
            from auth import decode_token
            payload = decode_token(auth[7:])
        streaming = False
        started = False
        status = 500

        async def secured_send(message):
            nonlocal streaming, started, status
            if message['type'] == 'http.response.start':
                started, status = True, message['status']
                failure_key = scope.get('state', {}).get('credential_failure_key')
                if failure_key and status in {400, 401, 422}:
                    from services.auth_limits import limit
                    from fastapi import HTTPException
                    try:
                        await limit('credential-failures', failure_key, settings.AUTH_FAILURE_LIMIT, settings.AUTH_FAILURE_WINDOW)
                    except HTTPException:
                        pass
                response_headers = list(message.get('headers', []))
                streaming = any(k.lower() == b'content-type' and b'text/event-stream' in v for k, v in response_headers)
                response_headers += [(b'referrer-policy', b'no-referrer'), (b'x-content-type-options', b'nosniff'),
                    (b'content-security-policy', b"frame-ancestors 'none'; object-src 'none'; base-uri 'none'")]
                if sensitive or path in {'/', '/index.html'}:
                    response_headers += [(b'cache-control', b'no-store')]
                message['headers'] = response_headers
            await send(message)

        def check(touch=False):
            from database import SessionLocal
            from models import User, AuthSession
            from services.auth_sessions import check_session, now
            with SessionLocal() as db:
                user = db.get(User, int(payload['sub']))
                if not user:
                    return False
                try:
                    session = check_session(db, user, payload['sid'], payload['auth_version'])
                except Exception:
                    return False
                if touch:
                    db.query(AuthSession).filter(AuthSession.id == session.id, AuthSession.revoked_at.is_(None)).update({'last_activity_at': now()})
                    db.commit()
                return True

        task = asyncio.create_task(self.app(scope, receive, secured_send))
        try:
            while not task.done():
                done, _ = await asyncio.wait({task}, timeout=5)
                if not done and streaming and payload and not await run_in_threadpool(check):
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
                    return
            await task
            passive = path.startswith(('/api/v1/auth', '/api/v1/notifications', '/api/v1/events', '/api/v1/health')) or path.endswith(('/status', '/heartbeat', '/viewers', '/lock')) or (scope['method'] == 'GET' and path.startswith('/api/v1/backlog-assistant/runs/'))
            if payload and payload.get('type') == 'access' and status < 400 and not passive and not streaming:
                await run_in_threadpool(check, True)
        finally:
            if not task.done():
                task.cancel()
