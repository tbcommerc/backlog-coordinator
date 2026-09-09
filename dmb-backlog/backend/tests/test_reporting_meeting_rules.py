from datetime import date, timedelta
from uuid import uuid4

from models import ReportingMeeting, Task, Team
import pytest
from types import SimpleNamespace

import reporting_meetings
from reporting_meetings import complete_meeting, create_meeting_instance, meeting_completeness, reminder_date, save_task_reporting_status, task_reporting_context
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


def test_po_pl_cl_and_team_participants_can_fill_reporting_status():
    task = SimpleNamespace(team=SimpleNamespace(id=7, po_id=10, pl_id=20, cl_id=30))
    assert _can_fill_status(SimpleNamespace(id=10, team_id=None, role_name="IT PL"), task) is True
    assert _can_fill_status(SimpleNamespace(id=20, team_id=7, role_name="PO/PL/CL"), task) is True
    assert _can_fill_status(SimpleNamespace(id=40, team_id=7, role_name="BA/Участник команды"), task) is True
    assert _can_fill_status(SimpleNamespace(id=41, team_id=8, role_name="BA/Участник команды"), task) is False
    assert _can_fill_status(SimpleNamespace(id=42, team_id=7, role_name="Лидер трайба"), task) is False


def test_admin_can_fill_reporting_status_for_any_team():
    role = SimpleNamespace(
        admin_access="full",
        backlog_dmb_access="none",
        backlog_team_access="none",
        reports_access="none",
        analytics_access="none",
        customer_access="none",
        settings_access="none",
    )
    user = SimpleNamespace(id=99, team_id=None, role_name="Администратор", role=role)
    task = SimpleNamespace(team=SimpleNamespace(id=7, po_id=10, pl_id=20, cl_id=30))

    assert _can_fill_status(user, task) is True


def test_calendar_list_can_skip_expensive_completeness(monkeypatch):
    stored = ReportingMeeting(id=42, kind="directorate", occurrence_key="test", scheduled_date=date(2026, 9, 7))
    captured = {}

    class MeetingQuery:
        def filter(self, *args):
            return self

        def all(self):
            return [stored]

    monkeypatch.setattr(reporting_meetings_router, "ensure_reporting_schedule", lambda db: None)
    monkeypatch.setattr(
        reporting_meetings_router,
        "_meeting_with_history",
        lambda db, item, **kwargs: captured.update(kwargs) or {"id": item.id},
    )
    monkeypatch.setattr(reporting_meetings_router, "check_permission", lambda *args: False)
    db = SimpleNamespace(query=lambda model: MeetingQuery(), commit=lambda: None)

    result = reporting_meetings_router.list_reporting_meetings(
        kind=None,
        include_closed=False,
        state=None,
        date_from=None,
        date_to=None,
        include_completeness=False,
        db=db,
        current_user=SimpleNamespace(),
    )

    assert result["items"] == [{"id": 42}]
    assert captured == {"include_completeness": False}


def test_reporting_status_requires_explicit_readiness_confirmation(db):
    team = Team(name=f"Команда готовности {uuid4()}")
    db.add(team)
    db.flush()
    task = Task(team_id=team.id, title="Статус с подтверждением")
    meeting_row = ReportingMeeting(
        kind="directorate",
        occurrence_key=f"ready-{uuid4()}",
        scheduled_date=date.today(),
        state="planned",
    )
    db.add_all([task, meeting_row])
    db.flush()

    draft = save_task_reporting_status(
        db,
        task=task,
        meeting=meeting_row,
        status_text="Черновик статуса",
        did_demo=False,
        is_ready=False,
        submitted_version=None,
        user_id=None,
    )
    assert draft.is_ready is False
    assert meeting_completeness(db, meeting_row)["filled_tasks"] == 0

    confirmed = save_task_reporting_status(
        db,
        task=task,
        meeting=meeting_row,
        status_text="Черновик статуса",
        did_demo=False,
        is_ready=True,
        submitted_version=draft.version,
        user_id=None,
        directorate_attention=True,
    )
    assert confirmed.is_ready is True
    assert confirmed.directorate_attention is True
    assert meeting_completeness(db, meeting_row)["filled_tasks"] == 1

    with pytest.raises(ValueError, match="заполните статус"):
        save_task_reporting_status(
            db,
            task=task,
            meeting=meeting_row,
            status_text="",
            did_demo=False,
            is_ready=True,
            submitted_version=confirmed.version,
            user_id=None,
        )
    db.rollback()


def test_overdue_meeting_can_be_completed_until_fact_is_recorded(monkeypatch):
    stored = ReportingMeeting(
        id=42,
        kind="directorate",
        occurrence_key="completion-day",
        scheduled_date=date.today() - timedelta(days=1),
        state="planned",
    )
    monkeypatch.setattr(reporting_meetings, "_current_meeting", lambda db, kind: stored)
    monkeypatch.setattr(reporting_meetings, "meeting_completeness", lambda db, item: {"missing_tasks": 4})
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
        MeetingCompleteCommand(version=3),
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
    assert "force" not in calls["complete"]
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
