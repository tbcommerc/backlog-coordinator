"""Agent HTTP API: chat, sessions, send-for-review, config.

The agent runs on its own port and is reached by the DMB backend only
(which enforces authentication and passes the user context). The secret
header X-Agent-Secret protects the endpoint.
"""
import json
import logging
import queue
import secrets
import threading
from dataclasses import asdict

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..config import settings
from ..context import UserContext
from ..dialogue.state import INTENTS
from ..kb.loader import kb
from ..mcp.registry import registry as mcp_registry
from ..llm.rephrase import rephrase_stream
from ..orchestrator import get_orchestrator
from ..session import SessionConflictError
from ..tools.base import registry as tool_registry
from .schemas import (
    AgentResponse,
    CancelReviewRequest,
    ChatRequest,
    ConfigResponse,
    EditDraftSectionRequest,
    NewSessionRequest,
    ReopenReviewRequest,
    ResetRequest,
    SendForReviewRequest,
)

router = APIRouter()
logger = logging.getLogger("agent.api")

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
    with _orchestrator.store.serialized(req.session_id):
        if not req.session_id or _orchestrator.store.get(req.session_id) is None:
            raise HTTPException(status_code=404, detail="Session not found")
        cached = _orchestrator.store.get_cached_response(req.session_id, req.message_id)
        if cached is not None:
            return cached
        try:
            response = _orchestrator.handle_message(
                req.session_id, req.message, _to_ctx(req.context), message_id=req.message_id
            )
        except SessionConflictError as exc:
            raise HTTPException(status_code=409, detail="Session changed concurrently") from exc
        _orchestrator.store.cache_response(req.session_id, req.message_id, asdict(response))
        return response


def _stream_event(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


def _replace_last_response_message(response, original: str, final: str) -> None:
    if not final or final == original:
        return
    state = _orchestrator.store.get(response.session_id)
    if state is not None:
        for item in reversed(state.history):
            if item.get("role") == "assistant" and item.get("content") == original:
                item["content"] = final
                break
        _orchestrator.store.save(state)
        response.history = state.history
    response.message = final


@router.post("/chat-stream")
def chat_stream(req: ChatRequest, _=Depends(_check_secret)):
    """Stream the final user-facing reply, then publish the full response."""
    if not req.session_id or _orchestrator.store.get(req.session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")

    events: queue.Queue[tuple[str, object]] = queue.Queue()
    disconnected = threading.Event()

    def emit(event: str, data) -> None:
        if not disconnected.is_set():
            events.put((event, data))

    def work() -> None:
        try:
            with _orchestrator.store.serialized(req.session_id):
                cached = _orchestrator.store.get_cached_response(req.session_id, req.message_id)
                if cached is not None:
                    emit("result", cached)
                    return
                emit("status", {"stage": "analysis", "message": "Анализируем ответ и обновляем требование…"})
                response = _orchestrator.handle_message(
                    req.session_id, req.message, _to_ctx(req.context), message_id=req.message_id
                )
                original = response.message or ""
                streamed = ""
                final = original
                from ..agentic_orchestrator import AgenticOrchestrator
                # Active dialogue already validated wording against applied facts.
                # A second model must not rewrite scope, certainty or constraints.
                if original and not isinstance(_orchestrator, AgenticOrchestrator) and response.action not in {"refused", "unavailable", "error", "sent_locked"}:
                    emit("status", {"stage": "response", "message": "Формулируем ответ…"})
                    final, streamed = rephrase_stream(original, lambda delta: emit("delta", {"text": delta}))
                if not streamed and final:
                    emit("delta", {"text": final})
                    streamed = final
                if streamed != final:
                    emit("replace", {"text": final})
                _replace_last_response_message(response, original, final)
                payload = asdict(response)
                _orchestrator.store.cache_response(req.session_id, req.message_id, payload)
                emit("result", payload)
        except SessionConflictError:
            emit("error", {"code": "session_conflict", "message": "Диалог уже изменён другим запросом"})
        except Exception:
            logger.exception("chat stream failed for session %s", req.session_id)
            emit("error", {"code": "stream_failed", "message": "Не удалось получить ответ ассистента"})
        finally:
            events.put(("done", None))

    def event_source():
        worker = threading.Thread(target=work, name="agent-chat-stream", daemon=True)
        worker.start()
        try:
            yield _stream_event("ready", {"stream": True})
            while True:
                event, data = events.get()
                if event == "done":
                    break
                yield _stream_event(event, data)
        finally:
            disconnected.set()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/new-session", response_model=AgentResponse)
def new_session(req: NewSessionRequest, _=Depends(_check_secret)):
    return _orchestrator.new_session(req.user_id, _to_ctx(req.context))


@router.post("/reset")
def reset(req: ResetRequest, _=Depends(_check_secret)):
    with _orchestrator.store.serialized(req.session_id):
        _orchestrator.store.delete(req.session_id)
    return {"success": True}


@router.get("/session/{session_id}", response_model=AgentResponse)
def session_state(session_id: str, _=Depends(_check_secret)):
    # Building a restored draft can refresh its review findings and save state.
    # Read, review and fingerprint must share the same session boundary as edits.
    with _orchestrator.store.serialized(session_id):
        state = _orchestrator.store.get(session_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Session not found")
        response = _orchestrator._build_response(state, "session", "")
        if response.draft:
            from ..composer.revision import draft_fingerprint
            response.draft_revision = draft_fingerprint(response.draft)
        return response


@router.get("/sessions")
def sessions(user_id: int = 0, _=Depends(_check_secret)):
    return {"sessions": _orchestrator.store.list_for_user(user_id)}


@router.post("/session/{session_id}/archive")
def archive_session(session_id: str, archived: bool = True, _=Depends(_check_secret)):
    with _orchestrator.store.serialized(session_id):
        state = _orchestrator.store.set_archived(session_id, archived)
    if state is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "session_id": session_id, "archived": state.archived}


@router.post("/send-for-review", response_model=AgentResponse)
def send_for_review(req: SendForReviewRequest, _=Depends(_check_secret)):
    with _orchestrator.store.serialized(req.session_id):
        response = _orchestrator.confirm_and_send(
            req.session_id, req.task_id, req.title, req.user_id,
            expected_draft_hash=req.expected_draft_hash,
        )
        if response.draft:
            from ..composer.revision import draft_fingerprint
            response.draft_revision = draft_fingerprint(response.draft)
        return response


@router.post("/reopen-review", response_model=AgentResponse)
def reopen_review(req: ReopenReviewRequest, _=Depends(_check_secret)):
    with _orchestrator.store.serialized(req.session_id):
        return _orchestrator.reopen_for_revision(req.session_id, req.user_id, req.comment)


@router.post("/cancel-review", response_model=AgentResponse)
def cancel_review(req: CancelReviewRequest, _=Depends(_check_secret)):
    """Compensate a backend transaction failure for one exact submission."""
    with _orchestrator.store.serialized(req.session_id):
        return _orchestrator.cancel_review_submission(
            req.session_id, req.task_id, req.user_id,
        )


@router.post("/edit-draft-section", response_model=AgentResponse)
def edit_draft_section(req: EditDraftSectionRequest, _=Depends(_check_secret)):
    with _orchestrator.store.serialized(req.session_id):
        return _orchestrator.edit_draft_section(req.session_id, req.field, req.value, req.user_id)


@router.get("/config", response_model=ConfigResponse)
def config(_=Depends(_check_secret)):
    return ConfigResponse(
        provider=settings.LLM_PROVIDER,
        provider_available=bool(settings.OPENAI_API_KEY),
        dialogue_engine="agentic",
        intents=INTENTS,
        kb_stats=kb.stats(),
        mcp_servers=mcp_registry.servers,
        tools=tool_registry.list(),
    )
