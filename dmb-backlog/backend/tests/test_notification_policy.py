from pathlib import Path

import notifications


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
