from datetime import date, timedelta
from uuid import uuid4

from models import ReportingMeeting, Task, Team
import pytest
from types import SimpleNamespace

import reporting_meetings
from reporting_meetings import complete_meeting, create_meeting_instance, reminder_date, task_reporting_context, validate_completion_readiness
from routers import reporting_meetings_router
from routers.reporting_meetings_router import MeetingCompleteCommand, MeetingCreateCommand, MeetingDateCommand, _can_fill_status


def meeting(kind: str, scheduled: date) -> ReportingMeeting:
    return ReportingMeeting(kind=kind, occurrence_key="test", scheduled_date=scheduled)


def test_directorate_reminder_is_previous_workday():
    assert reminder_date(meeting("directorate", date(2026, 8, 31))) == date(2026, 8, 28)


def test_did_reminder_is_two_calendar_days_before():
    assert reminder_date(meeting("did", date(2026, 9, 1))) == date(2026, 8, 30)


def test_key_projects_reminder_is_three_calendar_days_before():
    assert reminder_date(meeting("key_projects", date(2026, 9, 3))) == date(2026, 8, 31)


def test_only_assigned_po_pl_cl_can_fill_reporting_status():
    task = SimpleNamespace(team=SimpleNamespace(po_id=10, pl_id=20, cl_id=30))
    assert _can_fill_status(SimpleNamespace(id=10), task) is True
    assert _can_fill_status(SimpleNamespace(id=20), task) is True
    assert _can_fill_status(SimpleNamespace(id=30), task) is True
    assert _can_fill_status(SimpleNamespace(id=40), task) is False


def test_incomplete_meeting_requires_explicit_force():
    with pytest.raises(ValueError, match="Не заполнено задач: 4"):
        validate_completion_readiness({"missing_tasks": 4}, force=False)
    validate_completion_readiness({"missing_tasks": 4}, force=True)
    validate_completion_readiness({"missing_tasks": 0}, force=False)


def test_overdue_meeting_can_be_completed_until_fact_is_recorded(monkeypatch):
    stored = ReportingMeeting(
        id=42,
        kind="directorate",
        occurrence_key="completion-day",
        scheduled_date=date.today() - timedelta(days=1),
        state="planned",
    )
    monkeypatch.setattr(reporting_meetings, "_current_meeting", lambda db, kind: stored)
    monkeypatch.setattr(reporting_meetings, "meeting_completeness", lambda db, item: {"missing_tasks": 0})
    monkeypatch.setattr(reporting_meetings, "_meeting_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(reporting_meetings, "active_tasks", lambda db: [])
    monkeypatch.setattr(reporting_meetings, "_resolve_meeting_notifications", lambda *args: None)
    monkeypatch.setattr(reporting_meetings, "ensure_reporting_schedule", lambda db: None)

    class EmptyQuery:
        def filter(self, *args):
            return self

        def all(self):
            return []

    db = SimpleNamespace(query=lambda model: EmptyQuery(), flush=lambda: None)
    result = complete_meeting(db, stored, user_id=7, submitted_version=None)

    assert result.state == "held"


def test_future_meeting_cannot_be_completed(monkeypatch):
    stored = ReportingMeeting(
        id=43,
        kind="directorate",
        occurrence_key="future-completion",
        scheduled_date=date.today() + timedelta(days=1),
        state="planned",
    )
    monkeypatch.setattr(reporting_meetings, "_current_meeting", lambda db, kind: stored)

    with pytest.raises(ValueError, match="Будущую встречу"):
        complete_meeting(
            SimpleNamespace(),
            stored,
            user_id=7,
            submitted_version=None,
        )


def test_admin_can_create_future_meeting_instance():
    class EmptyQuery:
        def filter(self, *args):
            return self

        def first(self):
            return None

    added = []
    db = SimpleNamespace(
        query=lambda model: EmptyQuery(),
        add=added.append,
        flush=lambda: None,
    )
    days_until_next_monday = (7 - date.today().weekday()) % 7 or 7
    scheduled = date.today() + timedelta(days=days_until_next_monday)

    result = create_meeting_instance(db, "directorate", scheduled, user_id=7)

    assert result.kind == "directorate"
    assert result.scheduled_date == scheduled
    assert result.state == "planned"
    assert len(added) == 2


def test_meeting_command_routes_forward_only_supported_fields(monkeypatch):
    stored = SimpleNamespace(id=42, version=3)
    calls = {}

    monkeypatch.setattr(reporting_meetings_router, "_meeting_or_404", lambda db, meeting_id: stored)
    monkeypatch.setattr(reporting_meetings_router, "_commit_or_http", lambda db, operation: operation())
    monkeypatch.setattr(reporting_meetings_router, "meeting_to_dict", lambda db, value: {"id": value.id})

    def fake_schedule(db, meeting, new_date, **kwargs):
        calls["schedule"] = {"meeting": meeting, "new_date": new_date, **kwargs}
        return meeting

    def fake_complete(db, meeting, **kwargs):
        calls["complete"] = {"meeting": meeting, **kwargs}
        return meeting

    def fake_create(db, kind, scheduled_date, **kwargs):
        calls["create"] = {"kind": kind, "scheduled_date": scheduled_date, **kwargs}
        return stored

    monkeypatch.setattr(reporting_meetings_router, "schedule_meeting", fake_schedule)
    monkeypatch.setattr(reporting_meetings_router, "complete_meeting", fake_complete)
    monkeypatch.setattr(reporting_meetings_router, "create_meeting_instance", fake_create)

    reporting_meetings_router.assign_or_reschedule_meeting(
        42,
        MeetingDateCommand(scheduled_date=date(2026, 9, 8), reason="Перенос", version=3),
        db=SimpleNamespace(),
        current_user=SimpleNamespace(id=7),
    )
    reporting_meetings_router.mark_meeting_completed(
        42,
        MeetingCompleteCommand(version=3, force=True),
        db=SimpleNamespace(),
        current_user=SimpleNamespace(id=7),
    )
    reporting_meetings_router.create_reporting_meeting(
        MeetingCreateCommand(kind="key_projects", scheduled_date=date(2026, 9, 10)),
        db=SimpleNamespace(),
        current_user=SimpleNamespace(id=7),
    )

    assert calls["schedule"] == {
        "meeting": stored,
        "new_date": date(2026, 9, 8),
        "reason": "Перенос",
        "user_id": 7,
        "submitted_version": 3,
    }
    assert calls["complete"]["force"] is True
    assert calls["create"] == {
        "kind": "key_projects",
        "scheduled_date": date(2026, 9, 10),
        "user_id": 7,
    }


def test_context_falls_back_to_current_task_status_when_meeting_row_is_missing(db):
    team = Team(name=f"Тестовая команда {uuid4()}")
    db.add(team)
    db.flush()
    task = Task(
        team_id=team.id,
        title="Тестовая задача",
        directorate_status="Содержательный статус для директорской.",
        did_status="Содержательный статус для ДИД.",
        key_project_status="Содержательный статус для ключевых проектов.",
    )
    db.add(task)
    db.commit()

    context = task_reporting_context(db, task, can_edit=False)

    expected = {
        "directorate": task.directorate_status,
        "did": task.did_status,
        "key_projects": task.key_project_status,
    }
    assert {item["kind"]: item["current_status"]["text"] for item in context["items"]} == expected
    assert all(item["current_status"]["version"] == 0 for item in context["items"])
    db.rollback()
