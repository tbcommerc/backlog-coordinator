import asyncio

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
