"""ASGI readiness must include the coordinator promised by the launch profile."""
import asyncio
import json
import os

from .limiter import from_environment,limiter_metadata
from .model import AgentError


class LimiterReadiness:
    paths = {"/ready", "/health/ready", "/api/agent/ready", "/api/agent-v2/ready"}

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"]=="http":
            expected=dict(scope.get("headers",[])).get(b"x-agent-limiter-ref")
            if expected is not None:
                try:
                    actual=limiter_metadata()["scope_ref"]
                    matched=actual is not None and expected.decode("ascii")==actual
                except (AgentError,UnicodeError):
                    matched=False
                if not matched:
                    body=b'{"error":{"code":"operation_profile_mismatch","message":"operation_profile_mismatch","retryable":false,"details":{}}}'
                    await send({"type":"http.response.start","status":503,"headers":[(b"content-type",b"application/json")]})
                    return await send({"type":"http.response.body","body":body})
        backlog_ready = scope.get("path") == "/health" and os.environ.get("DMB_AGENT_SERVICE_ID") == "backlog-assistant"
        if scope["type"] != "http" or scope.get("path") not in self.paths and not backlog_ready:
            return await self.app(scope, receive, send)
        try:
            limiter = from_environment()
            if limiter is not None:
                await asyncio.to_thread(limiter.bootstrap)
        except AgentError:
            body = json.dumps({"status": "unavailable", "reason": "operation_limiter_unavailable"}).encode()
            await send({"type": "http.response.start", "status": 503,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            return await send({"type": "http.response.body", "body": body})
        await self.app(scope, receive, send)
