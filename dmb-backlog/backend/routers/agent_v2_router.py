"""Browser gateway and DMB review adapter for the fork-based Assistant V2."""
from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    can_access_task,
    get_current_user,
    get_request_review_access,
    task_read_scope_clause,
)
from database import get_db
from models import RequirementRequest, Task, User
from requirement_artifacts import append_revision, append_status_event
from services.agent_v2_gateway import (
    call_json,
    operator_role,
    pilot_allowed,
    proxy_request,
    trusted_context,
)
from services.agent_v2_documents import publication_package, render_source_document


from services.agent_recovery import bind_actor,guard_v2

router = APIRouter(dependencies=[Depends(bind_actor),Depends(guard_v2)])


def _deny_unless_pilot(user: User) -> None:
    if not pilot_allowed(user) or not operator_role(user):
        raise HTTPException(status_code=403, detail="Пользователь не включён в BA/PO pilot Assistant V2")


def _canonical_fingerprint(value: dict) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _snapshot(db: Session, user: User, object_type: str, object_id: str) -> dict:
    try:
        numeric_id = int(object_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="not_found_or_forbidden") from exc
    if object_type == "task":
        row = db.query(Task).filter(Task.id == numeric_id, Task.is_deleted.is_(False)).first()
        if not row or not can_access_task("read", row, user):
            raise HTTPException(status_code=404, detail="not_found_or_forbidden")
        fields = {"title": row.title or "", "description": row.description or ""}
        fields["requirements_links"] = deepcopy(getattr(row, "link_requirements", None) or [])
        fields["project_id"] = getattr(row, "project_id", None)
        version = str(row.version or 0)
        title, summary = fields["title"], fields["description"]
    elif object_type == "request":
        row = db.query(RequirementRequest).filter(
            RequirementRequest.id == numeric_id,
            RequirementRequest.is_deleted.is_(False),
        ).first()
        access = get_request_review_access(user)
        allowed = bool(row and (
            row.user_id == user.id
            or access == "all"
            or (access == "team" and row.team_id == user.team_id)
        ))
        if not allowed:
            raise HTTPException(status_code=404, detail="not_found_or_forbidden")
        fields = {"title": row.title or "", "description": row.description or ""}
        fields["requirement_draft"] = deepcopy(getattr(row, "draft", None) or {})
        fields["review_comment"] = getattr(row, "reject_reason", None) or ""
        fields["source_request_author_id"] = row.user_id
        fields["task_id"] = getattr(row, "task_id", None)
        version = str(row.version or 0)
        title, summary = fields["title"], fields["description"]
    else:
        raise HTTPException(status_code=404, detail="not_found_or_forbidden")
    fingerprint = _canonical_fingerprint({
        "object_type": object_type,
        "object_id": str(object_id),
        "object_version": version,
        "fields": fields,
    })
    return {
        "object_type": object_type,
        "object_id": str(object_id),
        "source_system": "dmb",
        "object_version": version,
        "fingerprint": fingerprint,
        "title": title,
        "summary": summary[:4000],
        "allowed_fields": ["title", "description"],
        "fields": fields,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def _render_artifact(draft: dict) -> str:
    sections = [f"# {draft.get('title') or 'Бизнес-требование V2'}"]
    mapping = (
        ("Проблема", "problem_statement"), ("Бизнес-цель", "business_goal"),
        ("AS-IS", "current_process"), ("TO-BE", "target_process"),
        ("Scope in", "scope_in"), ("Scope out", "scope_out"),
        ("Сценарии", "scenarios"), ("Бизнес-правила", "business_rules"),
        ("Критерии приёмки", "acceptance_criteria"),
    )
    for label, key in mapping:
        value = draft.get(key)
        if not value:
            continue
        if isinstance(value, list):
            text = "\n".join(f"- {item}" for item in value)
        else:
            text = str(value)
        sections.append(f"\n## {label}\n{text}")
    return "\n".join(sections)


def _agent_error(status: int, payload: dict) -> HTTPException:
    detail = payload.get("detail") or payload.get("error") or payload.get("message") or "Assistant V2 rejected the request"
    return HTTPException(status_code=status if status >= 400 else 409, detail=detail)


def _escaped_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _safe_session_id(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise HTTPException(422, detail={"code": "invalid_session_id", "message": "Некорректный идентификатор документа"})
    return value


def _operation_key(request: Request, body: dict) -> str:
    header = request.headers.get("Idempotency-Key", "")
    value = body.get("idempotency_key", "")
    if header and value and header != value:
        raise HTTPException(422, detail={"code": "idempotency_key_mismatch", "message": "Ключи операции не совпадают"})
    key = header or value
    if not isinstance(key, str) or not key.strip() or len(key) > 128:
        raise HTTPException(422, detail={"code": "idempotency_key_required", "message": "Нужен ключ повторяемой операции"})
    return key


def _step_key(key: str, step: str) -> str:
    return hashlib.sha256(f"{key}:{step}".encode("utf-8")).hexdigest()


def _session_context(db: Session, user: User, session_id: str) -> dict:
    """Ownership is checked by V2; linked-object access is rechecked by DMB."""
    session_id = _safe_session_id(session_id)
    status, state = call_json("GET", f"session/{session_id}", query=urlencode({"user_id": user.id}))
    if status != 200:
        raise _agent_error(status, state)
    linked = state.get("linked_object") or {}
    if linked:
        _snapshot(db, user, linked.get("object_type"), linked.get("object_id"))
    return state


def _agent_action(user: User, session_id: str, action: str, key: str, **values) -> dict:
    status, response = call_json("POST", "document-action", {
        **values, "session_id": session_id, "action": action,
        "user_id": user.id, "idempotency_key": key,
    })
    if status != 200:
        raise _agent_error(status, response)
    if response.get("action") in {"error", "validation_error", "revision_conflict", "unavailable", "sent_locked"}:
        raise HTTPException(409 if response["action"] != "unavailable" else 503,
            detail={"code": response["action"], "message": response.get("message") or "Не удалось выполнить действие"})
    return response


def _workspace_content(snapshot: dict) -> str:
    source_draft = snapshot["fields"].get("requirement_draft")
    content = render_source_document(source_draft) if source_draft else (
        f"# {snapshot['title']}\n\n## Проблема\n{snapshot['fields']['description']}")
    if len(content) > 30000:
        raise HTTPException(422, detail={"code": "source_document_too_large",
            "message": "Исходный документ превышает 30 000 символов. Создайте БТ и добавьте нужные фрагменты отдельными источниками."})
    return content


def _complete_workspace_import(user: User, session_id: str, content: str, key: str) -> dict:
    status, state = call_json("POST", "import-requirement-document", {
        "user_id": user.id, "session_id": session_id, "content": content,
        "idempotency_key": _step_key(key, "import"),
    })
    if status != 200:
        raise _agent_error(status, state)
    if state.get("action") != "document_imported":
        raise _agent_error(409, state)
    return state


@router.post("/requirement-reviews")
async def submit_requirement_review(request: Request, db: Session = Depends(get_db),
                                    current_user: User = Depends(get_current_user)):
    """Publish the actual owned document; browser artifact/actor fields are ignored."""
    from services import requirement_reviews as reviews
    _deny_unless_pilot(current_user)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, detail="Expected JSON object")
    key = _operation_key(request, body)
    for field in ("supersedes_review_id", "supersedes_version"):
        if body.get(field) is not None and (type(body[field]) is not int or body[field] < 1):
            raise HTTPException(422, detail={"code": "invalid_review_version", "message": "Нужны номер и версия заменяемого согласования"})
    if (body.get("supersedes_review_id") is None) != (body.get("supersedes_version") is None):
        raise HTTPException(422, detail={"code": "invalid_review_version", "message": "Укажите номер и версию заменяемого согласования вместе"})
    session_id = _safe_session_id(body.get("session_id"))
    state = _session_context(db, current_user, session_id)
    report = publication_package(state, body.get("expected_draft_hash"),
        acknowledge_degraded=body.get("acknowledge_degraded_review") is True)
    try:
        row = reviews.submit_from_agent(db, current_user, state["draft"], state.get("linked_object"),
            session_id=session_id, idempotency_key=key,
            expected_draft_hash=body.get("expected_draft_hash"), review_report=report,
            supersedes_review_id=body.get("supersedes_review_id"),
            supersedes_version=body.get("supersedes_version"))
        db.commit()
        dto = reviews.serialize_review(row, current_user, db)
    except Exception:
        db.rollback()
        raise
    return {"review": dto, "session_id": session_id,
            "artifact_id": row.artifact_id, "url": dto["url"]}


@router.post("/requirement-reviews/{review_id}/resume")
async def resume_requirement_review(review_id: int, request: Request,
                                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from services import requirement_reviews as reviews
    _deny_unless_pilot(current_user)
    row = reviews.get_review(db, current_user, review_id)
    if row.creator_id != current_user.id:
        raise HTTPException(403, detail={"code": "workspace_owner_required", "message": "Доработка доступна автору документа"})
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, detail="Expected JSON object")
    _operation_key(request, body)
    # The review/version is the stable resume identity even across browser retries.
    key = f"human-review:{row.id}:{row.version}"
    session_id = _safe_session_id(row.session_id)
    state = _session_context(db, current_user, session_id)
    draft = state.get("draft") or {}
    if draft.get("artifact_id") != row.artifact_id:
        raise HTTPException(409, detail={"code": "artifact_identity_conflict", "message": "Сессия относится к другому документу"})
    if row.status in {"returned", "approved"} and draft.get("fingerprint") == row.artifact_fingerprint:
        state = _agent_action(current_user, session_id, "next_revision", _step_key(key, "revision"),
                              expected_draft_hash=draft["fingerprint"])
    feedback_ref = f"dmb:requirement-review:{row.id}:v{row.version}"
    if (row.status == "returned" and row.comment
            and not any(source.get("source_ref") == feedback_ref for source in state.get("document_sources", []))):
        state = _agent_action(current_user, session_id, "add_source", _step_key(key, "feedback"), source={
            "title": f"Замечания ревьюера к редакции {row.artifact_revision}",
            "content": row.comment, "source_type": "text",
            "source_ref": feedback_ref,
        })
    state = _session_context(db, current_user, session_id)
    return {"session_id": session_id, "review_id": row.id, "state": state,
            "url": f"#/agent-v2?session={session_id}"}


@router.post("/objects/{object_type}/{object_id}/workspace")
async def open_object_workspace(object_type: str, object_id: str, request: Request,
                                db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Open the operator's document without taking over the source request."""
    _deny_unless_pilot(current_user)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(422, detail="Expected JSON object")
    key = _operation_key(request, body)
    snapshot = _snapshot(db, current_user, object_type, object_id)
    if body.get("force_new") is not True:
        status, listing = call_json("GET", "sessions", query=urlencode({
            "user_id": current_user.id,
            "linked_object_type": object_type, "linked_object_id": str(object_id),
        }))
        if status != 200:
            raise _agent_error(status, listing)
        for item in listing.get("sessions", []):
            linked = item.get("linked_object") or {}
            if (not item.get("archived") and linked.get("object_type") == object_type
                    and str(linked.get("object_id")) == str(object_id)
                    and item.get("product_mode") == "requirement_copilot"):
                state = _session_context(db, current_user, item["session_id"])
                bootstrap = next((source for source in (state.get("source_context") or {}).get("attachments", [])
                                  if source.get("kind") == "dmb_workspace_bootstrap"), None)
                if not state.get("draft") and bootstrap:
                    original = (state.get("linked_object") or {}).get("fields", {})
                    if any(original.get(field) != snapshot["fields"].get(field)
                           for field in ("title", "description", "requirement_draft", "requirements_links")):
                        raise HTTPException(409, detail={"code": "source_context_changed",
                            "message": "Исходный объект изменился во время импорта. Обновите связанный контекст документа."})
                    state = _complete_workspace_import(current_user, item["session_id"],
                        _workspace_content(snapshot), bootstrap["operation_scope"])
                return {"session_id": item["session_id"], "state": state, "reused": True,
                        "url": f"#/agent-v2?session={item['session_id']}"}
    content = _workspace_content(snapshot)
    scope = _step_key(key, f"workspace:{object_type}:{object_id}")
    status, state = call_json("POST", "new-session", {
        "user_id": current_user.id, "context": trusted_context(current_user),
        "product_mode": "requirement_copilot", "linked_object": snapshot,
        "source_context": {"source_type": "document", "channel": "document", "source_summary": snapshot["title"][:4000],
                           "attachments": [{"kind": "dmb_workspace_bootstrap", "operation_scope": scope}]},
        "idempotency_key": _step_key(key, "new"),
    })
    if status != 200:
        raise _agent_error(status, state)
    returned_link = state.get("linked_object") or {}
    if (returned_link.get("object_type") != object_type or str(returned_link.get("object_id")) != str(object_id)):
        raise HTTPException(409, detail={"code": "idempotency_conflict", "message": "Ключ операции уже относится к другому контексту"})
    session_id = _safe_session_id(state.get("session_id"))
    state = _complete_workspace_import(current_user, session_id, content, scope)
    return {"session_id": session_id, "state": state, "reused": False,
            "url": f"#/agent-v2?session={session_id}"}


@router.get("/objects/search")
def search_linkable_objects(
    object_type: str,
    q: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search only objects the authenticated operator may read."""
    _deny_unless_pilot(current_user)
    term = (q or "").strip()[:120]
    if not term:
        return {"items": []}
    numeric_id = int(term) if term.isdigit() else None
    if object_type == "task":
        query = db.query(Task).filter(
            Task.is_deleted.is_(False),
            task_read_scope_clause(current_user, Task),
        )
        query = (
            query.filter(Task.id == numeric_id)
            if numeric_id is not None
            else query.filter(Task.title.ilike(f"%{_escaped_like(term)}%", escape="\\"))
        )
        candidates = query.order_by(Task.id.desc()).limit(100).all()
        rows = [row for row in candidates if can_access_task("read", row, current_user)]
    elif object_type == "request":
        query = db.query(RequirementRequest).filter(RequirementRequest.is_deleted.is_(False))
        access = get_request_review_access(current_user)
        if access == "all":
            pass
        elif access == "team" and current_user.team_id:
            query = query.filter(RequirementRequest.team_id == current_user.team_id)
        else:
            query = query.filter(RequirementRequest.user_id == current_user.id)
        query = (
            query.filter(RequirementRequest.id == numeric_id)
            if numeric_id is not None
            else query.filter(RequirementRequest.title.ilike(
                f"%{_escaped_like(term)}%", escape="\\"
            ))
        )
        rows = query.order_by(RequirementRequest.id.desc()).limit(20).all()
    else:
        raise HTTPException(status_code=422, detail="Unsupported linked object type")
    return {
        "items": [
            {
                "object_type": object_type,
                "object_id": str(row.id),
                "title": row.title or "Без названия",
                "object_version": str(row.version or 0),
            }
            for row in rows[:20]
        ]
    }


@router.post("/send-for-review")
async def send_for_review(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _deny_unless_pilot(current_user)
    body = await request.json()
    session_id = str(body.get("session_id") or "")
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id is required")
    state = _session_context(db, current_user, session_id)
    if state.get("linked_object"):
        raise HTTPException(409, detail={"code": "requirement_revision_review_required",
            "message": "Для БТ связанного объекта используйте согласование редакции, а не создание нового запроса."})
    draft = state.get("draft") or {}
    readiness = state.get("readiness") or {}
    if draft.get("schema") != "business-requirement-draft.v2" or not readiness.get("ready"):
        raise HTTPException(status_code=409, detail={
            "code": "draft_not_ready",
            "blocking_codes": readiness.get("blocking_codes", []),
        })
    fingerprint = draft.get("fingerprint") or ""
    if body.get("expected_draft_hash") != fingerprint:
        raise HTTPException(status_code=409, detail="draft_revision_conflict")
    namespaced_session = f"v2:{session_id}"
    existing = db.query(RequirementRequest).filter(
        RequirementRequest.agent_session_id == namespaced_session,
        RequirementRequest.is_deleted.is_(False),
    ).with_for_update().first()
    metadata = {
        "assistant_version": "v2",
        "product_mode": state.get("product_mode"),
        "artifact_type": state.get("artifact_type"),
        "schema_version": state.get("schema_version"),
        "prompt_set_version": draft.get("prompt_set_version"),
        "artifact_revision": draft.get("revision"),
        "fingerprint": fingerprint,
        "linked_object": draft.get("linked_object"),
    }
    confirmed = deepcopy(draft)
    confirmed["metadata"] = metadata
    if existing and existing.status != "returned":
        if (existing.draft or {}).get("fingerprint") != fingerprint:
            raise HTTPException(status_code=409, detail="request_revision_conflict")
        return {
            **state,
            "request_id": existing.id,
            "request_status": existing.status,
            "request_version": existing.version or 0,
            "request_url": f"#/customer/request/{existing.id}",
            "duplicate": True,
        }
    row = existing or RequirementRequest(
        user_id=current_user.id,
        agent_session_id=namespaced_session,
        team_id=current_user.team_id,
        status="submitted",
        title=(draft.get("title") or "Бизнес-требование V2")[:255],
    )
    if not existing:
        db.add(row)
    row.title = (draft.get("title") or row.title)[:255]
    row.description = _render_artifact(draft)
    row.draft = confirmed
    row.status = "submitted"
    row.reject_reason = None
    row.reviewer_id = None
    if existing:
        row.version = (row.version or 0) + 1
    agent_confirmed = False
    try:
        db.flush()
        status, response = call_json("POST", "send-for-review", {
            "session_id": session_id,
            "task_id": row.id,
            "title": row.title,
            "user_id": current_user.id,
            "expected_draft_hash": fingerprint,
            "idempotency_key": request.headers.get("Idempotency-Key", ""),
        })
        if status != 200 or response.get("action") != "sent":
            raise _agent_error(status, response)
        agent_confirmed = True
        append_revision(row, confirmed, current_user)
        append_status_event(row, "submitted", current_user)
        db.commit()
        db.refresh(row)
        return {
            **response,
            "request_id": row.id,
            "request_status": row.status,
            "request_version": row.version or 0,
            "request_url": f"#/customer/request/{row.id}",
        }
    except Exception:
        db.rollback()
        if agent_confirmed and row.id:
            call_json("POST", "cancel-review", {
                "session_id": session_id,
                "task_id": row.id,
                "user_id": current_user.id,
                "idempotency_key": f"compensate:{row.id}:{fingerprint}"[:128],
            })
        raise


@router.post("/requests/{request_id}/resume")
def resume_returned_request(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _deny_unless_pilot(current_user)
    row = db.query(RequirementRequest).filter(
        RequirementRequest.id == request_id,
        RequirementRequest.user_id == current_user.id,
        RequirementRequest.is_deleted.is_(False),
    ).first()
    if not row or not (row.agent_session_id or "").startswith("v2:"):
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if row.status != "returned":
        raise HTTPException(status_code=409, detail="Уточнение сейчас не требуется")
    session_id = row.agent_session_id.removeprefix("v2:")
    _session_context(db, current_user, session_id)
    status, response = call_json("POST", "reopen-review", {
        "session_id": session_id,
        "user_id": current_user.id,
        "comment": row.reject_reason or "",
        "idempotency_key": request.headers.get("Idempotency-Key", ""),
    })
    if status != 200:
        raise _agent_error(status, response)
    return {"success": True, "session_id": session_id, "request_id": row.id, "url": f"#/agent-v2?session={session_id}"}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def gateway(
    path: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _deny_unless_pilot(current_user)
    # Starlette has already URL-decoded the catch-all path. Never interpolate
    # arbitrary path text into a privileged upstream URL (including ?/#/%).
    # Review transitions are gateway-owned routes, not public service actions.
    allowed = (
        request.method == "GET" and (
            path in {"config", "sessions"}
            or re.fullmatch(r"session/[A-Za-z0-9_-]{1,128}", path)
        )
    ) or (
        request.method == "POST" and (
            path in {"new-session", "chat", "chat-stream", "reset",
                     "edit-draft-section", "import-requirement-document", "document-action"}
            or re.fullmatch(
                r"session/[A-Za-z0-9_-]{1,128}/(?:archive|handoff|link-object|proposed-patch(?:/decision)?)",
                path,
            )
        )
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="Agent V2 endpoint not found")
    request_id = getattr(request.state, "request_id", None) or request.headers.get("X-Request-ID") or "unknown"
    trace_id = getattr(request.state, "trace_id", None) or request.headers.get("X-Trace-ID") or request_id
    payload = {}
    raw = await request.body()
    if raw:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Expected JSON object")
    session_match = re.fullmatch(r"session/([A-Za-z0-9_-]{1,128})(?:/[^/]+(?:/[^/]+)?)?", path)
    owned_state = None
    session_id = session_match.group(1) if session_match else payload.get("session_id")
    if session_id:
        owned_state = _session_context(db, current_user, session_id)
        if request.method == "GET" and path == f"session/{session_id}":
            return JSONResponse(owned_state, headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id})
    if path == "new-session":
        payload.pop("operator_role", None)
        payload.pop("user_id", None)
        # Linked objects must enter only through /link-object, where DMB applies
        # object-level authorization and creates the immutable snapshot.
        payload.pop("linked_object", None)
        payload["user_id"] = current_user.id
        payload["context"] = trusted_context(current_user)
    elif path == "chat" or path == "chat-stream":
        payload["context"] = trusted_context(current_user)
        payload["user_id"] = current_user.id
    elif request.method != "GET":
        payload["user_id"] = current_user.id
    if request.method != "GET" and path not in {"chat", "chat-stream"}:
        payload["idempotency_key"] = request.headers.get("Idempotency-Key", "")
    if path.endswith("/link-object"):
        previous = (owned_state or {}).get("linked_object") or {}
        if previous and (previous.get("object_type") != payload.get("object_type")
                         or str(previous.get("object_id")) != str(payload.get("object_id"))):
            raise HTTPException(409, detail={"code": "document_context_locked",
                "message": "Документ уже связан с исходным объектом. Для другого контекста создайте отдельное БТ."})
        payload = {
            "user_id": current_user.id,
            "idempotency_key": request.headers.get("Idempotency-Key", ""),
            "snapshot": _snapshot(
                db,
                current_user,
                str(payload.get("object_type") or ""),
                str(payload.get("object_id") or ""),
            ),
        }
    elif path.endswith("/proposed-patch"):
        session_id = path.removeprefix("session/").removesuffix("/proposed-patch")
        state_status, state = call_json(
            "GET", f"session/{session_id}",
            query=urlencode({"user_id": current_user.id}),
        )
        if state_status != 200:
            raise _agent_error(state_status, state)
        linked = state.get("linked_object") or {}
        if not linked:
            raise HTTPException(status_code=409, detail="linked_object_required")
        current_snapshot = _snapshot(
            db,
            current_user,
            str(linked.get("object_type") or ""),
            str(linked.get("object_id") or ""),
        )
        payload = {
            "user_id": current_user.id,
            "idempotency_key": request.headers.get("Idempotency-Key", ""),
            "current_snapshot_fingerprint": current_snapshot["fingerprint"],
        }
    query = dict(parse_qsl(request.url.query, keep_blank_values=True))
    # Query-bound endpoints (notably archive/session reads) must not retain a
    # forged user_id even when the HTTP body is also rewritten above.
    query["user_id"] = str(current_user.id)
    if request.method != "GET" and path.endswith("/archive"):
        query["idempotency_key"] = request.headers.get("Idempotency-Key", "")
    status, response_body, content_type = proxy_request(
        method=request.method,
        path=path,
        query=urlencode(query),
        body=json.dumps(payload, ensure_ascii=False).encode("utf-8") if request.method != "GET" else None,
        request_id=request_id,
        trace_id=trace_id,
    )
    if status == 200 and "application/json" in content_type:
        returned = json.loads(response_body.decode("utf-8"))
        linked = (returned.get("linked_object") or (returned.get("draft") or {}).get("linked_object")) if isinstance(returned, dict) else None
        if linked:
            # Receipts may contain an earlier snapshot; authorisation must also
            # hold when a cached response is returned without an input session.
            _snapshot(db, current_user, linked.get("object_type"), linked.get("object_id"))
    if path == "sessions" and request.method == "GET" and status == 200:
        listing = json.loads(response_body.decode("utf-8"))
        visible = []
        for item in listing.get("sessions", []):
            linked = item.get("linked_object") or {}
            if linked:
                try:
                    _snapshot(db, current_user, linked.get("object_type"), linked.get("object_id"))
                except HTTPException as exc:
                    if exc.status_code == 404:
                        continue
                    raise
            visible.append(item)
        listing["sessions"] = visible
        response_body = json.dumps(listing, ensure_ascii=False).encode("utf-8")
    return Response(
        content=response_body,
        status_code=status,
        media_type=content_type.split(";", 1)[0],
        headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id},
    )
