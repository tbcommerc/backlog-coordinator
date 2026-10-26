"""Focus filters use the complete ACL-scoped selection, without protected fixtures."""
from datetime import date, datetime, timezone
import pytest
from pydantic import ValidationError
from test_work_tasks import db, row, user
from services.work_query import Filters, Selection


def populate(db):
    # Moscow is already October 22 at this UTC instant.
    for index, (due, status, blocked, team) in enumerate([
        (date(2026, 10, 21), 'in_progress', 'Waiting', 10),
        (date(2026, 10, 22), 'ready', None, 10),
        (date(2026, 10, 22), 'done', None, 10),
        (date(2026, 10, 22), 'ready', None, 99),
    ], 1):
        task = row(status=status, blocked_reason=blocked)
        task.id = index
        task.due_date = due
        task.execution_team_id = team
        task.requester_id = 9
        task.assignee_id = 2
        task.acceptor_id = 3
        task.requester_team_id = team
        db.add(task)
    db.commit()


@pytest.mark.parametrize('focus,expected', [('today', [2]), ('overdue', [1]), ('blocked', [1])])
def test_focus_respects_moscow_day_acl_and_active_state(db, focus, expected):
    populate(db)
    selection = Selection(db, user(), Filters(view='all', status='', focus=focus),
                          now=datetime(2026, 10, 21, 22, tzinfo=timezone.utc))
    assert [task.id for task in selection.query.all()] == expected
    assert selection.focus_counts() == {'today': 1, 'overdue': 1, 'blocked': 1}
    assert selection.aggregates()[1]['total'] == 1


def test_focus_counts_keep_other_filters(db):
    populate(db)
    selection = Selection(db, user(), Filters(view='all', status='ready', focus='overdue'),
                          now=datetime(2026, 10, 21, 22, tzinfo=timezone.utc))
    assert selection.query.count() == 0
    assert selection.focus_counts() == {'today': 1, 'overdue': 0, 'blocked': 0}


def test_invalid_focus_is_rejected():
    with pytest.raises(ValidationError):
        Filters(focus='tomorrow')
