"""
DMB Backlog - AI Business Analyst Assistant integration.

The DMB backend is the only caller of the agent service. It manages the
mapping user -> agent session, proxies the chat and turns an approved agent
draft into a RequirementRequest (a separate entity from a Task). The task is
NOT created automatically - final decisions stay with PO/BA (human-in-the-loop).
"""
import json
import logging
import urllib.request
import urllib.error

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from config import settings
from database import get_db
from models import AgentSession, RequirementRequest, User, Team
from notifications import notify_new_request, notify_request_rejected, notify_request_assigned

logger = logging.getLogger("agent_integration")
router = APIRouter()


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    session_id: str = ""


class AgentSendForReviewRequest(BaseModel):
    session_id: str
    title: str = ""
    team_id: int = None


class AgentRequestStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    reject_reason: str = ""
    assignee_id: int = None


REQUEST_STATUSES = {"draft", "submitted", "in_review", "in_progress", "approved", "rejected", "returned"}
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


def can_review_request(user: User, request_team_id: int | None) -> bool:
    """Проверить область ревью запроса по актуальной матрице ролей."""
    role = (user.role_name or "").strip().casefold()
    if role in GLOBAL_REQUEST_REVIEWER_ROLES:
        return True
    return (
        role in TEAM_REQUEST_REVIEWER_ROLES
        and user.team_id is not None
        and user.team_id == request_team_id
    )


def _agent_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-Agent-Secret": settings.AGENT_SECRET,
    }


def _call_agent(method: str, path: str, payload: dict | None = None) -> dict:
    """Call the agent service; returns parsed JSON or raises HTTPException."""
    url = f"{settings.AGENT_BASE_URL.rstrip('/')}{path}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=_agent_headers(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        logger.error("agent %s %s -> %s: %s", method, path, e.code, body)
        raise HTTPException(status_code=502, detail=f"Агент недоступен ({e.code})")
    except (OSError, TimeoutError, UnicodeError, json.JSONDecodeError):
        logger.exception("agent %s %s failed", method, path)
        raise HTTPException(status_code=502, detail="Сервис аналитика недоступен")


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
    lines = []
    lines.append(f"**Проблема:** {draft.get('problem_statement') or '—'}")
    if draft.get("target_process"):
        lines.append(f"**Целевой процесс (To-Be):** {draft['target_process']}")
    if draft.get("business_value"):
        lines.append(f"**Бизнес-ценность:** {draft['business_value']}")
    roles = draft.get("user_roles") or []
    if roles:
        lines.append(f"**Пользователи:** {', '.join(roles)}")
    if draft.get("product"):
        lines.append(f"**Продукт:** {draft['product']}")
    if draft.get("module"):
        lines.append(f"**Модуль:** {draft['module']}")
    for label, key in [
        ("Сценарии", "scenarios"),
        ("Бизнес-правила", "business_rules"),
        ("Данные и интеграции", "data_integrations"),
        ("Критерии приёмки", "acceptance_criteria"),
    ]:
        vals = draft.get(key) or []
        if vals:
            lines.append(f"**{label}:** {'; '.join(vals)}")
    open_q = draft.get("open_questions") or []
    if open_q:
        lines.append(f"**Открытые вопросы:** {'; '.join(open_q)}")
    assumptions = draft.get("assumptions") or []
    if assumptions:
        lines.append(f"**Допущения:** {'; '.join(assumptions)}")
    flags = draft.get("regulatory_flags") or []
    if flags:
        lines.append(f"**Регуляторные флаги:** {'; '.join(flags)}")
    lines.append(f"**Полнота (completeness):** {draft.get('completeness_score', 0)}")
    lines.append(f"**Уверенность:** {draft.get('confidence', '')}")
    lines.append(f"**Статус:** {draft.get('status', 'Draft')}")

    sources = draft.get("sources") or []
    if sources:
        lines.append("")
        lines.append("**Источники БЗ:**")
        for s in sources:
            title = s.get("title") or s.get("doc_title") or "источник"
            lines.append(f"- {title}")
    return "\n".join(lines)


def _request_to_dict(req: RequirementRequest) -> dict:
    return {
        "id": req.id,
        "title": req.title,
        "description": req.description,
        "draft": req.draft,
        "status": req.status,
        "agent_session_id": req.agent_session_id,
        "user_id": req.user_id,
        "team_id": req.team_id,
        "team_name": req.team.name if req.team else None,
        "reviewer_id": req.reviewer_id,
        "reviewer_name": req.reviewer.name if req.reviewer else None,
        "assignee_id": req.assignee_id,
        "assignee_name": req.assignee.name if req.assignee else None,
        "reject_reason": req.reject_reason,
        "author_name": req.user.name if req.user else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


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
    return resp


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


@router.post("/agent/send-for-review")
def agent_send_for_review(
    req: AgentSendForReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a RequirementRequest from the agent draft (no Task is created)."""
    state = _call_agent("GET", f"/api/agent/session/{req.session_id}")
    draft = state.get("draft")
    if not draft:
        raise HTTPException(status_code=400, detail="Драфт ещё не готов — продолжите диалог")

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
    try:
        db.flush()
        resp = _call_agent("POST", "/api/agent/send-for-review", {
            "session_id": req.session_id,
            "task_id": request.id,
            "title": req.title or draft.get("title") or "",
        })
        notify_new_request(db, request.id, request.team_id, request.title, current_user.name)
        db.commit()
        db.refresh(request)
        resp["request_id"] = request.id
        resp["request_url"] = f"#/customer/request/{request.id}"
        return resp
    except Exception:
        db.rollback()
        raise


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
    return [_request_to_dict(r) for r in rows]


@router.get("/agent/requests/review")
def agent_requests_review(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Запросы для ревью в разрешённой пользователю области."""
    role = (current_user.role_name or "").strip().casefold()
    if role not in TEAM_REQUEST_REVIEWER_ROLES | GLOBAL_REQUEST_REVIEWER_ROLES:
        raise HTTPException(status_code=403, detail="Доступ запрещён")

    query = db.query(RequirementRequest).filter(
        RequirementRequest.is_deleted.is_(False),
        RequirementRequest.status.in_(["submitted", "in_review", "in_progress", "returned"]),
    )
    if role not in GLOBAL_REQUEST_REVIEWER_ROLES:
        query = query.filter(RequirementRequest.team_id == current_user.team_id)

    rows = query.order_by(RequirementRequest.created_at.desc()).all()
    return [_request_to_dict(r) for r in rows]


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
    return _request_to_dict(req)


@router.put("/agent/requests/{request_id}/status")
def agent_request_status(
    request_id: int,
    body: AgentRequestStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the request lifecycle status with optional reject_reason or assignee."""
    role = (current_user.role_name or "").strip().casefold()
    if role == "бизнес-заказчик":
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
    is_owner = req.user_id == current_user.id
    if not (is_owner or can_review_request(current_user, req.team_id)):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if body.status not in REQUEST_STATUSES:
        raise HTTPException(status_code=422, detail=f"Недопустимый статус: {body.status}")
    if body.status == "rejected" and not body.reject_reason.strip():
        raise HTTPException(status_code=422, detail="При отклонении укажите причину")
    req.status = body.status
    if body.status == "rejected":
        req.reject_reason = body.reject_reason.strip()
        notify_request_rejected(db, req.id, req.user_id, req.title, body.reject_reason.strip())
    if body.status == "in_progress" and body.assignee_id:
        req.assignee_id = body.assignee_id
        req.reviewer_id = current_user.id
        notify_request_assigned(db, req.id, body.assignee_id, req.title)
    db.commit()
    db.refresh(req)
    return _request_to_dict(req)


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
    role = (current_user.role_name or "").strip().casefold()
    if req.user_id != current_user.id and role not in GLOBAL_REQUEST_REVIEWER_ROLES:
        raise HTTPException(status_code=403, detail="Доступ запрещён")
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
    rows = (
        db.query(User)
        .filter(User.team_id == team_id, User.is_active.is_(True))
        .order_by(User.name)
        .all()
    )
    return [{"id": u.id, "name": u.name, "role": u.role_name} for u in rows]
