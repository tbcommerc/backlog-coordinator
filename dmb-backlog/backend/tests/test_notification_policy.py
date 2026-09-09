from datetime import datetime
from pathlib import Path

import notifications
from models import EventOutbox, Notification, Role, Task, Team, User, UserNotificationPreference


def _role(db, name="Участник команды", *, global_read=False):
    role = Role(
        name=name,
        backlog_dmb_access="read" if global_read else "none",
        backlog_team_access="read_own",
    )
    db.add(role)
    db.flush()
    return role


def _user(db, email, name, role, team=None, *, active=True):
    user = User(
        email=email,
        password_hash="test",
        name=name,
        role_id=role.id,
        team_id=team.id if team else None,
        is_active=active,
    )
    db.add(user)
    db.flush()
    return user


def test_only_approved_categories_are_active():
    assert notifications.ACTIVE_NOTIFICATION_CATEGORIES == (
        "assignment",
        "reporting",
        "mention",
        "comment",
        "request",
    )
    assert notifications.MANDATORY_NOTIFICATION_CATEGORIES == {
        "assignment",
        "reporting",
        "mention",
        "request",
    }
    assert notifications.DEFAULT_PREFERENCES == {"comment": True}


def test_request_decision_notification_keeps_customer_deep_link(monkeypatch):
    captured = {}
    def capture_notification(*args, **kwargs):
        captured.update(kwargs)
        captured["task_id"] = args[2]
        captured["category"] = args[3]
        return kwargs
    monkeypatch.setattr(notifications, "_create_notification", capture_notification)
    request = type("Request", (), {"id": 17, "user_id": 8, "task_id": 44, "version": 3, "reject_reason": "Уточните период"})()
    notifications.notify_request_decision(object(), request, "returned", actor_id=5)
    assert captured["action_url"] == "#/customer/request/17"
    assert captured["event_type"] == "request.review.returned"
    assert captured["category"] == "request"
    assert captured["task_id"] is None
    assert notifications.normalize_notification_action_url("request", 44, "#/customer/request/17") == "#/customer/request/17"
    target = notifications.notification_target(type("Notification", (), {"category": "request", "task_id": 44, "action_url": "#/customer/request/17"})())
    assert target["kind"] == "request"
    assert target["request_id"] == 17


def test_mandatory_categories_ignore_disabled_legacy_preferences(monkeypatch):
    created = []
    monkeypatch.setattr(
        notifications,
        "_get_preferences",
        lambda db, uid: {"assignment": False, "reporting": False, "mention": False, "comment": False},
    )
    monkeypatch.setattr(
        notifications,
        "_create_notification",
        lambda db, uid, *args, **kwargs: created.append((uid, args[1])),
    )

    for category in ("assignment", "reporting", "mention", "comment", "request"):
        notifications._send_to_users(object(), [7], None, category, "Событие")

    assert created == [(7, "assignment"), (7, "reporting"), (7, "mention"), (7, "request")]


def test_comment_goes_to_primary_team_without_actor_or_mentioned_user(db):
    team = Team(name="Команда 1")
    other_team = Team(name="Команда 2")
    db.add_all([team, other_team])
    db.flush()
    role = _role(db)
    actor = _user(db, "actor@example.test", "Автор", role, team)
    teammate = _user(db, "teammate@example.test", "Коллега", role, team)
    mentioned = _user(db, "mentioned@example.test", "Упомянутый", role, team)
    _user(db, "inactive@example.test", "Неактивный", role, team, active=False)
    _user(db, "other@example.test", "Другая команда", role, other_team)
    task = Task(team_id=team.id, title="Обсуждаемая задача")
    db.add(task)
    db.flush()

    notifications.notify_comment(
        db,
        task,
        actor.id,
        excluded_recipient_ids={mentioned.id},
        commenter_name=actor.name,
        comment_id=91,
    )

    rows = db.query(Notification).all()
    assert [row.user_id for row in rows] == [teammate.id]
    assert rows[0].type == "task.comment.added"
    assert rows[0].action_url == f"#/backlog?task={task.id}&tab=com&comment=91"
    rows[0].is_read = True
    rows[0].read_at = datetime.utcnow()
    notifications._create_notification(
        db,
        teammate.id,
        task.id,
        "comment",
        "Комментарий обновлён",
        importance="high",
        action_url=f"#/backlog?task={task.id}&tab=com&comment=92",
        group_key=rows[0].group_key,
        event_type="task.comment.added",
    )
    assert db.query(Notification).count() == 1
    assert rows[0].title == "Комментарий обновлён"
    assert rows[0].action_url.endswith("comment=92")
    assert rows[0].importance == "high"
    assert rows[0].is_read is False
    assert rows[0].read_at is None
    assert rows[0].group_count == 2
    db.rollback()


def test_mentions_require_task_read_access(db):
    team = Team(name="Команда задачи")
    other_team = Team(name="Другая команда")
    db.add_all([team, other_team])
    db.flush()
    local_role = _role(db, "Локальная роль")
    global_role = _role(db, "Глобальная роль", global_read=True)
    teammate = _user(db, "local@example.test", "Коллега", local_role, team)
    inaccessible = _user(db, "foreign@example.test", "Без доступа", local_role, other_team)
    global_reader = _user(db, "global@example.test", "Глобальный читатель", global_role, other_team)
    inactive = _user(db, "off@example.test", "Неактивный", local_role, team, active=False)
    task = Task(team_id=team.id, title="Задача")
    db.add(task)
    db.flush()

    invalid = notifications.invalid_mention_user_ids(
        db,
        task,
        [teammate.id, inaccessible.id, global_reader.id, inactive.id, 999999],
    )

    assert invalid == sorted([inaccessible.id, inactive.id, 999999])
    db.rollback()


def test_comment_preference_is_the_only_optional_switch(db):
    team = Team(name="Команда")
    db.add(team)
    db.flush()
    role = _role(db)
    recipient = _user(db, "recipient@example.test", "Получатель", role, team)
    db.add(UserNotificationPreference(user_id=recipient.id, preferences='{"comment": false}'))
    db.flush()

    notifications._send_to_users(db, [recipient.id], None, "comment", "Комментарий")
    notifications._send_to_users(db, [recipient.id], None, "assignment", "Назначение")

    rows = db.query(Notification).all()
    assert [(row.user_id, row.category) for row in rows] == [(recipient.id, "assignment")]
    db.rollback()


def test_reassignment_closes_previous_assignment_and_opens_the_new_one(db):
    team = Team(name="Команда назначений")
    db.add(team)
    db.flush()
    role = _role(db)
    first = _user(db, "first@example.test", "Первый", role, team)
    second = _user(db, "second@example.test", "Второй", role, team)
    task = Task(team_id=team.id, title="Задача со сменой исполнителя")
    db.add(task)
    db.flush()

    notifications.notify_assignment(db, task, first.id, assigned_by_user_id=999)
    notifications.notify_assignment(db, task, second.id, assigned_by_user_id=999)

    first_row = db.query(Notification).filter(Notification.user_id == first.id).one()
    second_row = db.query(Notification).filter(Notification.user_id == second.id).one()
    assert first_row.is_resolved is True
    assert first_row.is_read is True
    assert first_row.read_at is not None
    assert second_row.is_resolved is False
    assert second_row.type == "task.assigned"
    db.rollback()


def test_feed_and_summary_hide_legacy_categories(db):
    team = Team(name="Команда ленты")
    db.add(team)
    db.flush()
    role = _role(db)
    recipient = _user(db, "feed@example.test", "Получатель", role, team)
    db.add_all([
        Notification(user_id=recipient.id, type="task.assigned", category="assignment", title="Назначение", message="Назначение"),
        Notification(user_id=recipient.id, type="meeting.status_update.required", category="reporting", title="Статусы", message="Статусы"),
        Notification(user_id=recipient.id, type="task.comment.added", category="comment", title="Готово на 100%", message="Готово на 100%"),
        Notification(user_id=recipient.id, type="task.assigned", category="assignment", title="Закрыто", message="Закрыто", is_resolved=True),
        Notification(user_id=recipient.id, type="risk", category="risk", title="Legacy", message="Legacy"),
    ])
    db.flush()

    items, total = notifications.get_notifications(db, recipient.id)
    summary = notifications.get_notification_summary(db, recipient.id)
    assert total == 4
    assert {item.category for item in items} == {"assignment", "reporting", "comment"}
    assert notifications.get_unread_count(db, recipient.id) == 3
    assert summary["unread"] == 3
    assert summary["requires_action"] == 1
    assert "risk" not in summary["by_category"]
    unread_items, unread_total = notifications.get_notifications(db, recipient.id, unread_only=True)
    assert unread_total == 3
    assert all(not item.is_resolved for item in unread_items)
    literal_items, literal_total = notifications.get_notifications(db, recipient.id, search="%")
    assert literal_total == 1
    assert literal_items[0].title == "Готово на 100%"
    reporting = db.query(Notification).filter(Notification.category == "reporting").one()
    assert notifications.dismiss_notification(db, reporting.id, recipient.id) == "mandatory_action"
    assert reporting.is_dismissed is False
    changed_ids = notifications.mark_all_read(db, recipient.id)
    assert len(changed_ids) == 3
    notifications.mark_unread(db, changed_ids, recipient.id)
    assert notifications.get_unread_count(db, recipient.id) == 3
    db.rollback()


def test_scheduler_only_delegates_to_reporting_reminders(monkeypatch):
    import reporting_meetings

    calls = []
    monkeypatch.setattr(
        reporting_meetings,
        "check_reporting_meeting_notifications",
        lambda db: calls.append(db),
    )

    class DB:
        def __init__(self):
            self.commits = 0

        def commit(self):
            self.commits += 1

    db = DB()
    notifications.check_scheduled_notifications(db)
    assert calls == [db]
    assert db.commits == 1


def test_legacy_generators_and_manual_resolve_are_absent():
    source = Path(notifications.__file__).read_text(encoding="utf-8-sig")
    for name in (
        "notify_status_change",
        "notify_express_import",
        "notify_new_request",
        "resolve_deadline_date",
        "resolve_notification",
    ):
        assert f"def {name}" not in source


def test_editing_presence_does_not_create_inbox_notification():
    router = Path(__file__).parents[1] / "routers" / "task_collaboration_router.py"
    source = router.read_text(encoding="utf-8-sig")
    assert "notify_lock_acquired" not in source


def test_attention_summary_only_counts_reporting():
    source = Path(notifications.__file__).read_text(encoding="utf-8-sig")
    block = source[source.index("def get_notification_summary"):source.index("def get_notifications")]
    requires_action = block[block.index("requires_action ="):block.index("today_start")]
    assert 'Notification.category == "reporting"' in requires_action
    assert "Notification.is_read == False" not in requires_action
    assert "action_rank = case(" in source
    assert "importance_rank = case(" in source
    assert "unread_rank = case(" in source


def test_feed_rechecks_current_task_scope_and_escapes_literal_search():
    source = Path(notifications.__file__).read_text(encoding="utf-8-sig")
    assert "task_read_scope_clause(user, Task)" in source
    assert 'Notification.task_id.is_(None)' in source
    assert '.ilike(pattern, escape="\\\\")' in source


def test_action_url_is_allowlisted_and_exposed_as_typed_target():
    unsafe = Notification(
        task_id=12,
        category="comment",
        action_url="https://example.test/backlog?task=12",
    )
    target = notifications.notification_target(unsafe)
    assert target == {
        "kind": "task_discussion",
        "url": "/backlog?task=12&tab=com",
        "task_id": 12,
        "tab": "com",
        "comment_id": None,
        "meeting_id": None,
    }
    assert notifications.normalize_notification_action_url(
        "reporting", None, "#/reporting-statuses?meeting_id=44"
    ) == "#/reporting-statuses?source=notification&meeting_id=44"
    assert notifications.normalize_notification_action_url(
        "reporting", 12, "#/backlog?task=12&tab=rep"
    ) == "#/reporting-statuses?source=notification"
    assert notifications.normalize_notification_action_url(
        "reporting", 12, None
    ) == "#/reporting-statuses?source=notification"
    legacy_reporting = Notification(
        task_id=12,
        category="reporting",
        action_url="#/backlog?task=12&tab=rep",
    )
    assert notifications.notification_target(legacy_reporting) == {
        "kind": "reporting_statuses",
        "url": "/reporting-statuses?source=notification",
        "task_id": 12,
        "tab": None,
        "comment_id": None,
        "meeting_id": None,
    }
    assert notifications.normalize_notification_action_url(
        "assignment", 12, "#/admin"
    ) == "#/backlog?task=12"


def test_snapshot_uses_one_revision_for_summary_and_surface_slices(db):
    role = _role(db, "Snapshot role", global_read=True)
    recipient = _user(db, "snapshot@example.test", "Snapshot User", role)
    db.add_all([
        Notification(
            user_id=recipient.id,
            type="meeting.status_update.required",
            category="reporting",
            title="Заполните статусы",
            message="Заполните статусы",
            action_url="#/reporting-statuses?meeting_id=42",
        ),
        Notification(
            user_id=recipient.id,
            type="task.comment.added",
            category="comment",
            title="Новый комментарий",
            message="Новый комментарий",
        ),
        EventOutbox(
            event_type="notification.created",
            aggregate_type="notification",
            audience_user_id=recipient.id,
            payload={},
        ),
    ])
    db.flush()

    snapshot = notifications.get_notification_snapshot(db, recipient.id, recipient)

    assert snapshot["revision"] > 0
    assert snapshot["summary"]["unread"] == 2
    assert snapshot["summary"]["requires_action"] == 1
    assert snapshot["recent_total"] == 2
    assert snapshot["action_total"] == 1
    assert [item.category for item in snapshot["action_items"]] == ["reporting"]
    from routers.notifications_router import _notification_response

    response = _notification_response(snapshot["action_items"][0])
    assert response.target.kind == "reporting_statuses"
    assert response.target.meeting_id == 42
    assert response.action_url == "#/reporting-statuses?source=notification&meeting_id=42"
    db.rollback()


def test_notifications_rank_action_then_importance_then_unread_and_recency(db):
    role = _role(db, "Ranking role", global_read=True)
    recipient = _user(db, "ranking@example.test", "Ranking User", role)
    now = datetime.utcnow()
    db.add_all([
        Notification(
            user_id=recipient.id,
            type="task.comment.added",
            category="comment",
            title="Unread medium",
            message="Unread medium",
            importance="medium",
            is_read=False,
            created_at=now,
        ),
        Notification(
            user_id=recipient.id,
            type="task.assigned",
            category="assignment",
            title="Read high",
            message="Read high",
            importance="high",
            is_read=True,
            created_at=now,
        ),
        Notification(
            user_id=recipient.id,
            type="meeting.status_update.required",
            category="reporting",
            title="Action high",
            message="Action high",
            importance="high",
            is_read=True,
            created_at=now,
        ),
        Notification(
            user_id=recipient.id,
            type="task.comment.added",
            category="comment",
            title="Read medium",
            message="Read medium",
            importance="medium",
            is_read=True,
            created_at=now,
        ),
        Notification(
            user_id=recipient.id,
            type="task.comment.added",
            category="comment",
            title="Unread low",
            message="Unread low",
            importance="low",
            is_read=False,
            created_at=now,
        ),
        Notification(
            user_id=recipient.id,
            type="task.comment.added",
            category="comment",
            title="Read low",
            message="Read low",
            importance="low",
            is_read=True,
            created_at=now,
        ),
    ])
    db.flush()

    items, total = notifications.get_notifications(
        db, recipient.id, per_page=5, current_user=recipient,
    )

    assert total == 6
    assert [item.title for item in items] == [
        "Action high", "Read high", "Unread medium", "Read medium", "Unread low",
    ]
    db.rollback()


def test_ux_metrics_use_only_bounded_non_personal_dimensions(monkeypatch):
    from routers import notifications_router
    from schemas import NotificationUxEventRequest

    counters = []
    histograms = []
    monkeypatch.setattr(notifications_router, "inc_counter", lambda name, labels=None: counters.append((name, labels)))
    monkeypatch.setattr(
        notifications_router,
        "observe_histogram",
        lambda name, value, labels=None: histograms.append((name, value, labels)),
    )
    payload = NotificationUxEventRequest(
        event="notification_target_opened",
        surface="dashboard",
        category="reporting",
        state="unread",
        duration_ms=1250,
    )

    assert notifications_router.notification_ux_event(payload, current_user=object()) == {"message": "accepted"}
    assert counters == [(
        "dmb_notification_ux_events_total",
        {"event": "notification_target_opened", "surface": "dashboard", "category": "reporting", "state": "unread"},
    )]
    assert histograms == [(
        "dmb_notification_ux_duration_seconds",
        1.25,
        {"event": "notification_target_opened", "surface": "dashboard"},
    )]
