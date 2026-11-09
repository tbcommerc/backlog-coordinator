"""Only technical tables; no application identities are written."""
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from models import MeetingDeliveryIntent, MeetingCapture, MeetingApplicationReceipt
from services.meeting_analysis import now
from services.meeting_service_delivery import deliver_one, MeetingServiceError
from meeting_pg_fixture import technical_engine


@pytest.fixture
def storage():
    with technical_engine((MeetingDeliveryIntent.__table__,MeetingCapture.__table__,
            MeetingApplicationReceipt.__table__)) as engine:
        yield engine


def receipt(engine, decision="applied"):
    run, operation, capture = str(uuid4()), str(uuid4()), str(uuid4())
    with Session(engine) as db:
        db.add(MeetingApplicationReceipt(service_run_id=run, consumer_operation_id=operation,
            capture_id=capture, owner_id=1, source_hash="a"*64, payload_hash="b"*64,
            decision=decision, ack_pending=True, created_at=now(), updated_at=now()))
        db.commit()
    return run, operation, capture


def test_ack_survives_replacement_of_draft_run_and_lost_response(storage):
    run, operation, capture = receipt(storage)
    new_operation, new_run = str(uuid4()), str(uuid4())
    with Session(storage) as db:
        db.add(MeetingCapture(id=capture, owner_id=1, title="Synthetic", transcript="Synthetic",
            analysis_backend="meeting-analyzer", analysis_status="failed", analysis_run_id=new_operation,
            analysis_service_run_id=new_run, analysis_ack_pending=False))
        db.commit()
    calls = []
    def lost(method, path, record, payload):
        calls.append((path, record["analysis_run_id"]))
        raise TimeoutError()
    with pytest.raises(TimeoutError):
        deliver_one(lambda: Session(storage), lost)
    with Session(storage) as db:
        saved = db.get(MeetingApplicationReceipt, run)
        assert saved.ack_pending and saved.ack_attempts == 1
        saved.next_attempt_at = now() - timedelta(seconds=1)
        db.commit()
    def ack(method, path, record, payload):
        calls.append((path, record["analysis_run_id"]))
        return {"acknowledged": True}
    assert deliver_one(lambda: Session(storage), ack)
    assert calls[0] == calls[1] == (f"/internal/agent/v1/runs/{run}/acknowledgements", operation)
    with Session(storage) as db:
        row = db.get(MeetingCapture, capture)
        assert row.analysis_run_id == new_operation and row.analysis_service_run_id == new_run
        assert not row.analysis_ack_pending
        saved = db.get(MeetingApplicationReceipt, run)
        assert not saved.ack_pending and saved.payload_hash == "b"*64


def test_discarded_receipt_cancels_and_waits_for_terminal_ack(storage):
    run, _, _ = receipt(storage, "discarded")
    def draining(method, path, record, payload):
        if path.endswith("/acknowledgements"):
            raise MeetingServiceError("source_conflict", 409)
        return {}
    assert deliver_one(lambda: Session(storage), draining)
    with Session(storage) as db:
        saved = db.get(MeetingApplicationReceipt, run)
        assert saved.ack_pending and saved.ack_attempts == 1
        saved.next_attempt_at = now() - timedelta(seconds=1)
        db.commit()
    calls = []
    def expired(method, path, record, payload):
        calls.append(path)
        raise MeetingServiceError("result_expired", 410)
    assert deliver_one(lambda: Session(storage), expired)
    assert calls == [f"/internal/agent/v1/runs/{run}/cancel", f"/internal/agent/v1/runs/{run}/acknowledgements"]
    with Session(storage) as db:
        assert not db.get(MeetingApplicationReceipt, run).ack_pending


def test_accepted_run_detached_by_edit_is_recovered_after_restart(storage):
    run, _, capture = receipt(storage)
    with Session(storage) as db:
        saved = db.get(MeetingApplicationReceipt, run)
        saved.decision, saved.ack_pending = "pending", False
        db.add(MeetingCapture(id=capture, owner_id=1, title="Edited", transcript="Manual edits",
            analysis_backend="meeting-analyzer", analysis_status="idle", analysis_run_id=None))
        db.commit()
    calls = []
    def complete(method, path, record, payload):
        calls.append(path)
        return {"acknowledged": True}
    assert deliver_one(lambda: Session(storage), complete)
    assert calls == [f"/internal/agent/v1/runs/{run}/cancel", f"/internal/agent/v1/runs/{run}/acknowledgements"]
    with Session(storage) as db:
        saved = db.get(MeetingApplicationReceipt, run)
        assert saved.decision == "discarded" and not saved.ack_pending
        assert db.get(MeetingCapture, capture).transcript == "Manual edits"


def test_lost_create_then_source_replacement_cancels_original_key(storage):
    from services.meeting_service_delivery import create_intent
    capture, operation, service_run = str(uuid4()), str(uuid4()), str(uuid4())
    with Session(storage) as db:
        db.add(MeetingCapture(id=capture, owner_id=1, title="Original", transcript="Original source",
            analysis_backend="meeting-analyzer", analysis_status="queued", analysis_run_id=operation,
            analysis_requested_at=now()))
        db.commit()
    sent = []
    def lost(method, path, record, payload):
        sent.append((path, record["analysis_run_id"], payload))
        raise TimeoutError()
    with pytest.raises(TimeoutError):
        deliver_one(lambda: Session(storage), lost, authorize=lambda *_: True)
    with Session(storage) as db:
        intent = db.get(MeetingDeliveryIntent, operation)
        assert intent.phase == "unknown" and intent.payload["input"]["transcript"] == "Original source"
        row = db.get(MeetingCapture, capture)
        row.transcript, row.analysis_run_id, row.analysis_status = "Manual replacement", None, "idle"
        db.commit()
    def cancel_unknown(method, path, record, payload):
        sent.append((path, record["analysis_run_id"], payload))
        assert path.endswith("/cancellations")
        return {"run_id": service_run, "status": "cancelled"}
    assert deliver_one(lambda: Session(storage), cancel_unknown)
    assert sent[0][1:] == sent[1][1:]
    with Session(storage) as db:
        intent = db.get(MeetingDeliveryIntent, operation)
        assert intent.phase == "resolved" and intent.payload is None
        saved = db.get(MeetingApplicationReceipt, service_run)
        assert saved.decision == "discarded" and saved.ack_pending
        assert db.get(MeetingCapture, capture).transcript == "Manual replacement"


@pytest.mark.parametrize("phase,age,expected_error", [("queued", 0, None), ("unknown", 25, "delivery_expired")])
def test_detached_unsent_or_expired_snapshot_is_removed_without_dispatch(storage, phase, age, expected_error):
    operation = str(uuid4())
    with Session(storage) as db:
        db.add(MeetingDeliveryIntent(operation_id=operation, capture_id=str(uuid4()), owner_id=1,
            source_revision=1, payload={"private": "synthetic source"}, phase=phase,
            requested_at=now()-timedelta(hours=age), updated_at=now()))
        db.commit()
    def forbidden(*args):
        raise AssertionError("No remote dispatch permitted")
    assert deliver_one(lambda: Session(storage), forbidden)
    with Session(storage) as db:
        saved = db.get(MeetingDeliveryIntent, operation)
        assert saved.phase == "resolved" and saved.payload is None and saved.error_code == expected_error


def test_detached_cleanup_timeout_backs_off_without_blocking_queue(storage):
    operation = str(uuid4())
    with Session(storage) as db:
        db.add(MeetingDeliveryIntent(operation_id=operation, capture_id=str(uuid4()), owner_id=1,
            source_revision=1, payload={"input": {"transcript": "Synthetic"}}, phase="unknown",
            requested_at=now(), updated_at=now()))
        db.commit()
    calls = []
    def unavailable(*args):
        calls.append(args)
        raise TimeoutError()
    with pytest.raises(TimeoutError):
        deliver_one(lambda: Session(storage), unavailable)
    assert not deliver_one(lambda: Session(storage), unavailable)
    assert len(calls) == 1
    with Session(storage) as db:
        saved = db.get(MeetingDeliveryIntent, operation)
        assert saved.phase == "unknown" and saved.attempts == 1 and saved.payload is not None
        assert saved.next_attempt_at is not None
