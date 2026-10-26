"""Read-only work presentation derived from the existing command capabilities."""


def readiness(row):
    return {'missing_fields': [name for name in ('description', 'assignee_id', 'due_date')
                               if not getattr(row, name)],
            'assignment_pending': row.assignment_state == 'proposed'}


def next_step(row, capabilities, people=None, team_name=None):
    if row.status in ('done', 'cancelled'):
        return None
    people = people or {}
    actor_kind, actor_id = 'assignee', row.assignee_id
    if row.assignment_state == 'proposed':
        kind, label, action = 'assignment', 'Принять назначение', 'accept-assignment'
        actor_kind, actor_id = 'team', row.execution_team_id
        actionable = capabilities.get('can_decide_assignment', False)
    elif row.status == 'in_acceptance':
        kind, label, action = 'acceptance', 'Принять результат', 'done'
        actor_kind, actor_id = 'acceptor', row.acceptor_id
        actionable = action in capabilities.get('available_actions', [])
    elif row.blocked_reason:
        kind, label, action = 'blocker', 'Снять препятствие', 'clear-blocker'
        actionable = capabilities.get('can_block', False)
    elif row.status == 'new':
        kind, label, action = 'prepare', 'Подготовить к исполнению', 'ready'
        actor_kind, actor_id = 'requester', row.requester_id
        actionable = action in capabilities.get('available_actions', [])
    else:
        kind = 'start' if row.status == 'ready' else 'result'
        action = 'in_progress' if row.status == 'ready' else 'in_acceptance' if row.acceptance_required else 'done'
        label = {'in_progress': 'Начать работу', 'in_acceptance': 'Передать на приёмку', 'done': 'Завершить'}[action]
        actionable = action in capabilities.get('available_actions', [])
    return {'kind': kind, 'label': label, 'actor_kind': actor_kind, 'actor_id': actor_id,
            'actor_name': team_name if actor_kind == 'team' else people.get(actor_id),
            'action': action, 'actionable': actionable}
