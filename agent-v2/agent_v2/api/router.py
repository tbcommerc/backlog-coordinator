"""Agent HTTP API: chat, sessions, send-for-review, config.

The agent runs on its own port and is reached by the DMB backend only
(which enforces authentication and passes the user context). The secret
header X-Agent-Secret protects the endpoint.
"""
import hashlib
import json
import logging
import queue
import secrets
import threading
from contextlib import contextmanager
from dataclasses import asdict

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..config import settings
from ..context import UserContext
from ..dialogue.state import INTENTS
from ..kb.loader import kb
from ..mcp.registry import registry as mcp_registry
from ..llm.rephrase import rephrase_stream
from ..llm.context import llm_session
from ..session import SessionConflictError
from ..tools.base import registry as tool_registry
from ..v2.models import LinkedObjectSnapshot, SourceContext
from ..v2.fingerprint import canonical_fingerprint
from ..v2.orchestrator import get_v2_orchestrator
from .schemas import (
    AgentResponse,
    CancelReviewRequest,
    ChatRequest,
    ConfigResponse,
    EditDraftSectionRequest,
    DocumentActionRequest,
    ImportRequirementDocumentRequest,
    LinkObjectRequest,
    NewSessionRequest,
    PatchDecisionRequest,
    ProposedPatchRequest,
    ReopenReviewRequest,
    ResetRequest,
    SendForReviewRequest,
    SessionActionRequest,
)

router = APIRouter()
logger = logging.getLogger("agent_v2.api")

_orchestrator = get_v2_orchestrator()


@contextmanager
def _session_scope(session_id: str):
    """Bind each model call, including streaming workers, to its conversation."""
    with _orchestrator.store.serialized(session_id):
        with llm_session(session_id):
            yield


def _check_secret(x_agent_secret: str = Header(default="")):
    if not settings.AGENT_SECRET or not secrets.compare_digest(x_agent_secret, settings.AGENT_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")


def _require_mutations_enabled() -> None:
    if not settings.ENABLED or settings.KILL_SWITCH:
        raise HTTPException(status_code=503, detail="Assistant V2 is disabled")


def _to_ctx(raw: dict | None) -> UserContext | None:
    if not raw:
        return None
    data = {k: raw.get(k, "") for k in (
        "name", "email", "role_name", "customer_access", "team_name", "department",
        "operator_role")}
    data["user_id"] = int(raw.get("user_id", 0) or 0)
    data["is_ba"] = bool(raw.get("is_ba", False))
    return UserContext(**data)


def _owned_session(session_id: str, user_id: int) -> None:
    state = _orchestrator.store.get(session_id)
    if state is None or not user_id or state.user_id != user_id:
        raise HTTPException(status_code=404, detail="Session not found")


def _receipt_id(action: str, user_id: int, idempotency_key: str) -> str:
    """Fit operation-scoped idempotency keys into the copied receipt table."""
    if not idempotency_key:
        return ""
    digest = hashlib.sha256(
        f"{action}|{user_id}|{idempotency_key}".encode("utf-8")
    ).hexdigest()
    return f"idem:{digest[:59]}"


def _cached_action(session_id: str, action: str, user_id: int, key: str):
    return _orchestrator.store.get_cached_response(
        session_id, _receipt_id(action, user_id, key)
    )


def _cache_action(session_id: str, action: str, user_id: int, key: str, response) -> None:
    receipt = _receipt_id(action, user_id, key)
    if not receipt:
        return
    payload = asdict(response) if hasattr(response, "__dataclass_fields__") else response
    _orchestrator.store.cache_response(session_id, receipt, payload)


def _bound_request_fingerprint(action: str, req) -> str:
    payload = req.model_dump(mode="json")
    # Gateway refreshes this transport timestamp on every authorized retry.
    # Only that exact timestamp is excluded: identity, version, fingerprint,
    # fields, nested field timestamps and all other request data stay bound.
    snapshot_key = {"new_session": "linked_object", "link_object": "snapshot"}.get(action)
    if snapshot_key and isinstance(payload.get(snapshot_key), dict):
        payload[snapshot_key].pop("captured_at", None)
    return canonical_fingerprint(payload)


def _cached_bound_action(scope: str, action: str, req):
    cached = _cached_action(scope, action, req.user_id, req.idempotency_key)
    if cached is not None:
        if cached.get("request_fingerprint") != _bound_request_fingerprint(action, req):
            raise HTTPException(status_code=409, detail={"code": "idempotency_conflict", "message": "Ключ операции уже использован с другими параметрами."})
        return cached["response"]
    return None


def _cache_bound_action(scope: str, action: str, req, response):
    _cache_action(scope, action, req.user_id, req.idempotency_key, {
        "request_fingerprint": _bound_request_fingerprint(action, req),
        "response": asdict(response) if hasattr(response, "__dataclass_fields__") else response,
    })


@router.post("/chat", response_model=AgentResponse)
def chat(req: ChatRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        if not req.session_id or _orchestrator.store.get(req.session_id) is None:
            raise HTTPException(status_code=404, detail="Session not found")
        ctx = _to_ctx(req.context)
        if ctx is None or _orchestrator.store.get(req.session_id).user_id != ctx.user_id:
            raise HTTPException(status_code=404, detail="Session not found")
        cached = _orchestrator.store.get_cached_response(req.session_id, req.message_id)
        if cached is not None:
            return cached
        try:
            response = _orchestrator.handle_message(
                req.session_id, req.message, ctx, message_id=req.message_id
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
    _require_mutations_enabled()
    if not req.session_id or _orchestrator.store.get(req.session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    ctx = _to_ctx(req.context)
    if ctx is None or _orchestrator.store.get(req.session_id).user_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="Session not found")

    events: queue.Queue[tuple[str, object]] = queue.Queue()
    disconnected = threading.Event()

    def emit(event: str, data) -> None:
        if not disconnected.is_set():
            events.put((event, data))

    def work() -> None:
        try:
            with _session_scope(req.session_id):
                cached = _orchestrator.store.get_cached_response(req.session_id, req.message_id)
                if cached is not None:
                    emit("result", cached)
                    return
                emit("status", {"stage": "analysis", "message": "Анализируем ответ и обновляем требование…"})
                response = _orchestrator.handle_message(
                    req.session_id, req.message, ctx, message_id=req.message_id
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
    _require_mutations_enabled()
    ctx = _to_ctx(req.context)
    if ctx is None or not ctx.user_id or req.user_id != ctx.user_id:
        raise HTTPException(status_code=403, detail="Trusted actor context required")
    receipt_scope = f"new:{req.user_id}"
    with _session_scope(receipt_scope):
        cached = _cached_bound_action(receipt_scope, "new_session", req)
        if cached is not None:
            return cached
        try:
            source = SourceContext(**req.source_context) if req.source_context else None
            linked = LinkedObjectSnapshot(**req.linked_object) if req.linked_object else None
            response = _orchestrator.new_session(
                req.user_id, ctx, req.product_mode, source, linked
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _cache_bound_action(receipt_scope, "new_session", req, response)
        return response


@router.post("/reset")
def reset(req: ResetRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        cached = _cached_action(
            req.session_id, "reset", req.user_id, req.idempotency_key
        )
        if cached is not None:
            return cached
        _owned_session(req.session_id, req.user_id)
        _orchestrator.store.delete(req.session_id)
        response = {"success": True}
        # The session delete removes its old receipts; write this terminal
        # receipt afterwards so a transport retry does not turn into a 404.
        _cache_action(
            req.session_id, "reset", req.user_id, req.idempotency_key, response
        )
        return response


@router.get("/session/{session_id}", response_model=AgentResponse)
def session_state(session_id: str, user_id: int = 0, _=Depends(_check_secret)):
    # Building a restored draft can refresh its review findings and save state.
    # Read, review and fingerprint must share the same session boundary as edits.
    with _session_scope(session_id):
        state = _orchestrator.store.get(session_id)
        if state is None or not user_id or state.user_id != user_id:
            raise HTTPException(status_code=404, detail="Session not found")
        response = _orchestrator._build_response(state, "session", "")
        return response


@router.get("/sessions")
def sessions(user_id: int = 0, linked_object_type: str = "", linked_object_id: str = "", _=Depends(_check_secret)):
    if not user_id:
        raise HTTPException(status_code=422, detail="user_id is required")
    if (bool(linked_object_type) != bool(linked_object_id)
            or (linked_object_type and linked_object_type not in {"request", "task", "goal", "draft"})
            or len(linked_object_id) > 128):
        raise HTTPException(status_code=422, detail="Valid linked_object_type and linked_object_id must be provided together")
    return {"sessions": _orchestrator.store.list_for_user(
        user_id, linked_object_type=linked_object_type, linked_object_id=linked_object_id,
    )}


@router.post("/session/{session_id}/archive")
def archive_session(
    session_id: str,
    archived: bool = True,
    user_id: int = 0,
    idempotency_key: str = "",
    _=Depends(_check_secret),
):
    _require_mutations_enabled()
    with _session_scope(session_id):
        cached = _cached_action(session_id, "archive", user_id, idempotency_key)
        if cached is not None:
            return cached
        _owned_session(session_id, user_id)
        state = _orchestrator.store.set_archived(session_id, archived)
        if state is None:
            raise HTTPException(status_code=404, detail="Session not found")
        response = {"success": True, "session_id": session_id, "archived": state.archived}
        _cache_action(session_id, "archive", user_id, idempotency_key, response)
        return response


@router.post("/send-for-review", response_model=AgentResponse)
def send_for_review(req: SendForReviewRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        response = _orchestrator.confirm_and_send(
            req.session_id, req.task_id, req.title, req.user_id,
            expected_draft_hash=req.expected_draft_hash,
        )
        return response


@router.post("/reopen-review", response_model=AgentResponse)
def reopen_review(req: ReopenReviewRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        cached = _cached_action(
            req.session_id, "reopen_review", req.user_id, req.idempotency_key
        )
        if cached is not None:
            return cached
        response = _orchestrator.reopen_for_revision(
            req.session_id, req.user_id, req.comment
        )
        _cache_action(
            req.session_id, "reopen_review", req.user_id,
            req.idempotency_key, response,
        )
        return response


@router.post("/cancel-review", response_model=AgentResponse)
def cancel_review(req: CancelReviewRequest, _=Depends(_check_secret)):
    """Compensate a backend transaction failure for one exact submission."""
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        cached = _cached_action(
            req.session_id, "cancel_review", req.user_id, req.idempotency_key
        )
        if cached is not None:
            return cached
        response = _orchestrator.cancel_review_submission(
            req.session_id, req.task_id, req.user_id,
        )
        _cache_action(
            req.session_id, "cancel_review", req.user_id,
            req.idempotency_key, response,
        )
        return response


@router.post("/edit-draft-section", response_model=AgentResponse)
def edit_draft_section(req: EditDraftSectionRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        cached = _cached_action(
            req.session_id, "edit_draft_section", req.user_id, req.idempotency_key
        )
        if cached is not None:
            return cached
        response = _orchestrator.edit_draft_section(
            req.session_id, req.field, req.value, req.user_id
        )
        _cache_action(
            req.session_id, "edit_draft_section", req.user_id,
            req.idempotency_key, response,
        )
        return response


@router.post("/import-requirement-document", response_model=AgentResponse)
def import_requirement_document(
    req: ImportRequirementDocumentRequest,
    _=Depends(_check_secret),
):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        cached = _cached_action(
            req.session_id, "import_requirement_document", req.user_id,
            req.idempotency_key,
        )
        if cached is not None:
            return cached
        response = _orchestrator.import_requirement_document(
            req.session_id, req.content, req.user_id
        )
        _cache_action(
            req.session_id, "import_requirement_document", req.user_id,
            req.idempotency_key, response,
        )
        return response


@router.post("/document-action", response_model=AgentResponse)
def document_action(req: DocumentActionRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(req.session_id):
        _owned_session(req.session_id, req.user_id)
        action_key = "document_" + req.action
        cached = _cached_bound_action(req.session_id, action_key, req)
        if cached is not None:
            return cached
        try:
            response = _orchestrator.document_action(req.session_id, req.user_id, req.model_dump(mode="json"))
        except SessionConflictError as exc:
            raise HTTPException(status_code=409, detail={"code": "revision_conflict", "message": "Сессия изменена параллельно."}) from exc
        failures = {"revision_conflict": 409, "validation_error": 422, "unavailable": 503, "sent_locked": 409, "error": 404}
        if response.action in failures:
            raise HTTPException(status_code=failures[response.action], detail={"code": response.action, "message": response.message})
        _cache_bound_action(req.session_id, action_key, req, response)
        return response


@router.post("/session/{session_id}/handoff", response_model=AgentResponse)
def handoff(session_id: str, req: SessionActionRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(session_id):
        cached = _cached_action(session_id, "handoff", req.user_id, req.idempotency_key)
        if cached is not None:
            return cached
        response = _orchestrator.handoff(session_id, req.user_id)
        _cache_action(session_id, "handoff", req.user_id, req.idempotency_key, response)
        return response


@router.post("/session/{session_id}/link-object", response_model=AgentResponse)
def link_object(session_id: str, req: LinkObjectRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(session_id):
        _owned_session(session_id, req.user_id)
        cached = _cached_bound_action(session_id, "link_object", req)
        if cached is not None:
            return cached
        try:
            snapshot = LinkedObjectSnapshot(**req.snapshot)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid authorized snapshot") from exc
        response = _orchestrator.link_object(session_id, req.user_id, snapshot)
        _cache_bound_action(session_id, "link_object", req, response)
        return response


@router.post("/session/{session_id}/proposed-patch", response_model=AgentResponse)
def proposed_patch(session_id: str, req: ProposedPatchRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(session_id):
        cached = _cached_action(session_id, "proposed_patch", req.user_id, req.idempotency_key)
        if cached is not None:
            return cached
        response = _orchestrator.proposed_patch(
            session_id, req.user_id, req.current_snapshot_fingerprint
        )
        _cache_action(session_id, "proposed_patch", req.user_id, req.idempotency_key, response)
        return response


@router.post("/session/{session_id}/proposed-patch/decision", response_model=AgentResponse)
def patch_decision(session_id: str, req: PatchDecisionRequest, _=Depends(_check_secret)):
    _require_mutations_enabled()
    with _session_scope(session_id):
        cached = _cached_action(session_id, "patch_decision", req.user_id, req.idempotency_key)
        if cached is not None:
            return cached
        try:
            response = _orchestrator.decide_patch_operation(
                session_id, req.user_id, req.operation_index, req.decision
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        _cache_action(session_id, "patch_decision", req.user_id, req.idempotency_key, response)
        return response


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
        assistant_version="v2",
        enabled=bool(settings.ENABLED and not settings.KILL_SWITCH),
        product_modes=["assignment_capture", "requirement_copilot"],
        prompt_set_version=settings.PROMPT_SET_VERSION,
    )
