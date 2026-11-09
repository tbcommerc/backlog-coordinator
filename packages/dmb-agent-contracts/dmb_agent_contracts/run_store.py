"""Durable technical queue. Every transition fences stale workers."""
import hashlib
import json
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from dmb_agent_contracts.key_retention import frozen_profile, public_row, expiry as key_expiry, tombstone_profile
from sqlalchemy import (MetaData, Table, Column, String, Integer, Text, DateTime,
                        JSON, UniqueConstraint, select, update, func)
from sqlalchemy.exc import IntegrityError
from dmb_agent_contracts.retry import canonical_body, validate_retry
from dmb_agent_contracts.model import AgentError

metadata = MetaData()
runs = Table("agent_runs", metadata,
    Column("id", String(36), primary_key=True), Column("caller", String(128), nullable=False),
    Column("actor", String(128), nullable=False), Column("key", String(128), nullable=False),
    Column("request_hash", String(64), nullable=False), Column("input", JSON),
    Column("retry_of", String(36)),
    Column("profile", JSON, nullable=False), Column("source", JSON, nullable=False),
    Column("operation", String(80), nullable=False), Column("conversation_ref", String(128)),
    Column("trusted_context", JSON, nullable=False),
    Column("status", String(24), nullable=False), Column("version", Integer, nullable=False),
    Column("delivery", String(24), nullable=False), Column("dispatch_ref", String(36)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("deadline_at", DateTime(timezone=True), nullable=False),
    Column("lease_until", DateTime(timezone=True)), Column("finished_at", DateTime(timezone=True)),
    Column("cancel_requested_at", DateTime(timezone=True)), Column("result", JSON),
    Column("payload_hash", String(64)), Column("error", String(64)), Column("ack_at", DateTime(timezone=True)),
    Column("result_expired", Integer, nullable=False, default=0),
    UniqueConstraint("caller", "actor", "operation", "key", name="uq_agent_run_idempotency"))
events = Table("agent_run_events", metadata,
    Column("run_id", String(36), primary_key=True), Column("sequence", Integer, primary_key=True),
    Column("type", String(32), nullable=False), Column("occurred_at", DateTime(timezone=True), nullable=False))
TERMINAL = ("completed", "failed", "cancelled", "interrupted")


def now():
    return datetime.now(timezone.utc)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Store:
    def __init__(self, engine, retention=None):
        self.engine = engine
        self.retention = {"snapshot_hours": 24, "result_days": 7, "metadata_days": 7, "idempotency_days": 14}
        self.retention.update(retention or {})

    def event(self, conn, row, kind):
        conn.execute(events.insert().values(run_id=row["id"], sequence=row["version"], type=kind, occurred_at=now()))

    def create(self, caller, actor, key, body, profile, deadline_seconds, queue_limit, *, deadline_at=None, trusted_context=None, connection=None):
        trusted_context = trusted_context or {}
        body = canonical_body(body)
        digest = fingerprint({"canonicalization": 1, "request": body, "profile": profile, "context": trusted_context})
        scope = (runs.c.caller == caller, runs.c.actor == actor, runs.c.operation == body["operation"], runs.c.key == key)
        def replay(row):
            if row["request_hash"] != digest:
                raise AgentError("idempotency_conflict", 409)
            if row["result_expired"]:
                raise AgentError("result_expired", 410)
            return public_row(row), True
        try:
            if connection is not None and (connection.engine is not self.engine or not connection.in_transaction()):
                raise ValueError("active_owned_transaction_required")
            with (nullcontext(connection) if connection is not None else self.engine.begin()) as conn:
                # Serializes admission across all API workers, including queue limit.
                if self.engine.dialect.name == "postgresql":
                    from sqlalchemy import text
                    conn.execute(text("SELECT pg_advisory_xact_lock(9500101)"))
                old = conn.execute(select(runs).where(*scope)).mappings().first()
                if old:
                    return replay(old)
                pending = conn.scalar(select(func.count()).select_from(runs).where(runs.c.status.not_in(TERMINAL)))
                if pending >= queue_limit:
                    raise AgentError("queue_full", 429)
                retry_of = validate_retry(conn, runs, caller, actor, body)
                timestamp = now()
                deadline=timestamp+timedelta(seconds=deadline_seconds)
                if deadline_at is not None:
                    if deadline_at.tzinfo is None: raise AgentError("input_validation_failed",422)
                    deadline=min(deadline,deadline_at.astimezone(timezone.utc))
                if deadline<=timestamp: raise AgentError("operation_deadline_exceeded",504)
                row = dict(id=str(uuid4()), caller=caller, actor=actor, key=key, request_hash=digest,
                    input=body["input"], source=body["source"], profile=profile, retry_of=retry_of,
                    operation=body["operation"], conversation_ref=body.get("conversation_ref"), trusted_context=trusted_context, status="queued", version=1,
                    delivery="not_attempted", created_at=timestamp,
                    deadline_at=deadline, result_expired=0)
                conn.execute(runs.insert().values(**{**row,"profile":frozen_profile(row["profile"],row["created_at"],self.retention["idempotency_days"])}))
                self.event(conn, row, "accepted")
                return row, False
        except IntegrityError:
            with self.engine.connect() as conn:
                return replay(conn.execute(select(runs).where(*scope)).mappings().one())

    def cancel_key(self, caller, actor, key, body, profile, deadline_seconds, deadline_at=None, trusted_context=None, connection=None):
        """Fence an unknown create outcome, including a create still in flight."""
        body = canonical_body(body)
        if connection is not None and (connection.engine is not self.engine or not connection.in_transaction()):
            raise ValueError("active_owned_transaction_required")
        with (nullcontext(connection) if connection is not None else self.engine.begin()) as conn:
            if self.engine.dialect.name == "postgresql":
                from sqlalchemy import text
                conn.execute(text("SELECT pg_advisory_xact_lock(9500101)"))
            row = conn.execute(select(runs).where(runs.c.caller == caller,
                runs.c.actor == actor, runs.c.operation == body["operation"], runs.c.key == key)).mappings().first()
            timestamp = now()
            if row is not None:
                row = public_row(row)
                if row["result_expired"]:
                    raise AgentError("result_expired", 410)
                if fingerprint({"canonicalization":1,"request":body,"profile":row["profile"], "context": row["trusted_context"]}) != row["request_hash"]:
                    raise AgentError("idempotency_conflict", 409)
                if row["status"] in TERMINAL:
                    return row, True
                changed = conn.execute(update(runs).where(runs.c.id == row["id"],
                    runs.c.version == row["version"], runs.c.status.not_in(TERMINAL)).values(
                        status="cancelled", version=row["version"]+1,
                        cancel_requested_at=timestamp, finished_at=timestamp))
                if changed.rowcount != 1:
                    raise AgentError("source_revision_conflict", 409)
                row.update(status="cancelled", version=row["version"]+1,
                    cancel_requested_at=timestamp, finished_at=timestamp)
                self.event(conn, row, "cancelled")
                return row, True
            retry_of = validate_retry(conn, runs, caller, actor, body)
            deadline = timestamp + timedelta(seconds=deadline_seconds)
            if deadline_at is not None:
                if deadline_at.tzinfo is None:
                    raise AgentError("invalid_request", 400)
                deadline = min(deadline, deadline_at.astimezone(timezone.utc))
            row = dict(id=str(uuid4()), caller=caller, actor=actor, key=key,
                request_hash=fingerprint({"canonicalization": 1, "request": body, "profile": profile, "context": trusted_context or {}}),
                input=body["input"], source=body["source"], profile=profile, retry_of=retry_of,
                    operation=body["operation"], conversation_ref=body.get("conversation_ref"), trusted_context=trusted_context or {},
                status="cancelled", version=1, delivery="not_attempted", created_at=timestamp,
                deadline_at=deadline, finished_at=timestamp, cancel_requested_at=timestamp, result_expired=0)
            conn.execute(runs.insert().values(**{**row,"profile":frozen_profile(row["profile"],row["created_at"],self.retention["idempotency_days"])}))
            self.event(conn, row, "cancelled")
            return row, False

    def find_key(self, caller, actor, key, operation):
        with self.engine.connect() as connection:
            row = connection.execute(select(runs).where(runs.c.caller == caller,
                runs.c.actor == actor, runs.c.operation == operation, runs.c.key == key)).mappings().first()
            return public_row(row) if row is not None else None

    def get(self, run_id, caller=None, actor=None):
        query = select(runs).where(runs.c.id == run_id)
        if caller is not None:
            query = query.where(runs.c.caller == caller, runs.c.actor == actor)
        with self.engine.connect() as conn:
            row = conn.execute(query).mappings().first()
            if row is None:
                raise AgentError("run_not_found", 404)
            return public_row(row)

    def transition(self, row, status, *, connection=None, **values):
        allowed = {"queued": {"preparing", "cancelled", "failed"},
                   "preparing": {"running", "cancelled", "failed", "interrupted"},
                   "running": {"validating", "cancelled", "failed", "interrupted"},
                   "validating": {"completed", "cancelled", "failed", "interrupted"}}
        if status not in allowed.get(row["status"], set()):
            raise AgentError("invalid_state_transition", 409)
        if connection is not None and (connection.engine is not self.engine or not connection.in_transaction()):
            raise ValueError("active_owned_transaction_required")
        with (nullcontext(connection) if connection is not None else self.engine.begin()) as conn:
            conditions = [runs.c.id == row["id"], runs.c.version == row["version"],
                          runs.c.status == row["status"], runs.c.status.not_in(TERMINAL)]
            if status in ("running", "validating", "completed") and row.get("lease_until") is not None:
                conditions.append(runs.c.lease_until > now())
            result = conn.execute(update(runs).where(*conditions).values(
                status=status, version=row["version"]+1, **values))
            if result.rowcount != 1:
                return None
            changed = {**row, **values, "status": status, "version": row["version"]+1}
            self.event(conn, changed, "result_ready" if status == "completed" else status)
            return changed

    def defer(self, row, error):
        """Only an un-dispatched claim may return to its durable queue."""
        with self.engine.begin() as conn:
            changed = conn.execute(update(runs).where(runs.c.id == row["id"],
                runs.c.version == row["version"], runs.c.status == "queued",
                runs.c.delivery == "not_attempted").values(status="queued", version=row["version"]+1,
                    lease_until=None, error=error))
            if changed.rowcount != 1:
                return False
            self.event(conn, {**row, "version": row["version"]+1}, "queue_deferred")
            return True

    def claim(self):
        with self.engine.begin() as conn:
            row = conn.execute(select(runs).where(runs.c.status == "queued",
                (runs.c.lease_until.is_(None)) | (runs.c.lease_until <= now())).order_by(runs.c.created_at)
                               .with_for_update(skip_locked=True).limit(1)).mappings().first()
            if not row:
                return None
            row = public_row(row)
            deadline=row["deadline_at"]
            if deadline.tzinfo is None: deadline=deadline.replace(tzinfo=timezone.utc)
            row["deadline_at"]=deadline
            changed = conn.execute(update(runs).where(runs.c.id == row["id"], runs.c.version == row["version"],
                runs.c.status == "queued").values(version=row["version"]+1,
                lease_until=min(now()+timedelta(seconds=30),row["deadline_at"]),error=None))
            if changed.rowcount != 1:
                return None
            row.update(version=row["version"]+1, lease_until=min(now()+timedelta(seconds=30),row["deadline_at"]),error=None)
            self.event(conn, row, "queue_claimed")
            return row

    def expire(self):
        timestamp = now()
        with self.engine.connect() as conn:
            stale = conn.execute(select(runs).where(runs.c.status.not_in(TERMINAL),
                                                    runs.c.deadline_at < timestamp)).mappings().all()
        for row in stale:
            self.transition(dict(row), "failed" if row["status"]=="queued" else "interrupted", error="operation_deadline_exceeded", finished_at=timestamp)
        policy = self.retention
        with self.engine.begin() as conn:
            conn.execute(update(runs).where(runs.c.status.in_(TERMINAL),
                runs.c.finished_at < timestamp-timedelta(hours=policy["snapshot_hours"])).values(input=None))
            candidates = conn.execute(select(runs).where(runs.c.status.in_(TERMINAL), runs.c.result_expired == 0,
                ((runs.c.finished_at < timestamp-timedelta(days=policy["result_days"])) | runs.c.ack_at.is_not(None)))
                .with_for_update(skip_locked=True)).mappings().all()
            for row in candidates:
                kind = "result_acknowledged" if row["ack_at"] is not None else "result_expired"
                changed = conn.execute(update(runs).where(runs.c.id == row["id"], runs.c.version == row["version"],
                    runs.c.result_expired == 0).values(result=None, result_expired=1, version=row["version"]+1,
                    error=row["error"] if row["ack_at"] is not None else "result_expired"))
                if changed.rowcount:
                    self.event(conn, {**row, "version":row["version"]+1}, kind)
            metadata_cutoff = timestamp-timedelta(days=policy["metadata_days"])
            old_rows = conn.execute(select(runs).where(runs.c.status.in_(TERMINAL),
                runs.c.finished_at < metadata_cutoff).with_for_update(skip_locked=True)).mappings().all()
            for row in old_rows:
                conn.execute(events.delete().where(events.c.run_id == row["id"]))
                condition = (runs.c.id == row["id"], runs.c.version == row["version"])
                if key_expiry(row) <= timestamp:
                    conn.execute(runs.delete().where(*condition))
                else:
                    # Keep only the immutable key guarantee, not the model
                    # profile, snapshots or trusted actor context.
                    values = dict(input=None,result=None,profile=tombstone_profile(row),source={},
                        payload_hash=None,result_expired=1)
                    values["trusted_context"] = {}
                    conn.execute(update(runs).where(*condition).values(**values))
