"""Authenticated real-time invalidation stream without long-lived DB sessions."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse

from auth import (
    decode_token,
    get_request_review_access,
    is_customer_portal_only,
    security,
    task_read_scope_team_id,
)
from config import settings
from database import SessionLocal
from models import Report, RequirementRequest, Task, User
from metrics import add_gauge, inc_counter, set_gauge


router = APIRouter()
logger = logging.getLogger("dmb_backlog.event_stream")


@dataclass(frozen=True)
class EventStreamPrincipal:
    user_id: int
    readable_team_id: int | None
    team_id: int | None
    request_review_scope: str
    customer_portal_only: bool


def get_event_stream_principal(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> EventStreamPrincipal:
    """Authenticate eagerly so no pooled DB session lives for the SSE lifetime."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if payload is None or payload.get("type") != "access" or payload.get("sub") is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    from auth import get_current_user
    with SessionLocal() as db:
        get_current_user(credentials, db)
    principal = _load_principal(int(payload["sub"]))
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or access revoked")
    return principal


def _load_principal(user_id: int) -> EventStreamPrincipal | None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(
            User.id == user_id,
            User.is_active == True,
        ).first()
        if not user:
            return None
        return EventStreamPrincipal(
            user_id=user.id,
            readable_team_id=task_read_scope_team_id(user),
            team_id=user.team_id,
            request_review_scope=get_request_review_access(user),
            customer_portal_only=is_customer_portal_only(user),
        )
    finally:
        db.close()


def _stream_event_visible(fields: dict, principal: EventStreamPrincipal) -> bool:
    if fields.get("aggregate_type") == "work":
        from services.work_tasks import get_work
        try:
            with SessionLocal() as db:
                user = db.get(User, principal.user_id)
                if not user or not user.is_active:
                    return False
                get_work(db, int(fields.get("aggregate_id") or 0), user)
                return True
        except (HTTPException, ValueError, TypeError):
            return False
    audience = fields.get("audience_user_id")
    if audience:
        return audience == str(principal.user_id)
    aggregate_type = fields.get("aggregate_type")
    if aggregate_type == "task_collection":
        return not principal.customer_portal_only
    try:
        payload = json.loads(fields.get("payload") or "{}")
    except (json.JSONDecodeError, TypeError):
        payload = {}

    if aggregate_type == "requirement":
        owner_user_id = payload.get("owner_user_id")
        team_id = payload.get("team_id")
        if owner_user_id is None or "team_id" not in payload:
            try:
                requirement_id = int(fields.get("aggregate_id") or 0)
            except (TypeError, ValueError):
                return False
            db = SessionLocal()
            try:
                row = db.query(
                    RequirementRequest.user_id,
                    RequirementRequest.team_id,
                ).filter(RequirementRequest.id == requirement_id).first()
                if not row:
                    return False
                owner_user_id, team_id = row
            finally:
                db.close()
        if int(owner_user_id or 0) == principal.user_id:
            return True
        if principal.request_review_scope == "all":
            return True
        return (
            principal.request_review_scope == "team"
            and principal.team_id is not None
            and principal.team_id == team_id
        )

    if aggregate_type == "report":
        if principal.customer_portal_only:
            return False
        created_by = payload.get("created_by")
        is_public = payload.get("is_public")
        report_type = payload.get("report_type")
        if report_type is None:
            try:
                report_id = int(fields.get("aggregate_id") or 0)
            except (TypeError, ValueError):
                return False
            db = SessionLocal()
            try:
                row = db.query(Report.created_by, Report.is_public, Report.type).filter(
                    Report.id == report_id
                ).first()
                if not row:
                    return False
                created_by, is_public, report_type = row
            finally:
                db.close()
        return report_type == "standard" or bool(is_public) or created_by == principal.user_id

    if aggregate_type != "task" or principal.customer_portal_only:
        return False
    try:
        task_id = int(fields.get("aggregate_id") or 0)
    except (TypeError, ValueError):
        return False
    if not task_id:
        return False
    db = SessionLocal()
    try:
        row = db.query(Task.id, Task.team_id).filter(Task.id == task_id).first()
        if not row:
            return False
        return principal.readable_team_id is None or row.team_id == principal.readable_team_id
    finally:
        db.close()


def _serialize_stream_event(fields: dict) -> str:
    try:
        payload = json.loads(fields.get("payload") or "{}")
    except (json.JSONDecodeError, TypeError):
        payload = {}

    def as_int(value):
        try:
            return int(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return json.dumps({
        "event_id": as_int(fields.get("event_id")),
        "type": fields.get("event_type"),
        "aggregate": {
            "type": fields.get("aggregate_type"),
            "id": as_int(fields.get("aggregate_id")),
            "version": as_int(fields.get("aggregate_version")),
        },
        "payload": payload,
    }, ensure_ascii=False, separators=(",", ":"))


@router.get("/events/stream")
async def event_stream(
    request: Request,
    after: Optional[str] = None,
    principal: EventStreamPrincipal = Depends(get_event_stream_principal),
):
    """SSE backed by Redis Streams with cursor replay and access filtering."""
    if not settings.REDIS_URL:
        raise HTTPException(status_code=503, detail="Поток событий временно недоступен")

    from redis.asyncio import Redis

    redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await redis_client.ping()
        set_gauge("dmb_dependency_up", 1, {"dependency": "redis"})
        cursor = after or request.headers.get("last-event-id") or "$"
        if cursor != "$" and not re.fullmatch(r"\d+-\d+", cursor):
            cursor = "$"
        if cursor == "$":
            latest = await redis_client.xrevrange(settings.EVENT_STREAM_NAME, count=1)
            cursor = latest[0][0] if latest else "0-0"
    except Exception as exc:
        set_gauge("dmb_dependency_up", 0, {"dependency": "redis"})
        inc_counter("dmb_sse_connection_errors_total", labels={"error": type(exc).__name__})
        await redis_client.aclose()
        logger.warning("Redis event stream unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Поток событий временно недоступен") from exc

    async def generate():
        nonlocal cursor
        current_principal = principal
        next_principal_refresh = time.monotonic() + 60
        inc_counter("dmb_sse_connections_opened_total")
        add_gauge("dmb_sse_active_connections", 1)
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                if time.monotonic() >= next_principal_refresh:
                    refreshed = await asyncio.to_thread(_load_principal, current_principal.user_id)
                    if refreshed is None:
                        inc_counter("dmb_sse_auth_revocations_total")
                        yield "event: auth.revoked\ndata: {}\n\n"
                        return
                    current_principal = refreshed
                    next_principal_refresh = time.monotonic() + 60
                rows = await redis_client.xread(
                    {settings.EVENT_STREAM_NAME: cursor},
                    count=100,
                    block=15000,
                )
                if not rows:
                    yield ": keepalive\n\n"
                    continue
                for _, entries in rows:
                    last_visible_id = None
                    for stream_id, fields in entries:
                        cursor = stream_id
                        visible = await asyncio.to_thread(_stream_event_visible, fields, current_principal)
                        if not visible:
                            continue
                        last_visible_id = stream_id
                        event_type = fields.get("event_type") or "message"
                        yield (
                            f"id: {stream_id}\n"
                            f"event: {event_type}\n"
                            f"data: {_serialize_stream_event(fields)}\n\n"
                        )
                    if entries and last_visible_id != cursor:
                        # Advance the private client cursor past events outside
                        # its access scope without disclosing their contents.
                        yield f"id: {cursor}\nevent: stream.cursor\ndata: {{}}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception:
            inc_counter("dmb_sse_stream_errors_total")
            logger.exception("SSE event stream interrupted")
        finally:
            add_gauge("dmb_sse_active_connections", -1)
            inc_counter("dmb_sse_connections_closed_total")
            await redis_client.aclose()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
