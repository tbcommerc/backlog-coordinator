"""
DMB Backlog - AI Business Analyst Assistant integration.

The DMB backend is the only caller of the agent service. It manages the
mapping user -> agent session and keeps the customer Request continuous from
AI draft through human review into an internal delivery Task.
"""
import json
import logging
import threading
import time
import urllib.request
import urllib.error
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.exc import IntegrityError

from auth import get_current_user, get_request_review_access, is_customer_portal_only
from config import settings
from database import get_db
from models import AgentSession, RequirementRequest, Role, Task, TaskStatus, User, Team
from notifications import notify_assignment, notify_request_decision
from metrics import inc_counter, observe_histogram
from interservice import request_with_resilience
from requirement_artifacts import (
    append_revision, append_status_event, current_revision_history,
    draft_fingerprint, ensure_request_history, render_request,
)

logger = logging.getLogger("agent_integration")
from services.agent_recovery import bind_actor,guard_v1,trusted_headers

router = APIRouter(dependencies=[Depends(bind_actor),Depends(guard_v1)])

# Serialises submissions for the same dialogue inside a worker. The database
# constraint on RequirementRequest is the cross-worker safety net.
_submission_locks: dict[str, tuple[threading.Lock, int]] = {}
_submission_locks_guard = threading.Lock()


@contextmanager
def _submission_lock(session_id: str):
    with _submission_locks_guard:
        lock, users = _submission_locks.get(session_id, (threading.Lock(), 0))
        _submission_locks[session_id] = (lock, users + 1)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
        with _submission_locks_guard:
            current_lock, users = _submission_locks.get(session_id, (lock, 1))
            if current_lock is lock and users <= 1:
                _submission_locks.pop(session_id, None)
            elif current_lock is lock:
                _submission_locks[session_id] = (lock, users - 1)


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str = ""
    message_id: str = Field(default_factory=lambda: uuid.uuid4().hex, max_length=64)


class AgentSendForReviewRequest(BaseModel):
    session_id: str
    title: str = ""
    team_id: int = None
    expected_draft_hash: str = Field(default="", max_length=64)


class AgentDraftSectionEditRequest(BaseModel):
    session_id: str
    field: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=5000)


class AgentRequestStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    version: int = Field(ge=0)
    reject_reason: str = ""
    assignee_id: int = None
    team_id: int = None
    action_reason: str = Field(default="", max_length=2000)
    finding_resolutions: list[dict] = Field(default_factory=list)


class AgentUxEvent(BaseModel):
    event: str = Field(min_length=1, max_length=40)
    outcome: str = Field(default="ok", min_length=1, max_length=24)
    duration_ms: int | None = Field(default=None, ge=0, le=300_000)


_AGENT_UX_EVENTS = {
    "chat_opened", "message_sent", "response_received", "response_empty",
    "draft_ready", "request_sent", "request_opened", "session_reopened",
    "answer_copied", "answer_feedback", "request_failed", "wait_cancelled",
}
_AGENT_UX_OUTCOMES = {"ok", "helpful", "problem", "error", "cancelled", "empty"}


REQUEST_STATUSES = {"draft", "submitted", "in_review", "in_progress", "approved", "rejected", "returned"}
REQUEST_STATUS_TRANSITIONS = {
    "submitted": {"in_review"},
    # The author must resubmit a revision before a reviewer can claim it.
    "returned": set(),
    "in_review": {"submitted", "in_review", "in_progress", "returned", "rejected"},
    "in_progress": {"approved"},
    "approved": set(),
    "rejected": set(),
    "draft": {"submitted"},
}
TEAM_REQUEST_REVIEWER_ROLES = {
    "po/pl/cl",
    "ba/участник команды",
    "лидер трайба",
    # Совместимость с прежним названием роли.
    "ba/бизнес-аналитик",
}
GLOBAL_REQUEST_REVIEWER_ROLES = {
    "проектный офис (админ)",
    # Совместимость с текущей seed-ролью.
    "администратор",
}
ASSIGNABLE_REQUEST_ANALYST_ROLES = {
    "ba/участник команды",
    # Совместимость с прежним названием роли.
    "ba/бизнес-аналитик",
}


def can_review_request(user: User, request_team_id: int | None) -> bool:
    """Проверить область ревью запроса по актуальной матрице ролей."""
    scope = get_request_review_access(user)
    if scope == "all":
        return True
    return (
        scope == "team"
        and user.team_id is not None
        and user.team_id == request_team_id
    )


def _agent_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-Agent-Secret": settings.AGENT_SECRET,
        **trusted_headers(),
    }


def _call_agent(method: str, path: str, payload: dict | None = None) -> dict:
    """Call the agent service; returns parsed JSON or raises HTTPException."""
    url = f"{settings.AGENT_BASE_URL.rstrip('/')}{path}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=_agent_headers(), method=method)
    started_at = time.monotonic()
    outcome = "success"
    try:
        # Creating a session has no idempotency key; retrying after a lost
        # response could create an orphan. All other mutations here are set-like
        # or carry their own stable request/session identifiers.
        attempts = 1 if method == "POST" and path in {"/api/agent/new-session", "/api/agent/meetings/extract"} else settings.INTERSERVICE_MAX_ATTEMPTS
        body = request_with_resilience(
            "agent", req,
            timeout=settings.AGENT_TIMEOUT_SECONDS,
            attempts=attempts,
            base_delay=settings.INTERSERVICE_RETRY_BASE_SECONDS,
            failure_threshold=settings.INTERSERVICE_CIRCUIT_FAILURE_THRESHOLD,
            reset_seconds=settings.INTERSERVICE_CIRCUIT_RESET_SECONDS,
        )
        return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as e:
        outcome = f"http_{e.code}"
        body = e.read(4096).decode("utf-8", errors="replace")[:300]
        logger.error("agent %s %s -> %s", method, path, e.code)
        if path == "/api/agent/meetings/extract" and e.code == 503:
            try:
                detail = json.loads(body).get("detail")
            except json.JSONDecodeError:
                detail = None
            from services.meeting_analysis import ERROR_MESSAGES
            code = detail.get("code") if isinstance(detail, dict) else None
            if isinstance(code, str) and code in {"meeting_ai_auth", "meeting_ai_quota", "interrupted", "operation_limit", "invalid_result"}:
                raise HTTPException(status_code=503, detail={
                    "code": code, "message": ERROR_MESSAGES[code],
                }) from None
        if e.code == 409:
            try:
                detail = json.loads(body).get("detail") or "Диалог уже изменён другим запросом"
            except json.JSONDecodeError:
                detail = "Диалог уже изменён другим запросом"
            raise HTTPException(status_code=409, detail=detail)
        raise HTTPException(status_code=502, detail=f"Агент недоступен ({e.code})")
    except (OSError, TimeoutError, UnicodeError, json.JSONDecodeError):
        outcome = "transport_error"
        logger.exception("agent %s %s failed", method, path)
        raise HTTPException(status_code=502, detail="Сервис аналитика недоступен")
    finally:
        labels = {"method": method, "outcome": outcome}
        inc_counter("dmb_agent_requests_total", labels=labels)
        observe_histogram("dmb_agent_request_duration_seconds", time.monotonic() - started_at, {"method": method})


def _compensate_review_submission(session_id: str, request_id: int, user_id: int) -> None:
    """Best-effort saga compensation after the coordinator transaction rolls back."""
    try:
        response = _call_agent("POST", "/api/agent/cancel-review", {
            "session_id": session_id,
            "task_id": request_id,
            "user_id": user_id,
        })
        if response.get("success") is False or response.get("action") == "error":
            logger.error(
                "agent review compensation rejected session_id=%s request_id=%s",
                session_id, request_id,
            )
    except Exception:
        logger.exception(
            "agent review compensation failed session_id=%s request_id=%s",
            session_id, request_id,
        )


def _user_context(user: User) -> dict:
    role = user.role_name or ""
    team = user.team_name or ""
    return {
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role_name": role,
        "team_name": team,
        "department": team,
        "is_ba": role.lower() in ("ba", "po", "бизнес-аналитик", "бизнес аналитик"),
    }


def _get_or_create_agent_session(db: Session, user: User) -> str:
    row = db.query(AgentSession).filter(AgentSession.user_id == user.id).first()
    if row:
        return row.agent_session_id
    resp = _call_agent("POST", "/api/agent/new-session",
                       {"user_id": user.id, "context": _user_context(user)})
    agent_session_id = resp.get("session_id")
    if not agent_session_id:
        raise HTTPException(status_code=502, detail="Агент не вернул session_id")
    db.add(AgentSession(user_id=user.id, agent_session_id=agent_session_id))
    db.commit()
    return agent_session_id


def _set_active_agent_session(db: Session, user: User, agent_session_id: str):
    row = db.query(AgentSession).filter(AgentSession.user_id == user.id).first()
    if row:
        row.agent_session_id = agent_session_id
    else:
        db.add(AgentSession(user_id=user.id, agent_session_id=agent_session_id))
    db.commit()


def _user_session_ids(db: Session, user: User) -> set[str]:
    resp = _call_agent("GET", f"/api/agent/sessions?user_id={user.id}")
    return {s["session_id"] for s in (resp.get("sessions") or [])}


def _render_request(draft: dict) -> str:
    return render_request(draft)


def _commit_resubmitted_request(
    db: Session, request: RequirementRequest, resp: dict, user_id: int,
) -> dict:
    """Commit one returned-request revision behind a single transaction boundary."""
    submitted_hash = draft_fingerprint(request.draft)
    request_id, session_id = request.id, request.agent_session_id
    committed = False
    try:
        db.commit()
        committed = True
        resp.update({
            "request_id": request.id,
            "request_status": request.status,
            "request_version": request.version or 0,
            "request_url": f"#/customer/request/{request.id}",
            "resubmitted": True,
        })
        return resp
    except StaleDataError:
        db.rollback()
        current = db.query(RequirementRequest).filter(RequirementRequest.id == request_id).first()
        if current and current.status != "returned" and draft_fingerprint(current.draft or {}) == submitted_hash:
            return _sent_request_response(current, duplicate=True)
        _compensate_review_submission(session_id, request_id, user_id)
        raise HTTPException(status_code=409, detail={
            "code": "request_version_conflict",
            "message": "Запрос изменился во время отправки. Правки сохранены в диалоге; обновите запрос и отправьте их повторно.",
            "request_id": request_id,
            "current_version": current.version if current else None,
        })
    except Exception:
        db.rollback()
        if not committed:
            _compensate_review_submission(session_id, request_id, user_id)
        raise


def _request_deadline(req: RequirementRequest) -> str | None:
    # A desired delivery date is not a review SLA. Until a dedicated review
    # deadline is configured, expose stage age instead of inventing lateness.
    return getattr(req, "review_deadline", None)


def _request_stage_started_at(req: RequirementRequest) -> str | None:
    events = getattr(req, "status_history", None) or []
    matching = [event for event in events if event.get("status") == req.status and event.get("created_at")]
    if matching:
        return matching[-1]["created_at"]
    value = getattr(req, "updated_at", None) or getattr(req, "created_at", None)
    return value.isoformat() if hasattr(value, "isoformat") else value


def _deadline_is_overdue(value: str | None, status: str) -> bool:
    if not value or status in {"in_progress", "approved", "rejected", "completed", "not_relevant", "task_rejected", "task_deleted"}:
        return False
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return date.fromisoformat(raw) < datetime.now(timezone.utc).date()
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed < datetime.now(timezone.utc)
    except ValueError:
        return False


def _request_available_actions(req: RequirementRequest, current_user: User | None) -> list[str]:
    if current_user is None or not can_review_request(current_user, req.team_id):
        return []
    if req.status == "submitted":
        return ["claim"]
    if req.status == "in_review" and req.reviewer_id == current_user.id:
        actions = ["approve", "return", "reject", "release"]
        if get_request_review_access(current_user) == "all":
            actions.append("reroute")
        return actions
    return []


def _request_to_dict(req: RequirementRequest, current_user: User | None = None, *, effective_status=None) -> dict:
    from services.request_state import effective_state, lifecycle_actions, follow_up_due, FOLLOW_UP
    session = object_session(req)
    effective = effective_status or (effective_state(session, req) if session else req.status)
    reviewer = bool(current_user and not is_customer_portal_only(current_user) and can_review_request(current_user, req.team_id))
    review_deadline = _request_deadline(req)
    stage_started_at = _request_stage_started_at(req)
    return {
        "id": req.id,
        "title": req.title,
        "description": req.description,
        "draft": req.draft,
        "status": req.status,
        "effective_status": effective,
        "coordinator_id": req.coordinator_id,
        "coordinator_name": req.coordinator.name if req.coordinator else None,
        "next_action": req.next_action,
        "next_action_due": req.next_action_due.isoformat() if req.next_action_due else None,
        "follow_up_due": follow_up_due(req),
        "lifecycle_actions": lifecycle_actions(req, current_user, reviewer, effective) if current_user else [],
        "needs_follow_up": effective in FOLLOW_UP or follow_up_due(req),
        "agent_session_id": req.agent_session_id,
        "user_id": req.user_id,
        "team_id": req.team_id,
        "team_name": req.team.name if req.team else None,
        "reviewer_id": req.reviewer_id,
        "reviewer_name": req.reviewer.name if req.reviewer else None,
        "assignee_id": req.assignee_id,
        "assignee_name": req.assignee.name if req.assignee else None,
        "task_id": req.task_id,
        "task_public_id": req.task.public_id if req.task else None,
        "task_status": req.task.status.name if req.task and req.task.status else None,
        "task_progress": req.task.progress if req.task else None,
        "task_deadline": req.task.deadline.name if req.task and req.task.deadline else None,
        "review_deadline": review_deadline,
        "stage_started_at": stage_started_at,
        "is_overdue": _deadline_is_overdue(review_deadline, req.status),
        "available_actions": _request_available_actions(req, current_user),
        "reject_reason": req.reject_reason,
        "version": req.version or 0,
        "revision_history": current_revision_history(req),
        "status_history": getattr(req, "status_history", None) or [],
        "author_name": req.user.name if req.user else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


def _agent_request_context(db: Session, user_id: int, session_id: str) -> dict:
    """Return safe workflow metadata needed to restore a submitted dialogue."""
    req = db.query(RequirementRequest).filter(
        RequirementRequest.user_id == user_id,
        RequirementRequest.agent_session_id == session_id,
        RequirementRequest.is_deleted.is_(False),
    ).order_by(RequirementRequest.updated_at.desc()).first()
    if not req:
        return {}
    return {
        "request_id": req.id,
        "request_status": req.status,
        "request_version": req.version or 0,
        "request_team_id": req.team_id,
        "request_team_name": req.team.name if req.team else None,
        "review_comment": req.reject_reason or "",
        "request_url": f"#/customer/request/{req.id}",
    }


@router.post("/agent/ux-event")
def agent_ux_event(
    event: AgentUxEvent,
    current_user: User = Depends(get_current_user),
):
    """Record low-cardinality interaction telemetry without message content."""
    if event.event not in _AGENT_UX_EVENTS or event.outcome not in _AGENT_UX_OUTCOMES:
        raise HTTPException(status_code=422, detail="Неизвестное UX-событие")
    labels = {"event": event.event, "outcome": event.outcome}
    inc_counter("dmb_agent_ux_events_total", labels=labels)
    if event.duration_ms is not None:
        observe_histogram("dmb_agent_ux_duration_seconds", event.duration_ms / 1000, {"event": event.event})
    return {"success": True}


@router.post("/agent/chat")
def agent_chat(
    req: AgentChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy a chat message to the AI Business Analyst assistant."""
    if req.session_id:
        if req.session_id not in _user_session_ids(db, current_user):
            raise HTTPException(status_code=404, detail="Сессия не найдена")
        agent_session_id = req.session_id
    else:
        agent_session_id = _get_or_create_agent_session(db, current_user)
    resp = _call_agent("POST", "/api/agent/chat", {
        "session_id": agent_session_id,
        "message_id": req.message_id,
        "message": req.message,
        "context": _user_context(current_user),
    })
    return resp


@router.get("/agent/sessions")
def agent_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all dialogues for the current user."""
    resp = _call_agent("GET", f"/api/agent/sessions?user_id={current_user.id}")
    active_row = db.query(AgentSession).filter(AgentSession.user_id == current_user.id).first()
    active_id = active_row.agent_session_id if active_row else None
    for s in (resp.get("sessions") or []):
        s["active"] = s["session_id"] == active_id
        s.update(_agent_request_context(db, current_user.id, s["session_id"]))
    return resp


@router.get("/agent/session/{session_id}")
def agent_session_by_id(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """State of a specific dialogue (for viewing history)."""
    if session_id not in _user_session_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    try:
        resp = _call_agent("GET", f"/api/agent/session/{session_id}")
    except HTTPException:
        return {"active": False}
    active_row = db.query(AgentSession).filter(AgentSession.user_id == current_user.id).first()
    resp["active"] = bool(active_row and active_row.agent_session_id == session_id)
    resp.update(_agent_request_context(db, current_user.id, session_id))
    return resp


@router.post("/agent/new-dialog")
def agent_new_dialog(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new dialogue and make it active."""
    resp = _call_agent("POST", "/api/agent/new-session",
                       {"user_id": current_user.id, "context": _user_context(current_user)})
    agent_session_id = resp.get("session_id")
    if not agent_session_id:
        raise HTTPException(status_code=502, detail="Агент не вернул session_id")
    _set_active_agent_session(db, current_user, agent_session_id)
    resp["active"] = True
    resp.update(_agent_request_context(db, current_user.id, agent_session_id))
    return resp


@router.post("/agent/chat-stream")
def agent_chat_stream(
    req: AgentChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Relay the agent SSE stream without buffering user-facing deltas."""
    if req.session_id:
        if req.session_id not in _user_session_ids(db, current_user):
            raise HTTPException(status_code=404, detail="Сессия не найдена")
        agent_session_id = req.session_id
    else:
        agent_session_id = _get_or_create_agent_session(db, current_user)

    payload = {
        "session_id": agent_session_id,
        "message_id": req.message_id,
        "message": req.message,
        "context": _user_context(current_user),
    }
    url = f"{settings.AGENT_BASE_URL.rstrip('/')}/api/agent/chat-stream"
    headers = _agent_headers()
    headers["Accept"] = "text/event-stream"
    upstream_request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    started_at = time.monotonic()
    try:
        upstream = urllib.request.urlopen(upstream_request, timeout=settings.AGENT_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        logger.error("agent stream POST /api/agent/chat-stream -> %s: %s", exc.code, detail)
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="Сессия не найдена") from exc
        raise HTTPException(status_code=502, detail=f"Агент недоступен ({exc.code})") from exc
    except (OSError, TimeoutError, UnicodeError) as exc:
        logger.exception("agent stream POST /api/agent/chat-stream failed")
        raise HTTPException(status_code=502, detail="Сервис аналитика недоступен") from exc

    def relay():
        outcome = "success"
        try:
            for line in upstream:
                yield line
        except (OSError, TimeoutError):
            outcome = "transport_error"
            logger.exception("agent stream relay failed")
            yield 'event: error\ndata: {"code":"relay_failed","message":"Поток ответа прерван"}\n\n'.encode("utf-8")
        finally:
            upstream.close()
            labels = {"method": "POST_STREAM", "outcome": outcome}
            inc_counter("dmb_agent_requests_total", labels=labels)
            observe_histogram(
                "dmb_agent_request_duration_seconds",
                time.monotonic() - started_at,
                {"method": "POST_STREAM"},
            )

    return StreamingResponse(
        relay(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/agent/session/{session_id}/activate")
def agent_activate_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Make one of the current user's dialogues active across reloads."""
    if session_id not in _user_session_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    _set_active_agent_session(db, current_user, session_id)
    return {"success": True, "session_id": session_id, "active": True}


@router.post("/agent/session/{session_id}/archive")
def agent_archive_session(
    session_id: str,
    archived: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Move a dialogue to or from the user's archive."""
    if session_id not in _user_session_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return _call_agent("POST", f"/api/agent/session/{session_id}/archive?archived={str(archived).lower()}")


@router.get("/agent/session")
def agent_session_state(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Current agent session state (for resume)."""
    row = db.query(AgentSession).filter(AgentSession.user_id == current_user.id).first()
    if not row:
        return {"active": False}
    try:
        resp = _call_agent("GET", f"/api/agent/session/{row.agent_session_id}")
    except HTTPException:
        return {"active": False}
    resp["active"] = True
    resp.update(_agent_request_context(db, current_user.id, row.agent_session_id))
    return resp


@router.post("/agent/reset")
def agent_reset(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drop the current user's agent session."""
    row = db.query(AgentSession).filter(AgentSession.user_id == current_user.id).first()
    if row:
        try:
            _call_agent("POST", "/api/agent/reset", {"session_id": row.agent_session_id})
        except HTTPException:
            pass
        db.delete(row)
        db.commit()
    return {"success": True}


def _sent_request_response(request: RequirementRequest, *, duplicate: bool = False) -> dict:
    return {
        "success": True, "session_id": request.agent_session_id, "action": "sent",
        "message": "Эта редакция уже отправлена на ревью." if duplicate else "Запрос отправлен на ревью.",
        "request_id": request.id, "request_status": request.status,
        "request_version": request.version or 0,
        "request_url": f"#/customer/request/{request.id}",
        "draft": request.draft, "draft_revision": draft_fingerprint(request.draft or {}),
        "duplicate": duplicate,
    }


def _confirmed_snapshot(resp: dict) -> dict:
    if resp.get("action") != "sent" or resp.get("success") is False:
        raise HTTPException(status_code=409, detail={
            "code": "draft_revision_conflict" if resp.get("action") == "revision_conflict" else "draft_not_confirmed",
            "message": resp.get("message") or "Агент не подтвердил отправку черновика",
        })
    if not isinstance(resp.get("draft"), dict) or not resp["draft"]:
        raise HTTPException(status_code=502, detail="Агент не вернул подтверждённую редакцию. Отправка не сохранена.")
    return resp["draft"]


@router.post("/agent/send-for-review")
def agent_send_for_review(
    req: AgentSendForReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a RequirementRequest from the agent draft (no Task is created)."""
    if req.session_id not in _user_session_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    with _submission_lock(req.session_id):
        existing = db.query(RequirementRequest).filter(
            RequirementRequest.agent_session_id == req.session_id,
            RequirementRequest.is_deleted.is_(False),
        ).with_for_update().first()
        state = _call_agent("GET", f"/api/agent/session/{req.session_id}")
        draft = state.get("draft")
        if not draft:
            raise HTTPException(status_code=400, detail="Драфт ещё не готов — продолжите диалог")
        snapshot_hash = draft_fingerprint(draft)
        if req.expected_draft_hash and req.expected_draft_hash != snapshot_hash:
            raise HTTPException(status_code=409, detail={
                "code": "draft_revision_conflict",
                "message": "Черновик изменился после просмотра. Обновите диалог, проверьте изменения и повторите отправку.",
            })

        if existing:
            if existing.status != "returned":
                if draft_fingerprint(existing.draft or {}) != snapshot_hash:
                    raise HTTPException(status_code=409, detail={
                        "code": "request_revision_conflict",
                        "message": "На ревью находится другая редакция. Ваши изменения сохранены в диалоге; новая отправка возможна после возврата запроса.",
                    })
                return _sent_request_response(existing, duplicate=True)
            resp = _call_agent("POST", "/api/agent/send-for-review", {
                "session_id": req.session_id,
                "task_id": existing.id,
                "title": req.title or draft.get("title") or "",
                "user_id": current_user.id,
                "expected_draft_hash": snapshot_hash,
            })
            try:
                confirmed = _confirmed_snapshot(resp)
            except HTTPException:
                if resp.get("action") == "sent":
                    _compensate_review_submission(req.session_id, existing.id, current_user.id)
                raise
            ensure_request_history(existing)
            existing.title = (confirmed.get("title") or existing.title)[:255]
            existing.description = _render_request(confirmed)
            existing.draft = confirmed
            existing.status = "submitted"
            existing.reject_reason = None
            existing.reviewer_id = None
            existing.version = (existing.version or 0) + 1
            append_revision(existing, confirmed, current_user)
            append_status_event(existing, "submitted", current_user)
            return _commit_resubmitted_request(db, existing, resp, current_user.id)

        request = RequirementRequest(
            user_id=current_user.id,
            title=(draft.get("title") or "Запрос на доработку платформы")[:255],
            description=_render_request(draft),
            draft=draft,
            status="submitted",
            agent_session_id=req.session_id,
            team_id=req.team_id or current_user.team_id,
        )
        db.add(request)
        agent_confirmed = False
        committed = False
        try:
            db.flush()
            resp = _call_agent("POST", "/api/agent/send-for-review", {
                "session_id": req.session_id,
                "task_id": request.id,
                "title": req.title or draft.get("title") or "",
                "user_id": current_user.id,
                "expected_draft_hash": snapshot_hash,
            })
            agent_confirmed = resp.get("action") == "sent" and resp.get("success") is not False
            confirmed = _confirmed_snapshot(resp)
            request.title = (confirmed.get("title") or request.title)[:255]
            request.description = _render_request(confirmed)
            request.draft = confirmed
            append_revision(request, confirmed, current_user)
            append_status_event(request, "submitted", current_user)
            db.commit()
            committed = True
            db.refresh(request)
            resp["request_id"] = request.id
            resp["request_status"] = request.status
            resp["request_version"] = request.version or 0
            resp["request_url"] = f"#/customer/request/{request.id}"
            return resp
        except Exception as exc:
            db.rollback()
            if agent_confirmed and not committed:
                _compensate_review_submission(req.session_id, request.id, current_user.id)
            if isinstance(exc, IntegrityError):
                existing = db.query(RequirementRequest).filter(
                    RequirementRequest.agent_session_id == req.session_id,
                    RequirementRequest.is_deleted.is_(False),
                ).first()
                if existing:
                    if draft_fingerprint(existing.draft or {}) == snapshot_hash:
                        return _sent_request_response(existing, duplicate=True)
                    raise HTTPException(status_code=409, detail="Параллельно отправлена другая редакция запроса. Ваши изменения сохранены в диалоге.")
            raise


@router.post("/agent/edit-draft-section")
def agent_edit_draft_section(
    req: AgentDraftSectionEditRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if req.session_id not in _user_session_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    resp = _call_agent("POST", "/api/agent/edit-draft-section", {
        "session_id": req.session_id,
        "field": req.field,
        "value": req.value,
        "user_id": current_user.id,
    })
    if resp.get("action") == "error" or resp.get("success") is False:
        raise HTTPException(status_code=400, detail=resp.get("message") or "Не удалось изменить черновик")
    return resp


@router.get("/agent/requests")
def agent_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The current user's requirement requests (newest first)."""
    rows = (
        db.query(RequirementRequest)
        .filter(RequirementRequest.user_id == current_user.id,
                RequirementRequest.is_deleted.is_(False))
        .order_by(RequirementRequest.created_at.desc())
        .all()
    )
    return [_request_to_dict(r, current_user) for r in rows]


@router.get("/agent/requests/review")
def agent_requests_review(
    limit: int = Query(default=250, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Запросы для ревью в разрешённой пользователю области."""
    review_access = get_request_review_access(current_user)
    if review_access == "none":
        raise HTTPException(status_code=403, detail="Доступ запрещён")

    query = db.query(RequirementRequest).filter(
        RequirementRequest.is_deleted.is_(False),
        RequirementRequest.status.in_(["submitted", "in_review", "in_progress", "returned", "approved", "rejected", "completed", "not_relevant", "task_rejected", "task_deleted", "accepted", "deferred", "withdrawn"]),
    )
    if review_access != "all":
        query = query.filter(RequirementRequest.team_id == current_user.team_id)

    rows = query.order_by(RequirementRequest.created_at.desc()).offset(offset).limit(limit).all()
    return [_request_to_dict(r, current_user) for r in rows]


@router.get("/agent/requests/registry")
def request_registry(q: str = Query('', max_length=200), mode: str = 'all', status: str = 'any',
                     sort: str = 'stage_oldest', signals: bool = False, aged: bool = False,
                     team_ids: str = '', customer_ids: str = '', coordinator_ids: str = '',
                     limit: int = Query(50, ge=1, le=250), offset: int = Query(0, ge=0),
                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from services.request_registry import registry
    return registry(db, current_user, q=q, mode=mode, status=status, sort=sort, signals=signals, aged=aged,
                    team_ids=team_ids, customer_ids=customer_ids, coordinator_ids=coordinator_ids, limit=limit, offset=offset)


from services.request_lifecycle import LifecycleCommand


@router.post('/agent/requests/{request_id}/lifecycle')
def request_lifecycle(request_id: int, body: LifecycleCommand, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from services.request_lifecycle import execute
    return _request_to_dict(execute(db, current_user, request_id, body), current_user)


@router.get('/agent/requests/{request_id}/coordinators')
def request_coordinators(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(RequirementRequest).filter_by(id=request_id, is_deleted=False).first()
    if not req or is_customer_portal_only(current_user) or not can_review_request(current_user, req.team_id): raise HTTPException(404, 'Запрос недоступен')
    return [{'id': u.id, 'name': u.name} for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name)
            if not is_customer_portal_only(u) and can_review_request(u, req.team_id)]


@router.get("/agent/requests/{request_id}")
def agent_request_detail(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    req = db.query(RequirementRequest).filter(
        RequirementRequest.id == request_id,
        RequirementRequest.is_deleted.is_(False),
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    is_owner = req.user_id == current_user.id
    if not (is_owner or can_review_request(current_user, req.team_id)):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    return _request_to_dict(req, current_user)


@router.post("/agent/requests/{request_id}/resume")
def agent_request_resume(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open a returned request's original AI dialogue for revision by its owner."""
    req = db.query(RequirementRequest).filter(
        RequirementRequest.id == request_id,
        RequirementRequest.is_deleted.is_(False),
        RequirementRequest.user_id == current_user.id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if req.status != "returned":
        raise HTTPException(status_code=409, detail="Уточнение сейчас не требуется")
    if not req.agent_session_id:
        raise HTTPException(status_code=409, detail="Исходный диалог не найден")
    resp = _call_agent("POST", "/api/agent/reopen-review", {
        "session_id": req.agent_session_id,
        "user_id": current_user.id,
        "comment": req.reject_reason or "",
    })
    if resp.get("action") == "error" or resp.get("success") is False:
        raise HTTPException(status_code=409, detail=resp.get("message") or "Не удалось открыть запрос для уточнения")
    _set_active_agent_session(db, current_user, req.agent_session_id)
    return {"success": True, "session_id": req.agent_session_id, "request_id": req.id, "url": "#/customer/create"}


@router.put("/agent/requests/{request_id}/status")
def agent_request_status(
    request_id: int,
    body: AgentRequestStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the request lifecycle status with optional reject_reason or assignee."""
    if is_customer_portal_only(current_user):
        raise HTTPException(
            status_code=403,
            detail="Бизнес-заказчик не может изменять статус запроса после отправки на ревью",
        )

    req = db.query(RequirementRequest).filter(
        RequirementRequest.id == request_id,
        RequirementRequest.is_deleted.is_(False),
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    # Reviewer lifecycle is a capability separate from object ownership.
    # Owners resume returned requests through the customer endpoint; they must
    # never be able to claim their own submitted request for review.
    if not can_review_request(current_user, req.team_id):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if body.status not in REQUEST_STATUSES:
        raise HTTPException(status_code=422, detail=f"Недопустимый статус: {body.status}")
    if req.version != body.version:
        raise HTTPException(status_code=409, detail={
            "code": "request_version_conflict",
            "message": "Запрос уже изменён другим пользователем",
            "request_id": req.id,
            "expected_version": body.version,
            "current_version": req.version or 0,
            "current_status": req.status,
        })
    allowed_targets = REQUEST_STATUS_TRANSITIONS.get(req.status, set())
    if body.status not in allowed_targets:
        raise HTTPException(status_code=409, detail={
            "code": "invalid_request_transition",
            "message": f"Переход {req.status} → {body.status} недопустим",
            "request_id": req.id,
            "current_version": req.version or 0,
            "current_status": req.status,
        })
    if req.status == "in_review" and req.reviewer_id != current_user.id:
        raise HTTPException(status_code=409, detail={
            "code": "request_owned_by_another_reviewer",
            "message": "Запрос уже закреплён за другим ревьюером",
            "request_id": req.id,
            "current_version": req.version or 0,
            "current_status": req.status,
            "reviewer_id": req.reviewer_id,
        })
    if body.status == "in_review" and req.reviewer_id not in {None, current_user.id}:
        raise HTTPException(status_code=409, detail={
            "code": "request_owned_by_another_reviewer",
            "message": "Запрос уже закреплён за другим ревьюером",
            "request_id": req.id,
            "current_version": req.version or 0,
            "current_status": req.status,
            "reviewer_id": req.reviewer_id,
        })
    if body.status in {"rejected", "returned"} and not body.reject_reason.strip():
        raise HTTPException(status_code=422, detail="При возврате или отклонении укажите комментарий")
    action_reason = str(getattr(body, "action_reason", "") or "").strip()
    requested_team_id = getattr(body, "team_id", None)
    if body.status == "submitted" and not action_reason:
        raise HTTPException(status_code=422, detail="При освобождении или перенаправлении укажите причину")
    if requested_team_id is not None and requested_team_id != req.team_id:
        if get_request_review_access(current_user) != "all":
            raise HTTPException(status_code=403, detail="Перенаправлять запросы между командами может только глобальный ревьюер")
        if not db.query(Team).filter(Team.id == requested_team_id).first():
            raise HTTPException(status_code=422, detail="Выбранная команда не найдена")
    if body.status == "in_progress" and req.task_id is None:
        raise HTTPException(409, detail={"code": "explicit_resolution_required",
            "message": "Выберите результат размещения в новой форме ревью", "url": f"#/review/{req.id}"})
    if body.status == "in_progress" and not body.assignee_id:
        raise HTTPException(status_code=422, detail="При передаче в проработку укажите ответственного")
    if body.status == "in_progress" and body.assignee_id:
        assignee = (
            db.query(User)
            .join(Role, User.role_id == Role.id)
            .filter(
                User.id == body.assignee_id,
                User.team_id == req.team_id,
                User.is_active.is_(True),
                func.lower(Role.name).in_(ASSIGNABLE_REQUEST_ANALYST_ROLES),
            )
            .first()
        )
        if not assignee:
            raise HTTPException(
                status_code=422,
                detail="Выберите активного бизнес-аналитика команды",
            )
    ensure_request_history(req)
    req.status = body.status
    if body.status in {"rejected", "returned"}:
        req.reject_reason = body.reject_reason.strip()
    if body.status == "in_review":
        req.reviewer_id = current_user.id
        req.coordinator_id = req.coordinator_id or current_user.id
        req.reject_reason = None
    if body.status == "submitted":
        if requested_team_id is not None:
            if requested_team_id != req.team_id:
                req.coordinator_id = None
                req.next_action = None
                req.next_action_due = None
            req.team_id = requested_team_id
        req.reviewer_id = None
    if body.status == "in_progress" and body.assignee_id:
        req.assignee_id = body.assignee_id
        req.reviewer_id = current_user.id
        if req.task_id is None:
            initial_status = db.query(TaskStatus).filter(TaskStatus.name == "СБОР ТРЕБОВАНИЙ").first()
            customer_id = req.user.business_customer_id if req.user else None
            task = Task(
                team_id=req.team_id,
                title=req.title,
                description=_render_request(req.draft) if isinstance(req.draft, dict) and req.draft else req.description,
                business_customer_id=customer_id,
                status_id=initial_status.id if initial_status else None,
                owner_id=body.assignee_id,
                created_by=current_user.id,
                progress=0,
                link_requirements=[f"#/review/{req.id}?revision={len(current_revision_history(req)) or 1}"],
            )
            db.add(task)
            db.flush()
            req.task_id = task.id
            notify_assignment(db, task, body.assignee_id, current_user.id)
    req.version = (req.version or 0) + 1
    event_comment = body.reject_reason.strip() if body.status in {"returned", "rejected"} else action_reason
    finding_resolutions = getattr(body, "finding_resolutions", None) or []
    append_status_event(req, body.status, current_user, event_comment, metadata={"finding_resolutions": finding_resolutions} if finding_resolutions else None)
    notify_request_decision(db, req, body.status, current_user.id)
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        current = db.query(RequirementRequest).filter(RequirementRequest.id == request_id).first()
        raise HTTPException(status_code=409, detail={
            "code": "request_version_conflict",
            "message": "Запрос уже изменён другим пользователем",
            "request_id": request_id,
            "expected_version": body.version,
            "current_version": current.version if current else None,
            "current_status": current.status if current else None,
        })
    db.refresh(req)
    return _request_to_dict(req, current_user)


@router.delete("/agent/requests/{request_id}")
def agent_request_delete(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft-delete a requirement request (only its owner or admin)."""
    req = db.query(RequirementRequest).filter(
        RequirementRequest.id == request_id,
        RequirementRequest.is_deleted.is_(False),
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if req.user_id != current_user.id and get_request_review_access(current_user) != "all":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if req.status != 'draft':
        raise HTTPException(409, detail='Поступившие запросы сохраняются в истории. Используйте действие «Отозвать запрос» с причиной.')
    req.is_deleted = True
    db.commit()
    return {"success": True}


@router.get("/agent/teams")
def agent_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all teams (for team selection in agent chat)."""
    rows = db.query(Team).order_by(Team.name).all()
    return [{"id": t.id, "name": t.name} for t in rows]


@router.get("/agent/teams/{team_id}/ba")
def agent_team_ba(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List BA users in a team (for assignee selection)."""
    if not can_review_request(current_user, team_id):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    rows = (
        db.query(User)
        .join(Role, User.role_id == Role.id)
        .filter(
            User.team_id == team_id,
            User.is_active.is_(True),
            func.lower(Role.name).in_(ASSIGNABLE_REQUEST_ANALYST_ROLES),
        )
        .order_by(User.name)
        .all()
    )
    return [{"id": u.id, "name": u.name, "role": u.role_name} for u in rows]
