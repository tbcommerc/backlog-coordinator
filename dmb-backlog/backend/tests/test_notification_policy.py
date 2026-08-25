from pathlib import Path

import notifications
from datetime import date, datetime
from types import SimpleNamespace


def test_deadline_dictionary_periods_resolve_to_period_end():
    assert notifications.resolve_deadline_date(SimpleNamespace(code="Q3_2026", name="3Q 2026")) == date(2026, 9, 30)
    assert notifications.resolve_deadline_date(SimpleNamespace(code="", name="4Q 2026")) == date(2026, 12, 31)
    assert notifications.resolve_deadline_date(SimpleNamespace(code="Y2026", name="2026")) == date(2026, 12, 31)


def test_deadline_resolution_accepts_dates_and_ignores_no_deadline():
    assert notifications.resolve_deadline_date(date(2026, 8, 24)) == date(2026, 8, 24)
    assert notifications.resolve_deadline_date(datetime(2026, 8, 24, 15, 30)) == date(2026, 8, 24)
    assert notifications.resolve_deadline_date(SimpleNamespace(code="no_deadline", name="БЕЗ СРОКА")) is None


def test_send_to_users_deduplicates_and_excludes_actor(monkeypatch):
    created = []
    monkeypatch.setattr(notifications, "_get_preferences", lambda db, uid: {})
    monkeypatch.setattr(
        notifications,
        "_create_notification",
        lambda db, uid, *args, **kwargs: created.append(uid),
    )

    notifications._send_to_users(
        object(), [7, 7, 8, 9], None, "status_change", "Изменение",
        exclude_user_ids={8, 9},
    )

    assert created == [7]


def test_scheduled_signals_keep_their_business_categories():
    source = Path(notifications.__file__).read_text(encoding="utf-8-sig")
    assert 'db, [uid], None, "stale"' in source
    assert 'db, [uid], None, "deadline"' in source
    assert 'db, [uid], None, "attrs"' in source


def test_editing_presence_does_not_create_inbox_notification():
    router = Path(__file__).parents[1] / "routers" / "task_collaboration_router.py"
    source = router.read_text(encoding="utf-8-sig")
    assert "notify_lock_acquired" not in source


def test_resolve_notification_marks_it_read_and_resolved():
    class Query:
        def filter(self, *args):
            return self

        def update(self, values, synchronize_session=False):
            self.values = values
            return 1

    class DB:
        def __init__(self):
            self.query_obj = Query()

        def query(self, model):
            return self.query_obj

        def flush(self):
            pass

    db = DB()
    notifications.resolve_notification(db, 10, 20)
    assert db.query_obj.values[notifications.Notification.is_resolved] is True
    assert db.query_obj.values[notifications.Notification.is_read] is True
