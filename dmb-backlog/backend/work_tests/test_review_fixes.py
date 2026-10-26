"""Review regressions without creating protected data."""
from types import SimpleNamespace as NS
from services.work_tasks import notification_intent, WORK_ACTION_TYPES
from test_work_tasks import row, user


def test_acceptance_responsibility_is_addressed_to_acceptor():
    task = row(status="in_acceptance", acceptance_required=True)
    assert notification_intent(task, user(3), "transition", {"status": "in_progress"}) == (
        "work.acceptance.required", "Принять результат")
    assert notification_intent(task, user(2), "transition", {"status": "in_progress"})[0] not in WORK_ACTION_TYPES
    task.status = "done"
    assert notification_intent(task, user(3), "transition", {"status": "in_acceptance"}) == (
        "work.changed", "Результат принят")


def test_return_and_decline_have_explicit_recipient_and_action():
    task = row(status="in_progress")
    assert notification_intent(task, user(2), "transition", {"status":"in_acceptance"})[0] == "work.rework.required"
    task.status = "new"
    task.assignment_state = "declined"
    assert notification_intent(task, user(1), "assignment", {})[0] == "work.reassignment.required"


def test_history_redacts_unreadable_context_and_shows_changes(monkeypatch):
    from services import work_tasks as work
    from models import Task, User
    monkeypatch.setattr(work, "can_access_task", lambda *args: False)
    db = NS(get=lambda model, id: NS(name="Автор") if model == User else NS(title="Секрет", is_deleted=False))
    event = NS(id=1, actor_id=1, action="placement", version=2, reason="Перенос",
               created_at=None, before={"major_task_id":55,"status":"new"}, after={"status":"ready"})
    item = work.history_item(db, event, user())
    assert item["actor_name"] == "Автор"
    assert "Секрет" not in str(item)
    assert any(x["field"] == "status" and x["after"] == "ready" for x in item["changes"])


def test_completed_action_notification_is_resolved(monkeypatch):
    from services import work_tasks as work
    from models import Notification
    pending = NS(user_id=3, type="work.acceptance.required", is_resolved=False)
    added = []
    db = NS(
        get=lambda *args: user(3),
        query=lambda model: NS(filter=lambda *args: NS(all=lambda: [pending])) if model is Notification
        else NS(filter=lambda *args: []),
        add=added.append,
    )
    work.notify_work(db, row(status="done"), user(3), "transition", {"status":"in_acceptance"})
    assert pending.is_resolved
    assert pending.resolved_at is not None
    assert any(x.event_type == "notification.resolved" for x in added)


def test_reopening_invalidates_confirmation_even_when_result_text_is_reused():
    from services.work_tasks import transition_values
    from work_contract import Transition
    task = row(status="done", result_revision=7, acceptance_required=True)
    task.result_text = "Accepted"
    values = transition_values(task, user(3), Transition(version=1, status="ready", reason="New review"))
    assert values["result_revision"] == 8
    task.status = "in_progress"
    values = transition_values(task, user(2), Transition(version=1, status="in_acceptance", result_text="Changed"))
    assert values["result_revision"] == 8
