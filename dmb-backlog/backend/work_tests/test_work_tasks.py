"""Isolated work tests: no reference, user or team records are created."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace as NS
from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from pydantic import ValidationError

os.environ['DATABASE_URL'] = 'sqlite://'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from models import WorkTask, WorkHistory, EventOutbox
from services import work_tasks as work
from work_contract import WorkCreate, Transition, WorkUpdate


def user(id=1, team=10, scope='team', customer=False):
    return NS(id=id, team_id=team, role_name='', role=NS(task_edit_scope=scope,
        customer_portal_only=customer, backlog_dmb_access='none', backlog_team_access='none', reports_access='none', analytics_access='none', customer_access='none', settings_access='none', admin_access='none'))


def row(**values):
    return WorkTask(id=1, title='Проверить', description='Подготовить заключение', work_direction='organizational',
        execution_team_id=10, requester_id=1, requester_team_id=10, created_by=1, assignee_id=2,
        due_date=date(2026, 11, 1), acceptor_id=3, status=values.pop('status', 'new'),
        acceptance_required=values.pop('acceptance_required', False), assignment_state='accepted',
        version=1, is_deleted=False, result_text='Предыдущий итог', **values)


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(work, 'notify_work', lambda *args: None)
    from services import request_followup
    monkeypatch.setattr(request_followup, 'work_changed', lambda *args: None)
    engine = create_engine('sqlite://')
    # Deliberately no protected tables; FK references are tested through DDL, not fixture inserts.
    for cls in (WorkTask, WorkHistory, EventOutbox): cls.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def test_reject_nested_or_conflicting_placement():
    for extra in ({'parent_work_task_id': 9}, {'major_task_id': 1, 'direct_project_id': 2}):
        with pytest.raises(ValidationError):
            WorkCreate(title='X', work_direction='product', execution_team_id=10, **extra)


def test_cancelled_proposal_has_no_assignment_decisions(db, monkeypatch):
    task = row(status='cancelled')
    task.assignment_state = 'proposed'
    monkeypatch.setattr(db, 'get', lambda *args: None)
    assert work.response(db, task, user())['can_decide_assignment'] is False


def test_db_context_constraint(db):
    db.add(row(major_task_id=4, direct_project_id=5))
    with pytest.raises(IntegrityError): db.flush()


def test_acceptance_cannot_be_bypassed():
    task = row(status='in_progress', acceptance_required=True)
    with pytest.raises(HTTPException) as exc:
        work.transition_values(task, user(2, scope='none'), Transition(version=1, status='done', result_text='Готово'))
    assert exc.value.status_code == 422
    assert work.transition_values(task, user(2, scope='none'), Transition(version=1, status='in_acceptance', result_text='Готово'))['status'] == 'in_acceptance'


def test_only_acceptor_can_accept():
    task = row(status='in_acceptance', acceptance_required=True)
    with pytest.raises(HTTPException) as exc:
        work.transition_values(task, user(2), Transition(version=1, status='done'))
    assert exc.value.status_code == 403
    assert work.transition_values(task, user(3, team=20, scope='none'), Transition(version=1, status='done'))['result_text'] == task.result_text


def test_reopen_requires_reason_and_keeps_result():
    task = row(status='done')
    with pytest.raises(HTTPException): work.transition_values(task, user(), Transition(version=1, status='ready'))
    values = work.transition_values(task, user(), Transition(version=1, status='ready', reason='Найдена ошибка'))
    assert values == {'status': 'ready', 'completed_at': None, 'result_revision': 2}


def test_read_scope_matches_participants_without_other_team_access(db):
    task = row(); db.add(task); db.commit()
    assert db.query(WorkTask).filter(work.read_scope(user(3, team=20, scope='none'))).count() == 1
    assert db.query(WorkTask).filter(work.read_scope(user(4, team=20, scope='none'))).count() == 0
    assert db.query(WorkTask).filter(work.read_scope(user(1, customer=True))).count() == 0


def test_stale_version_does_not_duplicate_history_or_events(db):
    task = row(); db.add(task); db.commit()
    work.change(db, task, user(), 1, {'title': 'Новое название'}, 'updated'); db.commit()
    with pytest.raises(HTTPException) as exc: work.change(db, task, user(), 1, {'title': 'Устаревшее'}, 'updated')
    assert exc.value.status_code == 409
    assert task.title == 'Новое название'
    assert db.query(WorkHistory).count() == db.query(EventOutbox).count() == 1


def test_assignee_cannot_change_requirements(db):
    task = row(); db.add(task); db.commit()
    with pytest.raises(HTTPException) as exc: work.update(db, task, user(2, scope='none'), WorkUpdate(version=1, title='X'))
    assert exc.value.status_code == 403
    work.update(db, task, user(2, scope='none'), WorkUpdate(version=1, blocked_reason='Жду ответ'))
    assert task.blocked_reason == 'Жду ответ'


def test_start_requires_description_due_and_assignee():
    for field in ('description', 'due_date', 'assignee_id'):
        task = row(); setattr(task, field, '' if field == 'description' else None)
        with pytest.raises(HTTPException): work.transition_values(task, user(), Transition(version=1, status='ready'))


def test_parent_fk_does_not_cascade():
    fk = next(iter(WorkTask.__table__.c.major_task_id.foreign_keys))
    assert fk.ondelete == 'SET NULL'
    assert 'parent_work_task_id' not in WorkTask.__table__.c
