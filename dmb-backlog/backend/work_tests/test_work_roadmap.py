"""Roadmap regression without inserting protected records."""
import pytest
from fastapi import HTTPException
from test_work_tasks import db, row, user
from models import WorkComment, WorkHistory, Task, Project, RequirementRequest
from services import work_tasks as work
from services.work_query import Filters, Selection
from work_contract import Transition
from work_contract import WorkUpdate


def test_terms_change_requires_reason_and_preserves_presented_result(db):
    task = row(status='in_acceptance', acceptance_required=True)
    db.add(task); db.commit()
    with pytest.raises(HTTPException):
        work.update(db, task, user(), WorkUpdate(version=1, description='Новые критерии'))
    work.update(db, task, user(), WorkUpdate(version=1, description='Новые критерии', reason='Уточнение объёма'))
    assert task.status == 'in_progress' and task.result_text == 'Предыдущий итог'
    event = db.query(WorkHistory).one()
    assert event.reason == 'Уточнение объёма'
    assert event.before['description'] == 'Подготовить заключение'
    assert event.after['description'] == 'Новые критерии'


def test_restore_requires_reason_editor_and_new_assignment_review():
    task = row(status='cancelled')
    with pytest.raises(HTTPException):
        work.transition_values(task, user(), Transition(version=1, status='new'))
    with pytest.raises(HTTPException) as error:
        work.transition_values(task, user(2, scope='none'), Transition(version=1, status='new', reason='Ошибка'))
    assert error.value.status_code == 403
    values = work.transition_values(task, user(), Transition(version=1, status='new', reason='Ошибка отмены'))
    assert values['status'] == 'new' and values['assignment_state'] == 'proposed'
    assert 'result_text' not in values and 'id' not in values
    task.status = 'new'; task.assignment_state = values['assignment_state']
    with pytest.raises(HTTPException):
        work.transition_values(task, user(), Transition(version=1, status='ready'))


def test_activity_cursor_reaches_every_comment_and_history_entry(db, monkeypatch):
    from routers.work_tasks_router import comments, history
    WorkComment.__table__.create(db.bind)
    db.add(row())
    db.add_all([WorkComment(work_task_id=1, author_id=1, body=f'Сообщение {i}') for i in range(250)])
    db.add_all([WorkHistory(work_task_id=1, actor_id=1, action='updated', version=i+1,
                           before={}, after={}, reason='') for i in range(150)])
    db.commit()
    monkeypatch.setattr(work, 'history_item', lambda db, event, user: {'id': event.id})
    for read, count in [(comments, 250), (history, 150)]:
        ids = []; cursor = None
        while True:
            page = read(1, db=db, user=user(), before=cursor, limit=40, paginated=True)
            ids.extend(item.id if read is comments else item['id'] for item in page['items'])
            cursor = page['next_cursor']
            if cursor is None: break
        assert len(ids) == len(set(ids)) == count
    latest = comments(1, db=db, user=user(), before=None, limit=40, paginated=True)
    assert latest['items'][-1].body == 'Сообщение 249'
    with pytest.raises(HTTPException) as error:
        comments(1, db=db, user=user(99, team=99, scope='none'), before=None, limit=40, paginated=True)
    assert error.value.status_code == 404


@pytest.mark.parametrize('text', ['заключение', 'Предыдущий итог'])
def test_search_content_and_result_respects_acl(db, text):
    db.add(row()); db.commit()
    assert Selection(db, user(), Filters(view='all', status='', q=text)).query.count() == 1
    assert Selection(db, user(99, team=99, scope='none'), Filters(view='all', status='', q=text)).query.count() == 0


def test_workspace_search_types_pagination_acl_and_literal_wildcards(db):
    from routers.work_tasks_router import workspace_search
    Task.__table__.create(db.bind)
    Project.__table__.create(db.bind)
    RequirementRequest.__table__.create(db.bind)
    db.add(row()); db.commit()
    page = workspace_search('WRK-1', page=1, per_page=1, db=db, user=user())
    assert page['total'] == 1 and page['items'][0]['kind'] == 'work'
    assert workspace_search('WRK-1', page=2, per_page=1, db=db, user=user())['items'] == []
    assert workspace_search('WRK-1', page=1, per_page=1, db=db, user=user(99, team=99, scope='none'))['total'] == 0
    assert workspace_search('%', page=1, per_page=1, db=db, user=user())['total'] == 0
    db.add_all([
        RequirementRequest(title='Запрос проверки', user_id=1, team_id=10, status='submitted'),
        RequirementRequest(title='Запрос проверки', user_id=2, team_id=20, status='submitted'),
        RequirementRequest(title='Запрос проверки', user_id=2, team_id=10, status='draft'),
    ]); db.commit()
    assert workspace_search('Запрос проверки', page=1, per_page=10, db=db, user=user())['total'] == 1
    reviewer = user(); reviewer.role.review_access = 'team'
    assert workspace_search('Запрос проверки', page=1, per_page=10, db=db, user=reviewer)['total'] == 1
    assert workspace_search('Запрос проверки', page=1, per_page=10, db=db, user=user(99, team=99, scope='none'))['total'] == 0
