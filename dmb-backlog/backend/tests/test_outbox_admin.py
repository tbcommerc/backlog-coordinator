from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import AuditLog, EventOutbox
from outbox_admin import DeadLetterConflict, requeue_dead_letter


def test_dead_letter_requeue_is_atomic_and_audited():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    EventOutbox.__table__.create(engine)
    AuditLog.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    db = Session()
    event = EventOutbox(
        event_type="report.updated",
        aggregate_type="report",
        aggregate_id=7,
        payload={},
        attempts=10,
        dead_lettered_at=datetime.utcnow(),
        last_error="invalid payload",
    )
    db.add(event)
    db.commit()

    result = requeue_dead_letter(
        db,
        event_id=event.id,
        expected_attempts=10,
        actor_user_id=None,
        request_id="outbox-requeue-test",
        trace_id="1" * 32,
    )
    db.commit()
    db.refresh(event)

    assert result.previous_attempts == 10
    assert event.dead_lettered_at is None
    assert event.attempts == 0
    assert event.last_error is None
    audit = db.query(AuditLog).one()
    assert audit.action == "requeue"
    assert audit.request_id == "outbox-requeue-test"
    assert audit.trace_id == "1" * 32


def test_dead_letter_requeue_rejects_stale_attempt_count():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    EventOutbox.__table__.create(engine)
    AuditLog.__table__.create(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    event = EventOutbox(
        event_type="task.updated",
        aggregate_type="task",
        payload={},
        attempts=12,
        dead_lettered_at=datetime.utcnow(),
    )
    db.add(event)
    db.commit()
    with pytest.raises(DeadLetterConflict):
        requeue_dead_letter(
            db,
            event_id=event.id,
            expected_attempts=10,
            actor_user_id=None,
            request_id=None,
            trace_id=None,
        )
