from types import SimpleNamespace
from uuid import uuid4
from contextlib import ExitStack
import pytest

from sqlalchemy.orm import Session
from config import settings
from meeting_contract import MeetingDraft, VersionRequest
from models import MeetingCapture, MeetingDeliveryIntent, MeetingAction, MeetingApplicationReceipt
from routers import meeting_capture_router as api
from meeting_pg_fixture import technical_engine


@pytest.fixture
def intent_engines():
    with ExitStack() as stack:
        yield lambda: stack.enter_context(technical_engine((MeetingCapture.__table__,
            MeetingAction.__table__,MeetingDeliveryIntent.__table__,MeetingApplicationReceipt.__table__)))


def test_acceptance_commits_immutable_intent_and_repeated_click_reuses_it(monkeypatch,intent_engines):
    monkeypatch.setattr(settings, "MEETING_ANALYZER_ENABLED", True)
    engine = intent_engines()
    actor = SimpleNamespace(id=1, team_id=1, role=SimpleNamespace(task_edit_scope="all"))
    key = uuid4()
    try:
        with Session(engine) as db:
            api.create_session(key, MeetingDraft(title="Synthetic", transcript="Original source"), db, actor)
            queued = api.analyze_session(key, VersionRequest(version=1), db, actor)
            intent = db.get(MeetingDeliveryIntent, queued["analysis_run_id"])
            assert intent.phase == "queued" and intent.source_revision == queued["version"]
            assert intent.payload["input"] == {"transcript": "Original source", "meeting_date": None}
            assert intent.requested_at == db.get(MeetingCapture, str(key)).analysis_requested_at
            replay = api.analyze_session(key, VersionRequest(version=1), db, actor)
            assert replay["analysis_run_id"] == queued["analysis_run_id"]
            assert db.query(MeetingDeliveryIntent).count() == 1
    finally:
        engine.dispose()


def test_explicit_retry_freezes_previous_service_identity(monkeypatch,intent_engines):
    monkeypatch.setattr(settings,'MEETING_ANALYZER_ENABLED',True)
    engine=intent_engines()
    actor=SimpleNamespace(id=1,team_id=1,role=SimpleNamespace(task_edit_scope='all'))
    capture,previous_operation,previous_run=uuid4(),str(uuid4()),str(uuid4())
    try:
        with Session(engine) as db:
            api.create_session(capture,MeetingDraft(title='Synthetic',transcript='Synthetic source'),db,actor)
            row=db.get(MeetingCapture,str(capture))
            row.analysis_status='failed'
            row.analysis_backend='meeting-analyzer'
            row.analysis_run_id=previous_operation
            row.analysis_service_run_id=previous_run
            db.commit()
            accepted=api.analyze_session(capture,VersionRequest(version=row.version),db,actor)
            intent=db.get(MeetingDeliveryIntent,accepted['analysis_run_id'])
            assert intent.payload['retry_of']==previous_run
            assert accepted['analysis_run_id']!=previous_operation
    finally:
        engine.dispose()


def test_retry_of_unknown_delivery_keeps_key_but_queued_intent_is_fenced(monkeypatch,intent_engines):
    monkeypatch.setattr(settings, 'MEETING_ANALYZER_ENABLED', True)
    for phase in ('unknown', 'queued'):
        engine = intent_engines()
        actor = SimpleNamespace(id=1, team_id=1, role=SimpleNamespace(task_edit_scope='all'))
        capture = uuid4()
        try:
            with Session(engine) as db:
                api.create_session(capture, MeetingDraft(title='Synthetic', transcript='Synthetic source'), db, actor)
                first = api.analyze_session(capture, VersionRequest(version=1), db, actor)
                previous = db.get(MeetingDeliveryIntent, first['analysis_run_id'])
                previous.phase = phase
                row = db.get(MeetingCapture, str(capture))
                row.analysis_status = 'failed'
                db.commit()
                accepted = api.analyze_session(capture, VersionRequest(version=row.version), db, actor)
                current = db.get(MeetingDeliveryIntent, accepted['analysis_run_id'])
                assert accepted['analysis_run_id'] != first['analysis_run_id']
                if phase == 'unknown':
                    assert current.payload['retry_of_key'] == first['analysis_run_id']
                    assert previous.phase == 'unknown' and previous.payload is not None
                else:
                    assert 'retry_of' not in current.payload and 'retry_of_key' not in current.payload
                    assert previous.phase == 'resolved' and previous.payload is None
        finally:
            engine.dispose()
