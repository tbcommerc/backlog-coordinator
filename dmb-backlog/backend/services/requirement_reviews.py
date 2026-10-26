"""Independent human review. Only the authenticated V2 gateway may submit snapshots.

All functions flush but do not commit. No function changes a Task, Request or any
protected identity/reference row. Existing review records never track live drafts.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from auth import can_access_task, get_request_review_access, task_read_scope_clause
from models import RequirementReview, RequirementRequest, Task
from services.agent_v2_gateway import operator_role


def _error(status, code, message, **details):
    raise HTTPException(status_code=status, detail={"code": code, "message": message, **details})


def _hash(value):
    return "sha256:" + hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _key(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        _error(422, "idempotency_key_required", "Нужен ключ повторяемой операции длиной до 128 символов")
    return value


def _full_admin(actor):
    return getattr(getattr(actor, "role", None), "admin_access", None) == "full"


def _scope(actor):
    return "all" if _full_admin(actor) else get_request_review_access(actor)


def _review_scope(actor, team_id):
    return bool(operator_role(actor) and (_scope(actor) == "all" or (
        _scope(actor) == "team" and actor.team_id is not None and actor.team_id == team_id
    )))


def _target(db, actor, target_type, target_id, *, lock=False):
    if target_type is None and target_id is None:
        return None
    model = {"task": Task, "request": RequirementRequest}.get(target_type)
    if model is None:
        _error(422, "invalid_review_target", "Неизвестный предмет требования")
    query = db.query(model).filter(model.id == target_id, model.is_deleted.is_(False))
    # Publication/decisions retain this ordinary source lock until the outer
    # transaction commits. Refresh any earlier gateway/identity-map snapshot.
    if lock:
        query = query.populate_existing().with_for_update()
    row = query.first()
    if target_type == "task":
        allowed = row is not None and can_access_task("read", row, actor)
    else:
        allowed = row is not None and (row.user_id == actor.id or _scope(actor) == "all" or (
            _scope(actor) == "team" and actor.team_id is not None and row.team_id == actor.team_id
        ))
    if not allowed:
        _error(404, "not_found_or_forbidden", "Объект не найден или доступ отозван")
    return row


def _significant_target(target_type, row):
    if row is None:
        return None
    # Only source content participates: a status/assignee/version change alone
    # does not invalidate a review of unchanged business requirements.
    fields = {
        "title": row.title or "", "description": row.description or "",
    }
    if target_type == "request":
        fields["requirement_draft"] = deepcopy(row.draft or {})
    else:
        fields["requirements_links"] = deepcopy(row.link_requirements or [])
    return {"object_type": target_type, "object_id": str(row.id), "fields": fields}


def _visible_clause(actor):
    """SQL scope applies before pagination/count; each detail rechecks live ACL."""
    request_scope = [RequirementRequest.user_id == actor.id]
    if _scope(actor) == "all":
        request_scope = [RequirementRequest.id.is_not(None)]
    elif _scope(actor) == "team" and actor.team_id is not None:
        request_scope.append(RequirementRequest.team_id == actor.team_id)
    requests = and_(RequirementReview.target_type == "request", RequirementReview.target_id.in_(
        select(RequirementRequest.id).where(
            RequirementRequest.is_deleted.is_(False), or_(*request_scope))))
    tasks = and_(RequirementReview.target_type == "task", RequirementReview.target_id.in_(
        select(Task.id).where(Task.is_deleted.is_(False), task_read_scope_clause(actor, Task))))
    standalone_scope = [RequirementReview.creator_id == actor.id]
    if operator_role(actor):
        if _scope(actor) == "all":
            standalone_scope.append(RequirementReview.id.is_not(None))
        elif _scope(actor) == "team" and actor.team_id is not None:
            standalone_scope.append(RequirementReview.team_id == actor.team_id)
    standalone = and_(RequirementReview.target_type.is_(None), or_(*standalone_scope))
    return or_(requests, tasks, standalone)


def _check_read(db, actor, row):
    target = _target(db, actor, row.target_type, row.target_id)
    if target is None and row.creator_id != actor.id and not _review_scope(actor, row.team_id):
        _error(404, "not_found_or_forbidden", "Редакция не найдена или доступ отозван")
    return target


def get_review(db, actor, review_id, *, lock=False):
    query = db.query(RequirementReview).filter(RequirementReview.id == review_id)
    row = (query.populate_existing().with_for_update() if lock else query).first()
    if row is None:
        _error(404, "not_found_or_forbidden", "Редакция не найдена или доступ отозван")
    _check_read(db, actor, row)
    return row


def list_reviews(db, actor, limit=50, offset=0, status=None, artifact_id=None):
    query = db.query(RequirementReview).filter(_visible_clause(actor))
    if status:
        if status not in {"submitted", "returned", "approved", "withdrawn"}:
            _error(422, "invalid_review_status", "Неизвестное состояние согласования")
        query = query.filter(RequirementReview.status == status)
    if artifact_id:
        query = query.filter(RequirementReview.artifact_id == artifact_id)
    total = query.count()
    rows = query.order_by(RequirementReview.updated_at.desc(), RequirementReview.id.desc()).offset(offset).limit(limit).all()
    return {"items": [serialize_review(row, actor, db) for row in rows], "total": total}


def _permissions(row, actor, target, changed=False):
    team_id = target.team_id if target is not None else row.team_id
    independent = row.creator_id != actor.id and _review_scope(actor, team_id)
    active = row.status == "submitted"
    assigned = active and independent and row.reviewer_id == actor.id
    return {
        "can_claim": bool(active and independent and row.reviewer_id is None),
        "can_approve": bool(assigned and not changed),
        "can_return": bool(assigned),
        "can_withdraw": bool(active and row.creator_id == actor.id),
        "can_open_workspace": bool(row.creator_id == actor.id),
    }


def serialize_review(row, actor, db):
    target = _check_read(db, actor, row)
    saved = (row.source_metadata or {}).get("significant_snapshot")
    changed = bool(saved is not None and saved != _significant_target(row.target_type, target))
    permissions = _permissions(row, actor, target, changed)
    iso = lambda value: value.isoformat() if value is not None else None
    return {
        "id": row.id, "subject_type": "requirement_revision", "title": row.title,
        "artifact_id": row.artifact_id, "artifact_revision": row.artifact_revision,
        "artifact_fingerprint": row.artifact_fingerprint,
        "artifact_snapshot": deepcopy(row.artifact_snapshot), "review_report": deepcopy(row.review_report),
        "session_id": row.session_id, "creator_id": row.creator_id,
        "creator_name": getattr(row.creator, "name", None), "reviewer_id": row.reviewer_id,
        "reviewer_name": getattr(row.reviewer, "name", None),
        "source_request_author_id": row.source_request_author_id,
        "target_type": row.target_type, "target_id": row.target_id,
        "source_metadata": deepcopy(row.source_metadata), "context_changed": changed,
        "status": row.status, "version": row.version, "comment": row.comment,
        "events": deepcopy(row.events), "created_at": iso(row.created_at), "updated_at": iso(row.updated_at),
        "permissions": permissions,
        "available_actions": [action for action in ("claim", "approve", "return", "withdraw") if permissions[f"can_{action}"]],
        "workspace_url": f"#/agent-v2?session={quote(row.session_id, safe='')}" if permissions["can_open_workspace"] else None,
        "url": f"#/review?tab=requirements&requirement_review={row.id}",
    }


def _event(row, actor, action, comment, key, payload_hash):
    row.events = [*(row.events or []), {
        "action": action, "actor_id": actor.id, "actor_name": getattr(actor, "name", ""),
        "comment": comment, "version": row.version, "idempotency_key": key,
        "payload_hash": payload_hash, "created_at": datetime.now(timezone.utc).isoformat(),
    }]


def _flush(db):
    try:
        db.flush()
    except StaleDataError:
        _error(409, "review_version_conflict", "Редакция уже обработана другим участником")


def submit_from_agent(db, actor, draft, linked_snapshot=None, *, session_id,
                      idempotency_key, expected_draft_hash, supersedes_review_id=None,
                      supersedes_version=None, review_report=None):
    """Accept the actual server-fetched draft, never a browser-provided artifact.

    The caller validates agent readiness and authenticated session ownership.
    This boundary additionally verifies canonical content, target access, replay,
    artifact ownership, and atomic replacement of an explicitly selected review.
    """
    if not operator_role(actor):
        _error(403, "review_submission_forbidden", "Подготовка БТ доступна BA/PO")
    key = _key(idempotency_key)
    if not isinstance(draft, dict) or draft.get("schema") != "business-requirement-draft.v2":
        _error(422, "invalid_requirement_artifact", "Ожидается документ БТ V2")
    snapshot = deepcopy(draft)
    fingerprint = snapshot.get("fingerprint")
    payload = {k: v for k, v in snapshot.items() if k != "fingerprint"}
    if fingerprint != expected_draft_hash or fingerprint != _hash(payload):
        _error(409, "draft_revision_conflict", "Рабочая редакция изменилась")
    artifact_id, revision = snapshot.get("artifact_id"), snapshot.get("revision")
    if not isinstance(artifact_id, str) or not artifact_id.strip() or len(artifact_id) > 128 or not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        _error(422, "artifact_identity_required", "Нужны постоянный ID и номер редакции БТ")
    if not isinstance(session_id, str) or not session_id or len(session_id) > 128:
        _error(422, "invalid_session", "Нужна исходная сессия документа")
    if review_report is not None and not isinstance(review_report, dict):
        _error(422, "invalid_review_report", "Некорректный пакет проверки")
    linked = linked_snapshot or snapshot.get("linked_object") or None
    draft_link = snapshot.get("linked_object")
    if (linked is not None and not isinstance(linked, dict)) or (draft_link is not None and not isinstance(draft_link, dict)):
        _error(422, "invalid_review_target", "Некорректный контекст документа")
    if linked_snapshot and draft_link and (
        linked_snapshot.get("object_type") != draft_link.get("object_type")
        or str(linked_snapshot.get("object_id")) != str(draft_link.get("object_id"))
    ):
        _error(409, "linked_object_conflict", "Контекст сессии и документ относятся к разным объектам")
    target_type, target_id = (linked.get("object_type"), linked.get("object_id")) if linked else (None, None)
    try:
        target_id = int(target_id) if target_id is not None else None
    except (ValueError, TypeError):
        _error(422, "invalid_review_target", "Некорректный номер исходного объекта")
    # Global lock order for this domain: ordinary source first, review second.
    target = _target(db, actor, target_type, target_id, lock=True)
    significant = _significant_target(target_type, target)
    # Compare only actual supplied source fields, including structured Request
    # drafts and Task requirement links, while accepting legacy text snapshots.
    for source_snapshot in (linked, draft_link):
        if source_snapshot and isinstance(source_snapshot.get("fields"), dict):
            original_fields = source_snapshot["fields"]
            if any(original_fields[k] != value for k, value in significant["fields"].items() if k in original_fields):
                _error(409, "source_context_changed", "Исходные материалы изменились; обновите контекст БТ")
    submission_hash = _hash({"artifact": snapshot, "target_type": target_type, "target_id": target_id,
        "session_id": session_id, "review_report": review_report or {},
        "supersedes_review_id": supersedes_review_id, "supersedes_version": supersedes_version})
    replay = db.query(RequirementReview).filter(RequirementReview.creator_id == actor.id, RequirementReview.idempotency_key == key).first()
    if replay:
        _check_read(db, actor, replay)
        if replay.submission_hash != submission_hash:
            _error(409, "idempotency_conflict", "Ключ операции уже использован с другим содержимым")
        if (replay.source_metadata or {}).get("significant_snapshot") != significant:
            _error(409, "source_context_changed", "Исходные материалы изменились после отправки")
        return replay
    history = db.query(RequirementReview).filter(RequirementReview.artifact_id == artifact_id).order_by(RequirementReview.id).with_for_update().all()
    if any(item.creator_id != actor.id for item in history):
        _error(403, "artifact_owner_conflict", "Документ принадлежит другому автору")
    if any(item.artifact_revision > revision or (item.artifact_revision == revision and item.artifact_fingerprint != fingerprint) for item in history):
        _error(409, "artifact_revision_conflict", "Номер редакции уже связан с другим содержимым")
    active = next((item for item in history if item.status == "submitted"), None)
    if active and (active.id != supersedes_review_id or active.version != supersedes_version):
        _error(409, "active_review_exists", "Сначала явно отзовите или замените отправленную редакцию", review_id=active.id, version=active.version)
    if supersedes_review_id is not None and active is None:
        _error(409, "review_version_conflict", "Заменяемая редакция уже обработана")
    source = {"snapshot": deepcopy(linked), "significant_snapshot": significant,
              "object_version": str(target.version or 0) if target is not None else None,
              "fingerprint": _hash(significant) if significant else None}
    source_request = target if target_type == "request" else (
        db.query(RequirementRequest).filter(RequirementRequest.task_id == target_id,
            RequirementRequest.is_deleted.is_(False)).first() if target_type == "task" else None)
    row = RequirementReview(artifact_id=artifact_id, active_artifact_id=artifact_id,
        artifact_revision=revision, artifact_fingerprint=fingerprint, artifact_snapshot=snapshot,
        review_report=deepcopy(review_report or {}), title=str(snapshot.get("title") or "Бизнес-требование")[:255],
        session_id=session_id, creator_id=actor.id, team_id=target.team_id if target is not None else actor.team_id,
        reviewer_id=None, source_request_author_id=source_request.user_id if source_request else None,
        target_type=target_type, target_id=target_id, source_metadata=source, status="submitted",
        comment="", events=[], idempotency_key=key, submission_hash=submission_hash, version=1)
    try:
        with db.begin_nested():
            if active:
                active.status, active.active_artifact_id = "withdrawn", None
                active.comment = "Заменено новой редакцией по решению автора"
                active.version += 1
                _event(active, actor, "supersede", active.comment, key, submission_hash)
                _flush(db)
            _event(row, actor, "submit", "", key, submission_hash)
            db.add(row)
            _flush(db)
    except IntegrityError:
        _error(409, "concurrent_review_submission", "Пакет уже отправлен параллельной операцией; обновите список")
    return row


def perform_action(db, actor, review_id, action, version, comment="", idempotency_key=""):
    key = _key(idempotency_key)
    if action not in {"claim", "approve", "return", "withdraw"}:
        _error(422, "invalid_review_action", "Неизвестное действие согласования")
    comment = (comment or "").strip()
    if len(comment) > 10000:
        _error(422, "comment_too_long", "Комментарий длиннее 10 000 символов")
    # Read immutable target coordinates first without locking the review. Both
    # submit/supersede and decisions then lock source -> review, never reverse.
    metadata = get_review(db, actor, review_id)
    target_coordinates = (metadata.target_type, metadata.target_id)
    target = _target(db, actor, *target_coordinates, lock=True)
    row = get_review(db, actor, review_id, lock=True)
    if (row.target_type, row.target_id) != target_coordinates:
        _error(409, "review_target_conflict", "Исходный объект согласования изменился")
    payload_hash = _hash({"action": action, "version": version, "comment": comment})
    previous = next((event for event in row.events or [] if event.get("idempotency_key") == key and event.get("actor_id") == actor.id), None)
    if previous:
        if previous.get("payload_hash") != payload_hash:
            _error(409, "idempotency_conflict", "Ключ операции уже использован с другим содержимым")
        return row
    if row.version != version:
        _error(409, "review_version_conflict", "Согласование уже изменилось", current_version=row.version)
    changed = (row.source_metadata or {}).get("significant_snapshot") != _significant_target(row.target_type, target)
    permissions = _permissions(row, actor, target, changed)
    if action == "approve" and changed:
        _error(409, "source_context_changed", "Исходное описание изменилось; требуется повторная проверка")
    if not permissions[f"can_{action}"]:
        _error(403, "review_action_forbidden", "Действие недоступно; автор не может согласовать собственное БТ")
    if action == "return" and not comment:
        _error(422, "review_comment_required", "При возврате укажите замечания")
    if action == "claim":
        row.reviewer_id = actor.id
    else:
        row.status = {"approve": "approved", "return": "returned", "withdraw": "withdrawn"}[action]
        row.active_artifact_id = None
        row.comment = comment
    row.version += 1
    row.updated_at = datetime.now(timezone.utc)
    _event(row, actor, action, comment, key, payload_hash)
    _flush(db)
    return row
