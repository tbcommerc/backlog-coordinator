import asyncio
import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import event_outbox
from models import EventOutbox, Notification, Task
from routers import events_router


def isolated_session_factory(*tables):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    EventOutbox.__table__.create(engine)
    for table in tables:
        table.__table__.create(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def test_task_change_and_outbox_event_commit_atomically():
    engine, Session = isolated_session_factory(Task)
    db = Session()
    db.add(Task(team_id=1, title="Atomic", version=0))
    db.flush()
    assert db.query(EventOutbox).count() == 1
    db.rollback()
    assert db.query(Task).count() == 0
    assert db.query(EventOutbox).count() == 0

    db.add(Task(team_id=1, title="Committed", version=0))
    db.commit()
    event = db.query(EventOutbox).one()
    assert event.event_type == "task.created"
    assert event.aggregate_version == 0
    engine.dispose()


def test_notification_event_is_scoped_to_recipient():
    engine, Session = isolated_session_factory(Notification)
    db = Session()
    db.add(Notification(user_id=42, title="Message", message="Message", category="system"))
    db.commit()
    event = db.query(EventOutbox).one()
    assert event.event_type == "notification.created"
    assert event.audience_user_id == 42
    engine.dispose()


def test_dispatcher_marks_published_event_once(monkeypatch):
    engine, Session = isolated_session_factory()
    db = Session()
    db.add(EventOutbox(
        event_type="task.updated",
        aggregate_type="task",
        aggregate_id=7,
        aggregate_version=3,
        payload={"changed_fields": ["title"]},
    ))
    db.commit()
    monkeypatch.setattr(event_outbox, "SessionLocal", Session)

    class FakeRedis:
        def __init__(self):
            self.items = []

        async def xadd(self, stream, fields, **kwargs):
            self.items.append((stream, fields, kwargs))
            return "1-0"

    redis = FakeRedis()
    assert asyncio.run(event_outbox.dispatch_outbox_once(redis, worker_id="test")) == 1
    assert asyncio.run(event_outbox.dispatch_outbox_once(redis, worker_id="test")) == 0
    assert len(redis.items) == 1
    verify = Session()
    assert verify.query(EventOutbox).one().processed_at is not None
    engine.dispose()


def test_task_stream_event_is_filtered_by_readable_team(monkeypatch):
    engine, Session = isolated_session_factory(Task)
    db = Session()
    task = Task(team_id=9, title="Scoped", version=0)
    db.add(task)
    db.commit()
    monkeypatch.setattr(events_router, "SessionLocal", Session)
    def principal(readable_team_id, **overrides):
        values = {
            "user_id": 1,
            "readable_team_id": readable_team_id,
            "team_id": 9,
            "request_review_scope": "none",
            "customer_portal_only": False,
        }
        values.update(overrides)
        return events_router.EventStreamPrincipal(**values)

    current = principal(9)
    fields = {"aggregate_type": "task", "aggregate_id": str(task.id), "audience_user_id": ""}
    assert events_router._stream_event_visible(fields, current)
    assert not events_router._stream_event_visible(
        fields, principal(8)
    )
    assert events_router._stream_event_visible(
        fields, principal(None)
    )
    engine.dispose()


def test_requirement_stream_visibility_uses_owner_and_review_scope():
    fields = {
        "aggregate_type": "requirement",
        "aggregate_id": "77",
        "audience_user_id": "",
        "payload": '{"owner_user_id":5,"team_id":9}',
    }
    owner = events_router.EventStreamPrincipal(5, None, 1, "none", True)
    team_reviewer = events_router.EventStreamPrincipal(8, 9, 9, "team", False)
    other_reviewer = events_router.EventStreamPrincipal(8, 7, 7, "team", False)
    assert events_router._stream_event_visible(fields, owner)
    assert events_router._stream_event_visible(fields, team_reviewer)
    assert not events_router._stream_event_visible(fields, other_reviewer)


def test_poison_event_moves_to_dead_letter_after_max_attempts(monkeypatch):
    engine, Session = isolated_session_factory()
    db = Session()
    db.add(EventOutbox(event_type="task.updated", aggregate_type="task", aggregate_id=1, payload={}))
    db.commit()
    monkeypatch.setattr(event_outbox, "SessionLocal", Session)
    monkeypatch.setattr(event_outbox.settings, "OUTBOX_MAX_ATTEMPTS", 1)

    class ResponseError(Exception):
        pass

    class RejectingRedis:
        async def xadd(self, stream, fields, **kwargs):
            raise ResponseError("payload rejected")

    with pytest.raises(ResponseError):
        asyncio.run(event_outbox.dispatch_outbox_once(RejectingRedis(), worker_id="test"))
    verify = Session()
    row = verify.query(EventOutbox).one()
    assert row.dead_lettered_at is not None
    assert row.processed_at is None
    engine.dispose()
