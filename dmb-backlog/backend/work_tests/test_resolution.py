from test_work_tasks import db, row, user
import pytest
from fastapi import HTTPException
from models import WorkResolution, RequestWorkLink, RequirementRequest, IdempotencyRecord, WorkTask, Notification
from routers import work_resolution_router as api


@pytest.fixture
def request_context(db, monkeypatch):
    for cls in (RequirementRequest, WorkResolution, RequestWorkLink, IdempotencyRecord, Notification): cls.__table__.create(db.bind)
    task = row(acceptance_required=True)
    req = RequirementRequest(id=1, title='Потребность', description='Исходное описание', user_id=50,
        team_id=10, reviewer_id=1, version=0, status='in_review', is_deleted=False, draft={'problem_statement':'Проблема'},
        revision_history=[], status_history=[])
    db.add_all([task, req]); db.commit()
    monkeypatch.setattr(api, 'request_for', lambda *args, **kwargs: req)
    return req, task


def body(**overrides):
    return api.Resolution(version=0, decision='link_work', target_id=1, scope_text='Закрывает потребность', coverage='full', **overrides)


def test_resolution_retry_and_snapshot(db, request_context):
    req, task = request_context
    first = api.resolve(1, body(), 'request-key-001', db, user())
    second = api.resolve(1, body(), 'request-key-001', db, user())
    assert first == second
    assert db.query(RequestWorkLink).count() == 1
    assert db.query(WorkResolution).count() == 1
    assert db.query(Notification).filter_by(type='request.review.in_progress').count() == 1
    assert req.version == 1 and req.task_id is None
    assert task.version == 1  # Linking never mutates the work or a parent.
    assert first['legacy_supported'] is False
    snapshot = db.query(RequestWorkLink).one().requirement_snapshot
    req.description = 'Изменение позже'; db.flush()
    assert snapshot['description'] == 'Исходное описание'


def test_other_reviewer_command_conflicts(db, request_context):
    api.resolve(1, body(), 'request-key-002', db, user())
    with pytest.raises(HTTPException) as exc: api.resolve(1, body(), 'request-key-003', db, user())
    assert exc.value.status_code == 409


def test_fulfilled_requires_accepted_work(db, request_context):
    api.resolve(1, body(), 'request-key-004', db, user())
    decision = api.FulfillmentDecision(version=1, coverage='full', fulfillment='fulfilled', result_text='Принято')
    with pytest.raises(HTTPException) as exc: api.confirm_fulfillment(1, decision, db, user())
    assert exc.value.status_code == 422
    request_context[1].status = 'done'; db.commit()
    result = api.confirm_fulfillment(1, decision, db, user())
    assert result['fulfillment'] == 'fulfilled'
    assert db.query(Notification).filter_by(type='request.review.fulfilled').count() == 1


def test_customer_projection_has_no_internal_fields(db, request_context):
    api.resolve(1, body(), 'request-key-005', db, user())
    result = api.fulfillment(db, request_context[0], user(50, team=99, customer=True))
    assert len(result['works']) == 1
    assert not {'requester_id','assignee_id','comments','attachments','requirement_snapshot'} & result['works'][0].keys()


@pytest.mark.parametrize('change', ['reopened', 'deleted', 'unlinked'])
def test_changed_target_invalidates_confirmed_result(db, request_context, change):
    req, task = request_context
    api.resolve(1, body(), 'request-key-006', db, user())
    task.status = 'done'; db.commit()
    api.confirm_fulfillment(1, api.FulfillmentDecision(version=1, coverage='full', fulfillment='fulfilled', result_text='Принято'), db, user())
    if change == 'reopened': task.status = 'ready'
    elif change == 'deleted': task.is_deleted = True
    else: db.query(RequestWorkLink).one().is_active = False
    db.commit()
    result = api.fulfillment(db, req, user())
    assert result['fulfillment'] == 'needs_verification'
    assert result['coverage'] == 'partial'
    with pytest.raises(HTTPException) as exc:
        api.confirm_fulfillment(1, api.FulfillmentDecision(version=2, coverage='full', fulfillment='fulfilled', result_text='Повтор'), db, user())
    assert exc.value.status_code == 422


def test_split_retry_preserves_sources_and_requires_all_parts(db, request_context):
    req, first = request_context
    second = row(acceptance_required=True); second.id = 2
    db.add(second); db.commit()
    command = api.SplitResolution(version=0, reason='Два результата', parts=[body(),
        api.Resolution(version=0, decision='link_work', target_id=2, scope_text='Вторая часть', coverage='partial')])
    result = api.split_request(1, command, 'split-key-001', db, user())
    assert len(result['works']) == 2 and result['coverage'] == 'partial'
    assert api.split_request(1, command, 'split-key-001', db, user()) == result
    assert db.query(RequestWorkLink).count() == 2 and req.task_id is None
    first.status = 'done'; db.commit()
    with pytest.raises(HTTPException):
        api.confirm_fulfillment(1, api.FulfillmentDecision(version=1, coverage='full', fulfillment='fulfilled', result_text='Итог'), db, user())


def test_split_rejects_duplicate_target(db, request_context):
    with pytest.raises(HTTPException) as exc:
        api.split_request(1, api.SplitResolution(version=0, reason='Дубль', parts=[body(), body()]), 'split-key-002', db, user())
    assert exc.value.status_code == 422
    assert db.query(RequestWorkLink).count() == 0
