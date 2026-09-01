"""Database-backed idempotency reservations shared by all API workers."""
from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from models import IdempotencyRecord


def request_fingerprint(data) -> str:
    encoded = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def reserve_idempotency(
    db,
    *,
    operation: str,
    user_id: int,
    request_key: str | None,
    request_data,
) -> tuple[IdempotencyRecord | None, bool]:
    """Return (record, is_new); a new record commits with the business change."""
    normalized_key = str(request_key or "").strip()
    if not normalized_key:
        return None, False
    fingerprint = request_fingerprint(request_data)

    def find_existing():
        return db.query(IdempotencyRecord).filter(
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.user_id == user_id,
            IdempotencyRecord.request_key == normalized_key,
        ).first()

    existing = find_existing()
    if existing:
        _verify_fingerprint(existing, fingerprint)
        return existing, False

    record = IdempotencyRecord(
        operation=operation,
        user_id=user_id,
        request_key=normalized_key,
        request_hash=fingerprint,
    )
    try:
        with db.begin_nested():
            db.add(record)
            db.flush()
        return record, True
    except IntegrityError:
        existing = find_existing()
        if existing is None:
            raise
        _verify_fingerprint(existing, fingerprint)
        return existing, False


def _verify_fingerprint(record: IdempotencyRecord, fingerprint: str) -> None:
    if record.request_hash != fingerprint:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "idempotency_key_reused",
                "message": "Этот идентификатор запроса уже использован с другими данными.",
            },
        )
