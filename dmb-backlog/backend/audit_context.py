"""Request context and SQLAlchemy hooks for transaction-bound audit records."""
from __future__ import annotations

import json
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from models import AuditLog


@dataclass(frozen=True)
class AuditRequestContext:
    request_id: str
    trace_id: str | None
    user_id: int | None
    method: str
    path: str
    ip_address: str | None


_audit_context: ContextVar[AuditRequestContext | None] = ContextVar(
    "dmb_audit_context",
    default=None,
)

_INTERNAL_TABLES = {
    "audit_log",
    "event_outbox",
    "idempotency_records",
    "refresh_sessions",
    "task_history",
    "task_reporting_status_revisions",
    "reporting_meeting_history",
    "task_viewers",
    "notifications",
}


def begin_audit_request(
    *,
    request_id: str | None,
    trace_id: str | None,
    user_id: int | None,
    method: str,
    path: str,
    ip_address: str | None,
) -> Token:
    context = AuditRequestContext(
        request_id=(request_id or uuid.uuid4().hex)[:64],
        trace_id=(trace_id or "")[:32] or None,
        user_id=user_id,
        method=method[:16],
        path=path[:500],
        ip_address=ip_address,
    )
    return _audit_context.set(context)


def end_audit_request(token: Token) -> None:
    _audit_context.reset(token)


def current_audit_request() -> AuditRequestContext | None:
    return _audit_context.get()


def _changed_fields(obj) -> list[str]:
    state = inspect(obj)
    return sorted(
        attr.key
        for attr in state.mapper.column_attrs
        if state.attrs[attr.key].history.has_changes()
    )


@event.listens_for(Session, "before_flush")
def _capture_transaction_changes(session: Session, flush_context, instances) -> None:
    if current_audit_request() is None:
        return
    pending = session.info.setdefault("dmb_audit_pending", [])
    seen = session.info.setdefault("dmb_audit_seen", set())

    candidates = (
        [(obj, "create") for obj in session.new]
        + [(obj, "update") for obj in session.dirty if session.is_modified(obj, include_collections=False)]
        + [(obj, "delete") for obj in session.deleted]
    )
    for obj, action in candidates:
        table = getattr(obj, "__table__", None)
        if table is None or table.name in _INTERNAL_TABLES or isinstance(obj, AuditLog):
            continue
        marker = (id(obj), action)
        if marker in seen:
            continue
        seen.add(marker)
        fields = _changed_fields(obj)
        if action == "update" and not fields:
            continue
        pending.append((obj, action, fields))


@event.listens_for(Session, "after_flush_postexec")
def _write_transaction_audit(session: Session, flush_context) -> None:
    pending = session.info.pop("dmb_audit_pending", [])
    if not pending:
        return
    context = current_audit_request()
    if context is None:
        return
    for obj, action, fields in pending:
        table = obj.__table__.name
        entity_id = getattr(obj, "id", None)
        details = {
            "source": "http",
            "changed_fields": fields,
        }
        details.update({"method": context.method, "path": context.path})
        session.add(AuditLog(
            user_id=context.user_id,
            action=action,
            entity_type=table[:50],
            entity_id=entity_id if isinstance(entity_id, int) else None,
            details=json.dumps(details, ensure_ascii=False, separators=(",", ":")),
            ip_address=context.ip_address,
            request_id=context.request_id,
            trace_id=context.trace_id,
        ))


@event.listens_for(Session, "after_transaction_end")
def _clear_audit_session_state(session: Session, transaction) -> None:
    if transaction.parent is None:
        session.info.pop("dmb_audit_pending", None)
        session.info.pop("dmb_audit_seen", None)
