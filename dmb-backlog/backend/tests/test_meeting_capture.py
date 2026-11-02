"""Isolated tests: only the two new tables; no protected rows are created."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from meeting_contract import MeetingDraft, MeetingItem, DraftUpdate, VersionRequest, confirmed_items
from models import MeetingCapture, MeetingAction, Notification, EventOutbox
from routers import meeting_capture_router as api
from services.meeting_matching import rank_tasks


@pytest.fixture
def capture_db():
    engine = create_engine('sqlite:///:memory:')
    # Deliberately no users, roles, teams or dictionaries, even in fixtures.
    MeetingCapture.__table__.create(engine)
    MeetingAction.__table__.create(engine)
    Notification.__table__.create(engine)
    EventOutbox.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def user(user_id=1):
    return SimpleNamespace(id=user_id)


def item(**changes):
    return MeetingItem(id='a', title='Подготовить отчёт', **changes)


def test_confirm_requires_explicit_human_decision():
    for changes in ({}, {'selected': True}, {'selected': True, 'link_choice': 'task'}):
        with pytest.raises(ValueError):
            confirmed_items(MeetingDraft(title='Встреча', items=[item(**changes)]))
    assert len(confirmed_items(MeetingDraft(title='Встреча', items=[item(selected=True, link_choice='none')]))) == 1


def test_fabricated_quote_duplicate_ids_and_protected_fields_rejected():
    for items in ([item(origin='ai', quote='Выдумка')], [item(), item()]):
        with pytest.raises(ValueError):
            MeetingDraft(title='Встреча', transcript='Текст', items=items)
    with pytest.raises(ValueError):
        MeetingItem(id='a', title='Задача', team_id=1)


def test_create_retry_draft_confirmation_and_owner_isolation(capture_db):
    db = capture_db
    key = uuid4()
    draft = MeetingDraft(title='Планирование', items=[item(selected=True, link_choice='none')])
    first = api.create_session(key, draft, db, user())
    repeat = api.create_session(key, draft, db, user())
    assert first['id'] == repeat['id']
    assert db.query(MeetingCapture).count() == 1
    assert db.query(MeetingAction).count() == 0
    with pytest.raises(HTTPException) as exc:
        api.get_session(key, db, user(2))
    assert exc.value.status_code == 404
    result = api.confirm_session(key, VersionRequest(version=1), db, user())
    assert result['status'] == 'saved'
    assert result['saved_count'] == 1
    assert api.confirm_session(key, VersionRequest(version=1), db, user())['saved_count'] == 1
    assert db.query(MeetingAction).count() == 1
    with pytest.raises(HTTPException) as exc:
        api.update_session(key, DraftUpdate(**draft.model_dump(), version=1), db, user())
    assert exc.value.status_code == 409


def test_stale_revision_does_not_overwrite(capture_db):
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Первая'), capture_db, user())
    api.update_session(key, DraftUpdate(title='Вторая', version=1), capture_db, user())
    with pytest.raises(HTTPException) as exc:
        api.update_session(key, DraftUpdate(title='Устаревшая', version=1), capture_db, user())
    assert exc.value.status_code == 409
    assert api.get_session(key, capture_db, user())['title'] == 'Вторая'


def test_unavailable_task_prevents_all_writes(capture_db, monkeypatch):
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Встреча'), capture_db, user())
    linked = item(selected=True, task_id=42, link_choice='task')
    monkeypatch.setattr(api, 'validate_links', Mock(side_effect=HTTPException(403, 'Нет доступа')))
    with pytest.raises(HTTPException):
        api.update_session(key, DraftUpdate(title='Встреча', items=[linked], version=1), capture_db, user())
    assert capture_db.query(MeetingAction).count() == 0
    assert api.get_session(key, capture_db, user())['version'] == 1


def test_analysis_failure_preserves_transcript_and_human_edits(capture_db, monkeypatch):
    from services.meeting_analysis import claim_run, execute_run
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Встреча', transcript='Подготовить отчёт.'), capture_db, user())
    queued = api.analyze_session(key, VersionRequest(version=1), capture_db, user())
    claimed = claim_run(capture_db)
    execute_run(lambda: Session(capture_db.bind), claimed, lambda *args: {'items': [item(origin='ai', quote='Ложная цитата').model_dump()]})
    capture_db.expire_all()
    failed = api.get_session(key, capture_db, user())
    assert failed['analysis_status'] == 'failed'
    assert failed['analysis_error_code'] == 'invalid_result'
    assert api.get_session(key, capture_db, user())['transcript'] == 'Подготовить отчёт.'
    changed = api.update_session(key, DraftUpdate(title='Встреча', transcript='Подготовить отчёт.', items=[item()], version=failed['version']), capture_db, user())
    with pytest.raises(HTTPException) as exc:
        api.analyze_session(key, VersionRequest(version=changed['version']), capture_db, user())
    assert exc.value.status_code == 409


def test_background_run_is_durable_idempotent_and_private(capture_db):
    from services.meeting_analysis import claim_run, execute_run
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Фон', transcript='Подготовить отчёт.'), capture_db, user())
    queued = api.analyze_session(key, VersionRequest(version=1), capture_db, user())
    assert queued['analysis_status'] == 'queued'
    assert api.analyze_session(key, VersionRequest(version=1), capture_db, user())['analysis_run_id'] == queued['analysis_run_id']
    with pytest.raises(HTTPException) as exc:
        api.analysis_status(key, capture_db, user(2))
    assert exc.value.status_code == 404
    for change in [lambda: api.update_session(key, DraftUpdate(title='Правка', transcript='Новый текст', version=queued['version']), capture_db, user()),
                   lambda: api.confirm_session(key, VersionRequest(version=queued['version']), capture_db, user())]:
        with pytest.raises(HTTPException) as exc:
            change()
        assert exc.value.status_code == 409
    capture_db.rollback()
    claimed = claim_run(capture_db)
    assert claimed and claim_run(capture_db) is None
    callback = Mock(return_value={'items': [item(origin='ai', quote='Подготовить отчёт.').model_dump()]})
    execute_run(lambda: Session(capture_db.bind), claimed, callback)
    capture_db.expire_all()
    result = api.get_session(key, capture_db, user())
    assert result['analysis_status'] == 'completed' and len(result['items']) == 1
    assert api.analyze_session(key, VersionRequest(version=1), capture_db, user())['version'] == result['version']
    assert callback.call_count == 1
    assert 'transcript' not in api.analysis_status(key, capture_db, user())


def test_empty_background_result_survives_reopen_and_source_edit_resets_it(capture_db):
    from services.meeting_analysis import claim_run, execute_run
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Без решений', transcript='Вопрос?'), capture_db, user())
    queued = api.analyze_session(key, VersionRequest(version=1), capture_db, user())
    claimed = claim_run(capture_db)
    execute_run(lambda: Session(capture_db.bind), claimed, lambda *args: {'items': []})
    capture_db.expire_all()
    result = api.get_session(key, capture_db, user())
    assert result['analysis_status'] == 'completed' and result['items'] == []
    assert api.analyze_session(key, VersionRequest(version=queued['version']), capture_db, user())['analysis_run_id'] == queued['analysis_run_id']
    edited = api.update_session(key, DraftUpdate(title='Новый источник', transcript='Новый текст', version=result['version']), capture_db, user())
    assert edited['analysis_status'] == 'idle' and edited['analysis_run_id'] is None


@pytest.mark.parametrize('empty', [False, True])
def test_completion_notification_is_private_atomic_and_not_repeated(capture_db, empty):
    from services.meeting_analysis import claim_run, execute_run
    from notifications import notification_target, normalize_notification_action_url
    from schemas import NotificationTargetResponse
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Тест уведомления', transcript='Подготовить отчёт.'), capture_db, user(7))
    api.analyze_session(key, VersionRequest(version=1), capture_db, user(7))
    claimed = claim_run(capture_db)
    result = {'items': [] if empty else [item(origin='ai', quote='Подготовить отчёт.').model_dump()]}
    execute_run(lambda: Session(capture_db.bind), claimed, lambda *args: result)
    execute_run(lambda: Session(capture_db.bind), claimed, lambda *args: result)
    notifications = capture_db.query(Notification).all()
    assert len(notifications) == 1
    notification = notifications[0]
    assert notification.user_id == 7 and notification.category == 'meeting_capture'
    assert notification.group_count == 1 and not notification.is_read
    assert notification.action_url == f'#/meeting-capture?capture={key}'
    assert ('не найдено' in notification.body) == empty
    assert capture_db.query(EventOutbox).filter_by(event_type='notification.created', audience_user_id=7).count() == 1
    assert NotificationTargetResponse(**notification_target(notification)).kind == 'meeting_capture'
    for url in ['https://evil.test/meeting-capture', '#/meeting-capture?capture=bad', f'#/meeting-capture?capture={key}&extra=1']:
        assert normalize_notification_action_url('meeting_capture', None, url) == '#/notifications'


def test_interrupted_run_does_not_retry_or_overwrite_a_newer_run(capture_db):
    from services.meeting_analysis import claim_run, execute_run, expire_runs, now, RUN_TIMEOUT_SECONDS
    from datetime import timedelta
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Сбой', transcript='Текст'), capture_db, user())
    api.analyze_session(key, VersionRequest(version=1), capture_db, user())
    claimed = claim_run(capture_db)
    assert expire_runs(capture_db, now() + timedelta(seconds=RUN_TIMEOUT_SECONDS + 1)) == 1
    capture_db.expire_all()
    failed = api.get_session(key, capture_db, user())
    assert failed['analysis_status'] == 'failed' and failed['analysis_error_code'] == 'interrupted'
    assert claim_run(capture_db) is None
    retried = api.analyze_session(key, VersionRequest(version=failed['version']), capture_db, user())
    execute_run(lambda: Session(capture_db.bind), claimed, lambda *args: {'items': []})
    capture_db.expire_all()
    result = api.get_session(key, capture_db, user())
    assert result['analysis_status'] == 'queued' and result['analysis_run_id'] == retried['analysis_run_id']
    assert result['analysis_run_id'] != claimed['run_id']


def test_background_provider_failure_is_sanitized_and_persisted(capture_db):
    from services.meeting_analysis import claim_run, execute_run
    key = uuid4()
    api.create_session(key, MeetingDraft(title='Настройка', transcript='Текст'), capture_db, user())
    api.analyze_session(key, VersionRequest(version=1), capture_db, user())
    claimed = claim_run(capture_db)
    execute_run(lambda: Session(capture_db.bind), claimed, Mock(side_effect=HTTPException(503, {'code': 'meeting_ai_auth', 'message': 'UNTRUSTED'})))
    capture_db.expire_all()
    result = api.get_session(key, capture_db, user())
    assert result['analysis_error_code'] == 'meeting_ai_auth'
    assert 'UNTRUSTED' not in result['analysis_error_message']


def test_matching_does_not_manufacture_relevance():
    tasks = [SimpleNamespace(id=1, public_id='TASK-1', title='Кредитный конвейер', description='Выдача кредитов'),
             SimpleNamespace(id=2, public_id='TASK-2', title='Годовой отчёт', description='Подготовить отчёт')]
    assert rank_tasks('Подготовить годовой отчёт', tasks)[0]['id'] == 2
    assert rank_tasks('Зоопарк', tasks) == []
    assert '%' not in rank_tasks('Годовой отчёт', tasks)[0]['reason']


def test_links_recheck_deleted_tasks_and_team_edit_scope():
    from models import Role, User
    # Plain in-memory objects only: never inserted into any database.
    role = Role(task_edit_scope='team', customer_portal_only=False,
                backlog_dmb_access='read_write', backlog_team_access='read',
                reports_access='none', analytics_access='none', customer_access='none',
                settings_access='none', admin_access='none')
    actor = User(id=1, team_id=5, role=role)
    task = SimpleNamespace(id=42, team_id=5, is_deleted=False)
    fake_db = Mock()
    fake_db.query.return_value.filter_by.return_value.first.return_value = task
    selected = item(selected=True, task_id=42, link_choice='task')
    api.validate_links(fake_db, actor, [selected])
    for team, deleted in [(6, False), (5, True)]:
        task.team_id, task.is_deleted = team, deleted
        with pytest.raises(HTTPException) as exc:
            api.validate_links(fake_db, actor, [selected])
        assert exc.value.status_code == 403


def test_read_only_users_cannot_create_meeting_work():
    actor = SimpleNamespace(team_id=5, role=SimpleNamespace(task_edit_scope='none'))
    with pytest.raises(HTTPException) as exc:
        api.editor(actor)
    assert exc.value.status_code == 403


def test_extractor_validates_quotes_and_never_confirms():
    path = Path(__file__).resolve().parents[3] / 'agents/business-analyst' / 'business_analyst' / 'meeting_task_extractor.py'
    spec = importlib.util.spec_from_file_location('meeting_extraction', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    raw = {'kind': 'action', 'title': 'Подготовить отчёт', 'quote': 'Анна: подготовлю отчёт.'}
    llm = SimpleNamespace(name='fake', chat=lambda *args, **kwargs: json.dumps({'items': [raw]}))
    result = module.extract_meeting(module.ExtractionInput(transcript=raw['quote']), llm)
    assert result['items'][0]['selected'] is False
    assert result['items'][0]['task_id'] is None
    raw['quote'] = 'Придуманная цитата'
    with pytest.raises(ValueError):
        module.extract_meeting(module.ExtractionInput(transcript='Исходный текст'), llm)
    llm.name = 'mock'
    with pytest.raises(RuntimeError):
        module.extract_meeting(module.ExtractionInput(transcript='Исходный текст'), llm)


@pytest.mark.parametrize('status,expected', [(401, True), (403, True), (429, False), (500, False)])
def test_extraction_failure_only_exposes_safe_provider_category(status, expected):
    from urllib.error import HTTPError
    path = Path(__file__).resolve().parents[3] / 'agents/business-analyst' / 'business_analyst' / 'meeting_task_extractor.py'
    spec = importlib.util.spec_from_file_location('meeting_failure', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    error = HTTPError('https://provider.invalid', status, 'untrusted-provider-detail', {}, None)
    detail = module.extraction_failure_detail(error)
    assert bool(detail) is expected
    if detail:
        assert detail['code'] == 'meeting_ai_auth'
        assert 'untrusted-provider-detail' not in str(detail)


def test_gateway_preserves_allowlisted_meeting_failure_without_provider_message(monkeypatch):
    from io import BytesIO
    from urllib.error import HTTPError
    from routers import agent_router
    body = json.dumps({'detail': {'code': 'meeting_ai_auth', 'message': 'untrusted-provider-detail'}}).encode()
    failure = HTTPError('https://agent.invalid', 503, 'unavailable', {}, BytesIO(body))
    monkeypatch.setattr(agent_router, 'request_with_resilience', Mock(side_effect=failure))
    with pytest.raises(HTTPException) as exc:
        agent_router._call_agent('POST', '/api/agent/meetings/extract', {})
    assert exc.value.status_code == 503
    assert exc.value.detail['code'] == 'meeting_ai_auth'
    assert 'untrusted-provider-detail' not in exc.value.detail['message']
