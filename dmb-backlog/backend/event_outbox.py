"""Transactional outbox dispatcher backed by a shared Redis Stream."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
import uuid
from datetime import datetime, timedelta

from sqlalchemy import or_

from config import settings
from database import SessionLocal
from models import EventOutbox, IdempotencyRecord
from metrics import inc_counter
from worker_lock import singleton_worker_lock


logger = logging.getLogger("dmb_backlog.event_outbox")


def enqueue_user_event(db, *, user_id: int, event_type: str, payload: dict | None = None) -> None:
    """Add a user-scoped event to the caller's current transaction."""
    db.add(EventOutbox(
        event_type=event_type,
        aggregate_type="notification",
        audience_user_id=user_id,
        payload=payload or {},
    ))


def _claim_batch(worker_id: str, batch_size: int) -> list[dict]:
    now = datetime.utcnow()
    stale_before = now - timedelta(seconds=settings.OUTBOX_CLAIM_TIMEOUT_SECONDS)
    db = SessionLocal()
    try:
        query = db.query(EventOutbox).filter(
            EventOutbox.processed_at.is_(None),
            EventOutbox.dead_lettered_at.is_(None),
            EventOutbox.available_at <= now,
            or_(
                EventOutbox.claim_token.is_(None),
                EventOutbox.claimed_at < stale_before,
            ),
        ).order_by(EventOutbox.id).limit(batch_size)
        if db.bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        rows = query.all()
        claim_token = f"{worker_id}:{uuid.uuid4().hex}"
        result = []
        for row in rows:
            row.claim_token = claim_token
            row.claimed_at = now
            row.attempts = (row.attempts or 0) + 1
            result.append({
                "id": row.id,
                "event_type": row.event_type,
                "aggregate_type": row.aggregate_type,
                "aggregate_id": row.aggregate_id,
                "aggregate_version": row.aggregate_version,
                "audience_user_id": row.audience_user_id,
                "payload": row.payload or {},
                "claim_token": claim_token,
                "attempts": row.attempts,
            })
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _mark_processed(event_id: int, claim_token: str) -> None:
    db = SessionLocal()
    try:
        db.query(EventOutbox).filter(
            EventOutbox.id == event_id,
            EventOutbox.claim_token == claim_token,
            EventOutbox.processed_at.is_(None),
        ).update({
            EventOutbox.processed_at: datetime.utcnow(),
            EventOutbox.claim_token: None,
            EventOutbox.claimed_at: None,
            EventOutbox.last_error: None,
        }, synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _release_claims(
    events: list[dict],
    error: str,
    *,
    dead_letter_event_id: int | None = None,
) -> int:
    if not events:
        return 0
    db = SessionLocal()
    dead_lettered = 0
    try:
        for item in events:
            move_to_dead_letter = (
                item["id"] == dead_letter_event_id
                and item.get("attempts", 0) >= settings.OUTBOX_MAX_ATTEMPTS
            )
            if move_to_dead_letter:
                dead_lettered += 1
            db.query(EventOutbox).filter(
                EventOutbox.id == item["id"],
                EventOutbox.claim_token == item["claim_token"],
                EventOutbox.processed_at.is_(None),
            ).update({
                EventOutbox.claim_token: None,
                EventOutbox.claimed_at: None,
                EventOutbox.last_error: error[:2000],
                EventOutbox.dead_lettered_at: datetime.utcnow() if move_to_dead_letter else None,
                EventOutbox.available_at: datetime.utcnow() + timedelta(
                    seconds=min(60, max(1, item.get("attempts", 1) * 2)),
                ),
            }, synchronize_session=False)
        db.commit()
        return dead_lettered
    finally:
        db.close()


def _stream_fields(item: dict) -> dict[str, str]:
    return {
        "event_id": str(item["id"]),
        "event_type": item["event_type"],
        "aggregate_type": item["aggregate_type"],
        "aggregate_id": "" if item["aggregate_id"] is None else str(item["aggregate_id"]),
        "aggregate_version": "" if item["aggregate_version"] is None else str(item["aggregate_version"]),
        "audience_user_id": "" if item["audience_user_id"] is None else str(item["audience_user_id"]),
        "payload": json.dumps(item["payload"], ensure_ascii=False, separators=(",", ":")),
    }


def cleanup_processed_events(batch_size: int = 1000) -> int:
    """Bound outbox storage; one process performs each cleanup batch."""
    with singleton_worker_lock("dmb.event-outbox-cleanup") as lease:
        if not lease:
            return 0
        cutoff = datetime.utcnow() - timedelta(days=settings.OUTBOX_RETENTION_DAYS)
        dead_letter_cutoff = datetime.utcnow() - timedelta(
            days=settings.OUTBOX_DEAD_LETTER_RETENTION_DAYS
        )
        db = SessionLocal()
        try:
            ids = [row.id for row in db.query(EventOutbox.id).filter(or_(
                (
                    EventOutbox.processed_at.is_not(None)
                    & (EventOutbox.processed_at < cutoff)
                ),
                (
                    EventOutbox.dead_lettered_at.is_not(None)
                    & (EventOutbox.dead_lettered_at < dead_letter_cutoff)
                ),
            )).order_by(EventOutbox.id).limit(batch_size).all()]
            deleted = 0
            if ids:
                deleted = db.query(EventOutbox).filter(EventOutbox.id.in_(ids)).delete(
                    synchronize_session=False
                )
            idempotency_cutoff = datetime.utcnow() - timedelta(
                days=settings.IDEMPOTENCY_RETENTION_DAYS
            )
            db.query(IdempotencyRecord).filter(
                IdempotencyRecord.created_at < idempotency_cutoff
            ).delete(synchronize_session=False)
            db.commit()
            return deleted
        finally:
            db.close()


async def dispatch_outbox_once(redis_client, *, worker_id: str, batch_size: int | None = None) -> int:
    batch = await asyncio.to_thread(
        _claim_batch,
        worker_id,
        batch_size or settings.OUTBOX_BATCH_SIZE,
    )
    if not batch:
        return 0

    completed = 0
    try:
        for item in batch:
            await redis_client.xadd(
                settings.EVENT_STREAM_NAME,
                _stream_fields(item),
                maxlen=settings.EVENT_STREAM_MAXLEN,
                approximate=True,
            )
            await asyncio.to_thread(_mark_processed, item["id"], item["claim_token"])
            inc_counter("dmb_outbox_published_total", labels={"event_type": item["event_type"]})
            completed += 1
    except Exception as exc:
        dead_letter_event_id = None
        if type(exc).__name__ == "ResponseError" and completed < len(batch):
            dead_letter_event_id = batch[completed]["id"]
        dead_lettered = await asyncio.to_thread(
            _release_claims,
            batch[completed:],
            str(exc),
            dead_letter_event_id=dead_letter_event_id,
        )
        inc_counter("dmb_outbox_publish_errors_total", labels={"error": type(exc).__name__})
        if dead_lettered:
            inc_counter("dmb_outbox_dead_lettered_total", dead_lettered)
        raise
    return completed


async def event_outbox_dispatcher_loop() -> None:
    """Continuously dispatch events; safe to run in every web worker."""
    if not settings.REDIS_URL:
        logger.warning("Event outbox dispatcher disabled: REDIS_URL is not configured")
        return

    from redis.asyncio import Redis

    worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await redis_client.ping()
        next_cleanup_at = 0.0
        while True:
            try:
                if time.monotonic() >= next_cleanup_at:
                    await asyncio.to_thread(cleanup_processed_events)
                    next_cleanup_at = time.monotonic() + 3600
                processed = await dispatch_outbox_once(redis_client, worker_id=worker_id)
                await asyncio.sleep(0 if processed else settings.OUTBOX_POLL_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Event outbox dispatch failed")
                await asyncio.sleep(settings.OUTBOX_RETRY_INTERVAL_SECONDS)
    finally:
        await redis_client.aclose()
