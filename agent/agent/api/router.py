"""Agent HTTP API: chat, sessions, send-for-review, config.

The agent runs on its own port and is reached by the DMB backend only
(which enforces authentication and passes the user context). The secret
header X-Agent-Secret protects the endpoint.
"""
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from ..config import settings
from ..context import UserContext
from ..dialogue.state import INTENTS
from ..kb.loader import kb
from ..mcp.registry import registry as mcp_registry
from ..orchestrator import get_orchestrator
from ..tools.base import registry as tool_registry
from .schemas import (
    AgentResponse,
    ChatRequest,
    ConfigResponse,
    NewSessionRequest,
    ResetRequest,
    SendForReviewRequest,
)

router = APIRouter()

_orchestrator = get_orchestrator()


def _check_secret(x_agent_secret: str = Header(default="")):
    if not settings.AGENT_SECRET or not secrets.compare_digest(x_agent_secret, settings.AGENT_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")


def _to_ctx(raw: dict | None) -> UserContext | None:
    if not raw:
        return None
    data = {k: raw.get(k, "") for k in (
        "name", "email", "role_name", "customer_access", "team_name", "department")}
    data["user_id"] = int(raw.get("user_id", 0) or 0)
    data["is_ba"] = bool(raw.get("is_ba", False))
    return UserContext(**data)


@router.post("/chat", response_model=AgentResponse)
def chat(req: ChatRequest, _=Depends(_check_secret)):
    return _orchestrator.handle_message(req.session_id, req.message, _to_ctx(req.context))


@router.post("/new-session", response_model=AgentResponse)
def new_session(req: NewSessionRequest, _=Depends(_check_secret)):
    return _orchestrator.new_session(req.user_id, _to_ctx(req.context))


@router.post("/reset")
def reset(req: ResetRequest, _=Depends(_check_secret)):
    _orchestrator.store.delete(req.session_id)
    return {"success": True}


@router.get("/session/{session_id}", response_model=AgentResponse)
def session_state(session_id: str, _=Depends(_check_secret)):
    state = _orchestrator.store.get(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _orchestrator._build_response(state, "session", "")


@router.get("/sessions")
def sessions(user_id: int = 0, _=Depends(_check_secret)):
    return {"sessions": _orchestrator.store.list_for_user(user_id)}


@router.post("/send-for-review", response_model=AgentResponse)
def send_for_review(req: SendForReviewRequest, _=Depends(_check_secret)):
    return _orchestrator.confirm_and_send(req.session_id, req.task_id, req.title, req.user_id)


@router.get("/config", response_model=ConfigResponse)
def config(_=Depends(_check_secret)):
    return ConfigResponse(
        provider=settings.LLM_PROVIDER,
        provider_available=bool(settings.OPENAI_API_KEY),
        intents=INTENTS,
        kb_stats=kb.stats(),
        mcp_servers=mcp_registry.servers,
        tools=tool_registry.list(),
    )
