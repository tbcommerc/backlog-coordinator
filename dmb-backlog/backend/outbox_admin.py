"""Operational dead-letter inspection and safe single-event replay."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from models import AuditLog, EventOutbox


class DeadLetterNotFound(LookupError):
    pass


class DeadLetterConflict(RuntimeError):
    pass


@dataclass(frozen=True)
class RequeueResult:
    event_id: int
    event_type: str
    previous_attempts: int


def serialize_dead_letter(row: EventOutbox) -> dict:
    return {
        "id": row.id,
        "event_type": row.event_type,
        "aggregate_type": row.aggregate_type,
        "aggregate_id": row.aggregate_id,
        "aggregate_version": row.aggregate_version,
        "audience_user_id": row.audience_user_id,
        "payload": row.payload or {},
        "attempts": row.attempts or 0,
        "last_error": row.last_error,
        "created_at": row.created_at,
        "dead_lettered_at": row.dead_lettered_at,
    }


def requeue_dead_letter(
    db: Session,
    *,
    event_id: int,
    expected_attempts: int,
    actor_user_id: int | None,
    request_id: str | None,
    trace_id: str | None,
) -> RequeueResult:
    query = db.query(EventOutbox).filter(EventOutbox.id == event_id)
    if db.bind.dialect.name == "postgresql":
        query = query.with_for_update()
    row = query.first()
    if row is None or row.dead_lettered_at is None:
        raise DeadLetterNotFound(f"Dead-letter event {event_id} not found")
    actual_attempts = row.attempts or 0
    if actual_attempts != expected_attempts:
        raise DeadLetterConflict(
            f"Dead-letter event changed: expected attempts={expected_attempts}, actual={actual_attempts}"
        )

    result = RequeueResult(
        event_id=row.id,
        event_type=row.event_type,
        previous_attempts=actual_attempts,
    )
    row.dead_lettered_at = None
    row.processed_at = None
    row.claimed_at = None
    row.claim_token = None
    row.available_at = datetime.utcnow()
    row.attempts = 0
    row.last_error = None
    db.add(AuditLog(
        user_id=actor_user_id,
        action="requeue",
        entity_type="event_outbox",
        entity_id=event_id,
        details=json.dumps({
            "source": "dead_letter_requeue",
            "event_type": result.event_type,
            "previous_attempts": result.previous_attempts,
        }, ensure_ascii=False, separators=(",", ":")),
        request_id=request_id,
        trace_id=trace_id,
    ))
    return result
