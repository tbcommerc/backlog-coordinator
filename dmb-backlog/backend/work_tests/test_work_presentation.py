from types import SimpleNamespace
from services.work_presentation import next_step, readiness


def task(**changes):
    return SimpleNamespace(**dict(dict(status='ready', assignment_state='accepted',
        assignee_id=1, acceptor_id=2, requester_id=3, execution_team_id=10,
        acceptance_required=True, blocked_reason=None, description='Результат', due_date='2026-11-01'), **changes))


def test_acceptance_uses_acceptor_and_current_user_capabilities():
    row = task(status='in_acceptance')
    step = next_step(row, {'available_actions': []}, {1: 'Исполнитель', 2: 'Приёмщик'})
    assert step['actor_id'] == 2 and step['actor_name'] == 'Приёмщик'
    assert step['actionable'] is False
    assert next_step(row, {'available_actions': ['done']})['actionable'] is True


def test_assignment_and_readiness_do_not_grant_permission():
    row = task(status='new', assignment_state='proposed', assignee_id=None, description='')
    assert readiness(row) == {'missing_fields': ['description', 'assignee_id'], 'assignment_pending': True}
    step = next_step(row, {}, team_name='Команда')
    assert step['actor_kind'] == 'team' and step['actor_name'] == 'Команда'
    assert step['actionable'] is False


def test_closed_tasks_have_no_active_blocker_step():
    for status in ('done', 'cancelled'):
        assert next_step(task(status=status, blocked_reason='Старое препятствие'), {'can_block': True}) is None
