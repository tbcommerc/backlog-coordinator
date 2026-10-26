from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from auth import get_current_user
from models import User
from services.assistant_v2_gateway import issue_actor_envelope, pilot_allowed, proxy_request


router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def gateway(path: str, request: Request, current_user: User = Depends(get_current_user)):
    request_id = getattr(request.state, "request_id", None) or request.headers.get("X-Request-ID") or "unknown"
    trace_id = getattr(request.state, "trace_id", None) or request.headers.get("X-Trace-ID") or request_id
    if not pilot_allowed(current_user):
        return JSONResponse(
            status_code=403,
            content={
                "error": {
                    "code": "pilot_not_allowed",
                    "message": "Пользователь не включён в пилот Assistant V2.",
                    "details": {},
                    "request_id": request_id,
                    "trace_id": trace_id,
                    "retryable": False,
                }
            },
        )
    body = await request.body()
    actor_envelope = issue_actor_envelope(
        current_user,
        request_id=request_id,
        trace_id=trace_id,
        purpose=f"{request.method.lower()}:{path}",
    )
    status_code, payload, content_type = await asyncio.to_thread(
        proxy_request,
        method=request.method,
        path=path,
        query=request.url.query,
        body=body,
        content_type=request.headers.get("Content-Type"),
        idempotency_key=request.headers.get("Idempotency-Key"),
        request_id=request_id,
        trace_id=trace_id,
        actor_envelope=actor_envelope,
    )
    return Response(
        content=payload,
        status_code=status_code,
        media_type=content_type.split(";", 1)[0],
        headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id},
    )

