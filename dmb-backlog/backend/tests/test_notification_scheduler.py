import asyncio
from contextlib import contextmanager

import pytest

import notification_scheduler


def test_notification_check_always_closes_session(monkeypatch):
    events = []

    class FakeSession:
        def close(self):
            events.append("closed")

    monkeypatch.setattr(notification_scheduler, "SessionLocal", FakeSession)
    monkeypatch.setattr(
        notification_scheduler,
        "check_scheduled_notifications",
        lambda db: events.append("checked"),
    )

    notification_scheduler.run_notification_check()
    assert events == ["checked", "closed"]


def test_notification_check_closes_session_after_failure(monkeypatch):
    events = []

    class FakeSession:
        def close(self):
            events.append("closed")

    def fail(_db):
        raise RuntimeError("boom")

    monkeypatch.setattr(notification_scheduler, "SessionLocal", FakeSession)
    monkeypatch.setattr(notification_scheduler, "check_scheduled_notifications", fail)

    try:
        notification_scheduler.run_notification_check()
    except RuntimeError:
        pass
    assert events == ["closed"]


def test_scheduler_does_not_run_without_singleton_lease(monkeypatch):
    events = []

    @contextmanager
    def no_lease(_name):
        yield None

    async def stop_after_standby(_seconds):
        events.append("standby")
        raise asyncio.CancelledError

    monkeypatch.setattr(notification_scheduler, "singleton_worker_lock", no_lease)
    monkeypatch.setattr(notification_scheduler, "run_notification_check", lambda: events.append("checked"))
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", stop_after_standby)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(notification_scheduler.notification_scheduler_loop())
    assert events == ["standby"]


def test_scheduler_runs_when_singleton_lease_is_valid(monkeypatch):
    events = []

    class Lease:
        def __bool__(self): return True
        def is_valid(self): return True

    @contextmanager
    def lease(_name):
        yield Lease()

    async def stop_after_cycle(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(notification_scheduler, "singleton_worker_lock", lease)
    monkeypatch.setattr(notification_scheduler, "run_notification_check", lambda: events.append("checked"))
    monkeypatch.setattr(notification_scheduler.asyncio, "sleep", stop_after_cycle)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(notification_scheduler.notification_scheduler_loop())
    assert events == ["checked"]
