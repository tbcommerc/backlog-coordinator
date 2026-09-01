from datetime import date

from models import ReportingMeeting
import pytest
from types import SimpleNamespace

from reporting_meetings import reminder_date, validate_completion_readiness
from routers.reporting_meetings_router import _can_fill_status


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
