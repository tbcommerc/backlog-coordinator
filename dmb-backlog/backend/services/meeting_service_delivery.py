"""DMB delivery adapter. Capture intent is committed by the existing API.

No model invocation here. Repeated delivery uses the same idempotency key;
service owns execution. DMB owns the draft CAS and application receipt.
"""
import hashlib
import json
from uuid import UUID
from datetime import timedelta,timezone
import httpx
from pydantic import ValidationError
from sqlalchemy import or_
from config import settings
from meeting_contract import MeetingDraft
from models import MeetingCapture, MeetingApplicationReceipt, MeetingDeliveryIntent
from notifications import _create_notification
from .meeting_analysis import now,ERROR_MESSAGES

PREFIX = "/internal/agent/v1/runs"


class MeetingServiceError(RuntimeError):
    def __init__(self,code,status):
        self.code,self.status=code,status
        super().__init__(code)


def request(method, path, row, payload=None):
    # Never follow a redirect carrying a service credential.
    headers={
        "X-Agent-Secret": settings.MEETING_ANALYZER_SECRET,
        "X-Agent-Caller": "dmb", "X-Actor-Ref": str(row["owner_id"]),
        "Idempotency-Key": row["analysis_run_id"]}
    create_like = path in (PREFIX, PREFIX+"/cancellations")
    requested=row.get("analysis_requested_at")
    if method=="POST" and create_like and requested is not None:
        if requested.tzinfo is None: requested=requested.replace(tzinfo=timezone.utc)
        headers["X-Agent-Deadline"]=(requested+timedelta(seconds=600)).astimezone(timezone.utc).isoformat()
    with httpx.Client(base_url=settings.MEETING_ANALYZER_BASE_URL, timeout=10, follow_redirects=False) as client:
        response = client.request(method, path, json=payload, headers=headers)
        if response.status_code not in (200,202):
            status=response.status_code
            code=("meeting_service_auth" if status==401 else "operation_forbidden" if status==403 else
                "result_expired" if status==410 or status==404 and not create_like else
                "source_conflict" if status==409 else "invalid_input" if status in (400,413,422) else
                "queue_full" if status==429 else "meeting_service_configuration" if status==404 or 300<=status<400 else
                "meeting_service_unavailable")
            raise MeetingServiceError(code,status)
        try:
            data=response.json()
            if not isinstance(data,dict): raise ValueError()
            if method=="POST" and create_like:
                if not isinstance(data["run_id"],str):raise ValueError()
                run_id=str(UUID(data["run_id"]))
                data["run_id"]=run_id
                expected=PREFIX+"/"+run_id
                if data["status"] not in ("queued","preparing","running","validating","completed","failed","cancelled","interrupted"):
                    raise ValueError()
                if data["status_url"]!=expected or data["events_url"]!=expected+"/events":raise ValueError()
            elif path.startswith(PREFIX+"/"):
                run_id=path[len(PREFIX)+1:].split("/")[0]
                if method=="GET" and path.endswith("/result"):
                    digest=hashlib.sha256(json.dumps(data["result"],ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
                    if data["run_id"]!=run_id or data["payload_hash"]!=digest:raise ValueError()
                elif method=="GET":
                    if data["id"]!=run_id or data["status"] not in ("queued","preparing","running","validating","completed","failed","cancelled","interrupted"):raise ValueError()
                elif path.endswith("/acknowledgements"):
                    if data.get("acknowledged") is not True:raise ValueError()
            return data
        except (ValueError,KeyError,TypeError):
            raise MeetingServiceError("invalid_result",502) from None


def authorize_owner(db, owner_id):
    from models import User
    from routers.meeting_capture_router import editor
    actor = db.get(User, owner_id)
    if actor is None or not getattr(actor, "is_active", True):
        return False
    try:
        editor(actor)
        return True
    except Exception:
        return False


def create_intent(db, record):
    existing = db.query(MeetingDeliveryIntent).filter_by(operation_id=record["analysis_run_id"]).with_for_update().first()
    if existing is not None:
        return existing
    payload = {"contract_version": "1.0", "operation": "meeting.extract",
        "source": {"kind": "meeting_capture", "ref": record["id"], "revision": record["version"],
            "snapshot_hash": "sha256:" + hashlib.sha256(record["transcript"].encode()).hexdigest()},
        "input": {"transcript": record["transcript"], "meeting_date": str(record["meeting_date"]) if record["meeting_date"] else None}}
    previous_operation = record.get("retry_operation_id")
    previous_service = record.get("retry_service_run_id")
    if previous_service:
        payload["retry_of"] = previous_service
    elif previous_operation:
        previous = db.query(MeetingDeliveryIntent).filter_by(operation_id=previous_operation,
            capture_id=record["id"],owner_id=record["owner_id"]).with_for_update().first()
        receipt = db.query(MeetingApplicationReceipt).filter_by(consumer_operation_id=previous_operation,
            capture_id=record["id"],owner_id=record["owner_id"]).order_by(MeetingApplicationReceipt.created_at.desc()).first()
        if receipt is not None:
            payload["retry_of"] = receipt.service_run_id
        elif previous is not None and previous.phase == "unknown":
            payload["retry_of_key"] = previous_operation
        elif previous is not None and previous.phase == "queued":
            # The capture lock orders this against the dispatcher's capture lock.
            # No server run exists; a stale worker may not revive this envelope.
            previous.phase, previous.payload, previous.updated_at = "resolved", None, now()
    intent = MeetingDeliveryIntent(operation_id=record["analysis_run_id"], capture_id=record["id"],
        owner_id=record["owner_id"], source_revision=record["version"], payload=payload, phase="queued",
        requested_at=record["analysis_requested_at"], updated_at=now())
    db.add(intent)
    return intent


def _deliver_detached_intent(factory, call):
    with factory() as db:
        intent = db.query(MeetingDeliveryIntent).outerjoin(MeetingCapture,
            MeetingCapture.id == MeetingDeliveryIntent.capture_id).filter(
                MeetingDeliveryIntent.phase.in_(("queued", "unknown")),
                or_(MeetingDeliveryIntent.next_attempt_at.is_(None), MeetingDeliveryIntent.next_attempt_at <= now()), or_(
                    MeetingCapture.id.is_(None),
                    MeetingCapture.analysis_run_id.is_distinct_from(MeetingDeliveryIntent.operation_id),
                    MeetingCapture.analysis_backend.is_distinct_from("meeting-analyzer"),
                    MeetingCapture.analysis_status.notin_(("queued", "running")))).order_by(
                        MeetingDeliveryIntent.updated_at, MeetingDeliveryIntent.operation_id).with_for_update(
                            of=MeetingDeliveryIntent,skip_locked=True).first()
        if intent is None:
            return False
        requested_at = intent.requested_at
        if requested_at.tzinfo is None:
            requested_at = requested_at.replace(tzinfo=timezone.utc)
        if requested_at < now() - timedelta(hours=24):
            intent.phase, intent.payload, intent.error_code, intent.updated_at = "resolved", None, "delivery_expired", now()
            db.commit()
            return True  # Original create deadline has long passed; service owns its TTL cleanup.
        if intent.phase == "queued":
            intent.phase, intent.payload, intent.updated_at = "resolved", None, now()
            db.commit()
            return True  # No dispatch intent was ever committed; no remote work exists.
        payload = intent.payload
        record = {"id": intent.capture_id, "owner_id": intent.owner_id,
            "version": intent.source_revision, "analysis_run_id": intent.operation_id,
            "analysis_requested_at": intent.requested_at, "transcript": payload["input"]["transcript"]}
        intent.updated_at = now()
        intent.attempts += 1
        intent.next_attempt_at = now() + timedelta(seconds=min(60, 2 ** min(intent.attempts, 6)))
        db.commit()
    # An atomic cancellation tombstone fences even an original create still in flight.
    try:
        accepted = call("POST", PREFIX+"/cancellations", record, payload)
    except MeetingServiceError as error:
        if error.status != 410:
            raise
        with factory() as db:
            db.query(MeetingDeliveryIntent).filter_by(operation_id=record["analysis_run_id"]).update(
                {"phase": "resolved", "payload": None, "error_code": "result_expired", "updated_at": now()}, synchronize_session=False)
            db.commit()
        return True
    record["analysis_service_run_id"] = accepted["run_id"]
    with factory() as db:
        _receipt(db, record, "discarded")
        db.query(MeetingDeliveryIntent).filter_by(operation_id=record["analysis_run_id"]).update(
            {"phase": "resolved", "payload": None, "updated_at": now()}, synchronize_session=False)
        db.commit()
    return True


def _receipt(db, record, decision, payload_hash=None):
    run_id = record.get("analysis_service_run_id")
    if not run_id:
        return
    applied_refs = ([{"kind": "meeting_capture", "ref": record["id"], "revision": record["version"] + 1}]
        if decision == "applied" and "version" in record else [])
    existing = db.get(MeetingApplicationReceipt, run_id)
    if existing is not None:
        if existing.decision == "pending" and decision != "pending":
            existing.decision, existing.ack_pending = decision, True
            existing.payload_hash, existing.updated_at = payload_hash, now()
            existing.applied_object_refs, existing.committed_at = applied_refs, now()
        return  # A duplicate may never replace the committed consumer decision.
    db.add(MeetingApplicationReceipt(service_run_id=run_id,
        consumer_operation_id=record["analysis_run_id"], capture_id=record["id"],
        owner_id=record["owner_id"], source_hash=hashlib.sha256(record["transcript"].encode()).hexdigest(),
        payload_hash=payload_hash, source_revision=record.get("version"), applied_object_refs=applied_refs,
        committed_at=now() if decision != "pending" else None, decision=decision, ack_pending=decision != "pending", created_at=now(), updated_at=now()))


def _deliver_receipt(factory, call):
    with factory() as db:
        # Recover accepted service runs detached by edits/retries or a process crash.
        pending = db.query(MeetingApplicationReceipt).outerjoin(MeetingCapture,
            MeetingCapture.id == MeetingApplicationReceipt.capture_id).filter(
            MeetingApplicationReceipt.decision == "pending", or_(
                MeetingCapture.id.is_(None),
                MeetingCapture.analysis_backend.is_distinct_from("meeting-analyzer"),
                MeetingCapture.analysis_run_id.is_distinct_from(MeetingApplicationReceipt.consumer_operation_id),
                MeetingCapture.analysis_service_run_id.is_distinct_from(MeetingApplicationReceipt.service_run_id),
                MeetingCapture.analysis_status.notin_(("queued", "running")))).limit(100).all()
        for candidate in pending:
            candidate.decision, candidate.ack_pending, candidate.updated_at = "discarded", True, now()
            candidate.committed_at = now()
        db.commit()
        receipt = db.query(MeetingApplicationReceipt).filter_by(ack_pending=True).filter(
            or_(MeetingApplicationReceipt.next_attempt_at.is_(None), MeetingApplicationReceipt.next_attempt_at <= now())).order_by(
            MeetingApplicationReceipt.updated_at, MeetingApplicationReceipt.service_run_id).first()
        if receipt is None:
            return False
        run_id, operation_id = receipt.service_run_id, receipt.consumer_operation_id
        record = {"id": receipt.capture_id, "owner_id": receipt.owner_id,
            "analysis_run_id": operation_id, "analysis_service_run_id": run_id}
        discarded = receipt.decision == "discarded"
        receipt.updated_at = now()
        receipt.ack_attempts += 1
        receipt.next_attempt_at = now() + timedelta(seconds=min(60, 2 ** min(receipt.ack_attempts, 6)))
        db.commit()
    if discarded:
        try:
            call("POST", PREFIX+f"/{run_id}/cancel", record, {})
        except MeetingServiceError as error:
            if error.status not in (404, 409, 410):
                raise
    try:
        call("POST", PREFIX+f"/{run_id}/acknowledgements", record, {})
    except MeetingServiceError as error:
        if error.status == 409:
            return True  # Cancellation is still draining; retain the durable outbox.
        if error.status not in (404, 410):
            raise
    with factory() as db:
        db.query(MeetingApplicationReceipt).filter_by(service_run_id=run_id,
            consumer_operation_id=operation_id).update({"ack_pending": False, "updated_at": now()}, synchronize_session=False)
        db.query(MeetingCapture).filter_by(id=record["id"], analysis_run_id=operation_id,
            analysis_service_run_id=run_id).update({"analysis_ack_pending": False}, synchronize_session=False)
        db.commit()
    return True


def _project_transport_failure(factory,record,error,call):
    if not (error.code == "invalid_result" or 300<=error.status<500 and error.status not in (408,429)):
        return False
    safe_code=error.code if isinstance(error.code,str) and error.code in ERROR_MESSAGES else "unavailable"
    with factory() as db:
        changed=db.query(MeetingCapture).filter_by(id=record["id"],version=record["version"],
            analysis_run_id=record["analysis_run_id"],analysis_backend="meeting-analyzer",status="draft").filter(
            MeetingCapture.analysis_status.in_(("queued","running"))).update({
                "analysis_status":"failed","analysis_error_code":safe_code,
                "analysis_finished_at":now(),"updated_at":now(),"version":MeetingCapture.version+1,
                "analysis_ack_pending":bool(record["analysis_service_run_id"])},synchronize_session=False)
        if changed:
            _receipt(db, record, "discarded")
            if not record.get("analysis_service_run_id") and not record.get("_prior_delivery_unknown") and error.code != "invalid_result":
                db.query(MeetingDeliveryIntent).filter_by(operation_id=record["analysis_run_id"]).update(
                    {"phase": "resolved", "payload": None, "updated_at": now()}, synchronize_session=False)
        db.commit()
    if changed and record["analysis_service_run_id"] and error.status not in (404,410):
        try:
            call("POST",PREFIX+f"/{record['analysis_service_run_id']}/cancel",record,{})
        except Exception:
            pass
    return True


def deliver_one(factory, call=request, authorize=None):
    authorize = authorize or authorize_owner
    if _deliver_detached_intent(factory, call):
        return True
    if _deliver_receipt(factory, call):
        return True
    with factory() as db:
        expired = db.query(MeetingCapture).filter(MeetingCapture.analysis_backend == "meeting-analyzer",
            MeetingCapture.analysis_status.in_(("queued", "running")),
            MeetingCapture.analysis_requested_at < now()-timedelta(seconds=600)).all()
        for expired_row in expired:
            _receipt(db, {column.name: getattr(expired_row, column.name) for column in MeetingCapture.__table__.columns}, "discarded")
        db.query(MeetingCapture).filter(MeetingCapture.analysis_backend == "meeting-analyzer",
            MeetingCapture.analysis_status.in_(("queued", "running")),
            MeetingCapture.analysis_requested_at < now()-timedelta(seconds=600)).update({
                "analysis_status": "failed", "analysis_error_code": "interrupted",
                "analysis_finished_at": now(), "version": MeetingCapture.version+1}, synchronize_session=False)
        db.commit()
        row = db.query(MeetingCapture).filter(MeetingCapture.analysis_backend == "meeting-analyzer",
            or_(MeetingCapture.analysis_ack_pending.is_(True),
                MeetingCapture.analysis_status.in_(("queued", "running"))))
        row = row.order_by(MeetingCapture.updated_at, MeetingCapture.id).first()
        if row is None:
            return False
        record = {column.name: getattr(row, column.name) for column in MeetingCapture.__table__.columns}
        row.updated_at = now()
        revoked = (not record["analysis_ack_pending"] and not authorize(db,record["owner_id"]))
        if revoked:
            db.query(MeetingCapture).filter_by(id=record["id"],version=record["version"],
                analysis_run_id=record["analysis_run_id"]).filter(
                MeetingCapture.analysis_status.in_(("queued","running"))).update({
                    "analysis_status":"failed","analysis_error_code":"operation_forbidden",
                    "analysis_finished_at":now(),"analysis_ack_pending":bool(record["analysis_service_run_id"]),
                    "version":MeetingCapture.version+1},synchronize_session=False)
        if revoked:
            _receipt(db, record, "discarded")
        db.commit()
    if revoked:
        if record["analysis_service_run_id"]:
            try:
                call("POST",PREFIX+f"/{record['analysis_service_run_id']}/cancel",record,{})
            except Exception:
                pass  # DMB publication is already fenced; cleanup remains pending.
        return True
    run_id = record["analysis_service_run_id"]
    if record["analysis_ack_pending"]:
        with factory() as db:
            _receipt(db, record, "applied" if record["analysis_status"] == "completed" else "discarded")
            db.commit()
        return _deliver_receipt(factory, call)
    if not run_id:
        with factory() as db:
            current = db.query(MeetingCapture).filter_by(id=record["id"]).with_for_update().first()
            if (current is None or current.analysis_run_id != record["analysis_run_id"] or
                current.analysis_backend != "meeting-analyzer" or current.analysis_status not in ("queued","running") or
                current.analysis_service_run_id is not None):
                return True
            if current.version != record["version"]:
                current.analysis_status, current.analysis_error_code = "failed", "source_conflict"
                current.analysis_finished_at, current.updated_at = now(), now()
                current.version += 1
                db.commit()
                return True
            intent = create_intent(db, record)  # Rolling-upgrade fallback for old queued rows.
            if intent.phase == "resolved":
                return True
            payload = intent.payload
            record["_prior_delivery_unknown"] = intent.phase == "unknown"
            intent.phase, intent.updated_at = "unknown", now()
            db.commit()  # Must precede network IO, including timeouts and lost responses.
        try:
            accepted = call("POST", PREFIX, record, payload)
        except MeetingServiceError as failure:
            if failure.status==429 or _project_transport_failure(factory,record,failure,call):
                return True
            raise
        run_id = accepted["run_id"]
        with factory() as db:
            changed = db.query(MeetingCapture).filter_by(id=record["id"], version=record["version"],
                analysis_run_id=record["analysis_run_id"], analysis_service_run_id=None,
                analysis_backend="meeting-analyzer", analysis_status="queued").update({
                "analysis_service_run_id": run_id, "analysis_status": "running", "analysis_started_at": now()},
                synchronize_session=False)
            record["analysis_service_run_id"] = run_id
            _receipt(db, record, "pending" if changed == 1 else "discarded")
            db.query(MeetingDeliveryIntent).filter_by(operation_id=record["analysis_run_id"]).update(
                {"phase": "resolved", "payload": None, "updated_at": now()}, synchronize_session=False)
            db.commit()
        record["analysis_service_run_id"] = run_id
        if changed != 1:
            with factory() as db:
                _receipt(db, record, "discarded")
                db.commit()
            return True
    try:
        status = call("GET", PREFIX+f"/{run_id}", record)
    except MeetingServiceError as failure:
        if _project_transport_failure(factory,record,failure,call): return True
        raise
    if status["status"] not in ("completed", "failed", "cancelled", "interrupted"):
        return True
    items, error = None, None
    if status["status"] == "completed":
        try:
            result = call("GET", PREFIX+f"/{run_id}/result", record)
        except MeetingServiceError as failure:
            if failure.code == "invalid_result":
                _project_transport_failure(factory,record,failure,call)
                return True
            if failure.status not in (404,410):
                raise
            result,error=None,"result_expired"
        try:
            draft = MeetingDraft(title="Проверка", transcript=record["transcript"], items=result["result"]["items"])
            if any(i.origin != "ai" or i.selected or i.task_id or i.link_choice or i.due_date for i in draft.items):
                raise ValueError()
            items = [item.model_dump(mode="json") for item in draft.items]
        except (ValidationError, KeyError, ValueError, TypeError):
            error = error or "invalid_result"
    else:
        code=status.get("error")
        errors={"provider_auth_failed":"meeting_ai_auth","provider_quota_exhausted":"meeting_ai_quota",
            "provider_rate_limited":"meeting_ai_quota","local_budget_exceeded":"operation_limit",
            "operation_deadline_exceeded":"interrupted","invalid_model_result":"invalid_result",
            "model_result_incomplete":"invalid_result","model_capability_missing":"meeting_service_configuration"}
        error="cancelled" if status["status"]=="cancelled" else errors.get(code,"unavailable") if isinstance(code,str) else "unavailable"
    with factory() as db:
        if not authorize(db, record["owner_id"]):
            items, error = None, "operation_forbidden"
        values = {"analysis_status": "failed" if error else "completed", "analysis_error_code": error,
                  "analysis_finished_at": now(), "updated_at": now(), "version": MeetingCapture.version+1,
                  "analysis_ack_pending": True}
        if items is not None:
            values["items"] = items
        # The draft CAS and independent receipt commit in the same transaction.
        changed = db.query(MeetingCapture).filter_by(id=record["id"], version=record["version"], status="draft",
            analysis_run_id=record["analysis_run_id"], analysis_service_run_id=run_id,
            analysis_status="running").update(values, synchronize_session=False)
        if changed == 0:
            # Keep the edited draft, but terminate this projection observably.
            db.query(MeetingCapture).filter_by(id=record["id"], analysis_run_id=record["analysis_run_id"],
                analysis_service_run_id=run_id, analysis_status="running").update({
                    "analysis_status": "failed", "analysis_error_code": "source_conflict",
                    "analysis_finished_at": now(), "analysis_ack_pending": True}, synchronize_session=False)
        _receipt(db, record, "applied" if changed == 1 and not error else "discarded",
            result.get("payload_hash") if status["status"] == "completed" and isinstance(result, dict) else None)
        if changed == 1 and not error:
            _create_notification(db, record["owner_id"], None, "meeting_capture",
                f"Разбор встречи готов: {record['title']}"[:255],
                body=f"Найдено пунктов: {len(items)}. Проверьте результат перед сохранением.",
                action_url=f"#/meeting-capture?capture={record['id']}",
                group_key=f"meeting-analysis:{record['id']}:{record['analysis_run_id']}",
                event_type="meeting.analysis.completed")
        db.commit()
    return True
