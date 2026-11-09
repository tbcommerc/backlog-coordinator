"""Own PostgreSQL store. Tests may explicitly supply an in-memory SQL engine."""
import hashlib
import time
import uuid
from contextlib import nullcontext
from sqlalchemy import (MetaData, Table, Column, String, Text, Integer, Float, Boolean,
                        JSON, ForeignKey, UniqueConstraint, Index, select, update, delete, func, text)
from sqlalchemy.exc import IntegrityError
from backlog_assistant.security import canonical

metadata = MetaData()
from dmb_agent_contracts.run_store import metadata as run_metadata
for technical_table in run_metadata.tables.values():
    technical_table.to_metadata(metadata)
sessions = Table("backlog_assistant_sessions", metadata,
    Column("id", String(36), primary_key=True), Column("owner", String(512), nullable=False, index=True),
    Column("context", JSON, nullable=False), Column("revision", Integer, nullable=False),
    Column("archived", Boolean, nullable=False), Column("created", Float, nullable=False), Column("updated", Float, nullable=False))
runs = Table("backlog_assistant_runs", metadata,
    Column("id", String(36), primary_key=True), Column("session_id", ForeignKey(sessions.c.id, ondelete="CASCADE"), nullable=False),
    Column("owner", String(512), nullable=False, index=True), Column("execution_ref", String(128), unique=True, nullable=False),
    Column("key", String(128), nullable=False), Column("body_hash", String(64), nullable=False),
    Column("input", JSON, nullable=False), Column("status", String(32), nullable=False), Column("stage", String(64), nullable=False),
    Column("created", Float, nullable=False), Column("updated", Float, nullable=False),
    Column("lease_owner", String(36)), Column("lease_until", Float), Column("cancel_requested", Boolean, nullable=False),
    Column("dispatch_ref", String(36)), Column("dispatch_state", String(32)), Column("handle", JSON),
    Column("answer", JSON), Column("receipts", JSON, nullable=False), Column("error_code", String(64)),
    Column("cleanup_pending", Boolean, nullable=False, default=False),
    UniqueConstraint("session_id", "key", name="uq_assistant_message_key"))
ACTIVE = ("queued", "running", "cancelling")
Index("uq_assistant_active_session", runs.c.session_id, unique=True,
      postgresql_where=runs.c.status.in_(ACTIVE), sqlite_where=runs.c.status.in_(ACTIVE))
keys = Table("backlog_assistant_idempotency", metadata,
    Column("owner", String(512), primary_key=True), Column("operation", String(64), primary_key=True),
    Column("key", String(128), primary_key=True), Column("body_hash", String(64), nullable=False),
    Column("resource_ref", String(36), nullable=False), Column("expires", Float, nullable=False))
nonces = Table("backlog_assistant_nonces", metadata,
    Column("id", String(36), primary_key=True), Column("expires", Float, nullable=False))
feedback = Table("backlog_assistant_feedback", metadata,
    Column("run_id", ForeignKey(runs.c.id, ondelete="CASCADE"), primary_key=True),
    Column("owner", String(512), nullable=False), Column("body", JSON, nullable=False))
outbox = Table("backlog_assistant_purge_outbox", metadata,
    Column("id", String(36), primary_key=True), Column("owner", String(512), nullable=False), Column("receipts", JSON, nullable=False))


class StoreError(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status


class Store:
    def __init__(self, engine):
        self.engine = engine

    def consume_nonce(self, claims):
        try:
            with self.engine.begin() as c:
                c.execute(delete(nonces).where(nonces.c.expires < time.time()))
                c.execute(nonces.insert().values(id=claims["nonce"], expires=claims["expires_at"]))
        except IntegrityError:
            raise StoreError("replayed_attestation", 401)

    def _lock(self, c, owner):
        # Serializes cross-session quotas and idempotency on every worker.
        if c.dialect.name == "postgresql":
            value = int.from_bytes(hashlib.sha256(owner.encode()).digest()[:8], "big", signed=True)
            c.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": value})

    def _session(self, c, owner, sid):
        row = c.execute(select(sessions).where(sessions.c.id == sid, sessions.c.owner == owner).with_for_update()).mappings().first()
        if not row:
            raise StoreError("not_found", 404)
        return dict(row)

    def create(self, owner, key, body):
        hashed = hashlib.sha256(canonical(body).encode()).hexdigest()
        with self.engine.begin() as c:
            self._lock(c, owner)
            previous = c.execute(select(keys).where(keys.c.owner == owner, keys.c.operation == "session", keys.c.key == key)).mappings().first()
            if previous:
                if previous["body_hash"] != hashed:
                    raise StoreError("idempotency_conflict")
                return self._session(c, owner, previous["resource_ref"])
            now, sid = time.time(), str(uuid.uuid4())
            row = dict(id=sid, owner=owner, context=body["context"], revision=1, archived=False, created=now, updated=now)
            c.execute(sessions.insert().values(**row))
            c.execute(keys.insert().values(owner=owner, operation="session", key=key, body_hash=hashed, resource_ref=sid, expires=now+30*86400))
            return row

    def list_sessions(self, owner, cursor=0):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(select(sessions).where(sessions.c.owner == owner)
                .order_by(sessions.c.created.desc(), sessions.c.id).offset(cursor).limit(50)).mappings()]

    def session(self, owner, sid):
        with self.engine.begin() as c:
            row = self._session(c, owner, sid)
            row["runs"] = [dict(r) for r in c.execute(select(runs).where(runs.c.session_id == sid)
                .order_by(runs.c.created, runs.c.id)).mappings()]
            return row

    def patch(self, owner, sid, body):
        with self.engine.begin() as c:
            row = self._session(c, owner, sid)
            if row["revision"] != body["context_revision"]:
                raise StoreError("context_conflict")
            if c.execute(select(runs.c.id).where(runs.c.session_id == sid, runs.c.status.in_(ACTIVE))).first():
                raise StoreError("run_active")
            values = dict(archived=body["archived"], revision=row["revision"]+1, updated=time.time())
            if body.get("context") is not None:
                values["context"] = body["context"]
            c.execute(update(sessions).where(sessions.c.id == sid).values(**values))
            return dict(row, **values)

    def enqueue(self, owner, sid, key, body, *, connection=None, run_id=None):
        hashed = hashlib.sha256(canonical(body).encode()).hexdigest()
        with (nullcontext(connection) if connection is not None else self.engine.begin()) as c:
            self._lock(c, "queue")
            self._lock(c, owner)
            s = self._session(c, owner, sid)
            old = c.execute(select(runs).where(runs.c.session_id == sid, runs.c.key == key)).mappings().first()
            if old:
                if old["body_hash"] != hashed:
                    raise StoreError("idempotency_conflict")
                return dict(old)
            if s["archived"] or s["revision"] != body["context_revision"] or s["context"] != body["context"]:
                raise StoreError("context_conflict")
            if c.execute(select(runs.c.id).where(runs.c.session_id == sid, runs.c.status.in_(ACTIVE))).first():
                raise StoreError("run_active")
            count = lambda *where: c.execute(select(func.count()).select_from(runs).where(*where)).scalar_one()
            if (count(runs.c.owner == owner, runs.c.status.in_(ACTIVE)) >= 2 or
                    count(runs.c.owner == owner, runs.c.created > time.time()-60) >= 10 or
                    count(runs.c.status == "queued") >= 20):
                raise StoreError("capacity_exceeded", 429)
            row = dict(id=run_id or str(uuid.uuid4()), session_id=sid, owner=owner, execution_ref=body["execution_ref"],
                key=key, body_hash=hashed, input=body, status="queued", stage="queued", created=time.time(),
                updated=time.time(), cancel_requested=False, receipts=[], cleanup_pending=False)
            c.execute(runs.insert().values(**row))
            c.execute(update(sessions).where(sessions.c.id == sid).values(updated=time.time()))
            return row

    def get_run(self, owner, rid):
        with self.engine.connect() as c:
            row = c.execute(select(runs).where(runs.c.id == rid, runs.c.owner == owner)).mappings().first()
            if not row:
                raise StoreError("not_found", 404)
            return dict(row)

    def cancel(self, owner, rid):
        with self.engine.begin() as c:
            self._lock(c, owner)
            row = c.execute(select(runs).where(runs.c.id == rid, runs.c.owner == owner).with_for_update()).mappings().first()
            if not row:
                raise StoreError("not_found", 404)
            if row["status"] in ACTIVE:
                values = dict(cancel_requested=True,
                    status="cancelled" if row["status"] == "queued" else "cancelling", updated=time.time())
                c.execute(update(runs).where(runs.c.id == rid).values(**values))
                from backlog_assistant.runs import sync
                sync(self, c, dict(row), values)

    def claim(self, worker):
        with self.engine.begin() as c:
            self._lock(c, "queue")
            # Expired dispatches never return to queued: no duplicate prompt.
            expired = c.execute(select(runs).where(
                (runs.c.status.in_(("running", "cancelling")) & (runs.c.lease_until < time.time())) |
                ((runs.c.status == "queued") & (runs.c.created < time.time()-15)))
                .with_for_update()).mappings().all()
            from backlog_assistant.runs import sync
            for old in expired:
                values = (dict(status="expired", error_code="queue_timeout") if old["status"] == "queued"
                    else dict(status="interrupted", error_code="lease_expired", cleanup_pending=True))
                c.execute(update(runs).where(runs.c.id == old["id"]).values(**values))
                sync(self, c, dict(old), values)
            active = c.execute(select(func.count()).select_from(runs).where(
                runs.c.status.in_(("running", "cancelling")) | runs.c.cleanup_pending.is_(True))).scalar_one()
            if active >= 4:
                return None
            row = c.execute(select(runs).where(runs.c.status == "queued").order_by(runs.c.created)
                .limit(1).with_for_update(skip_locked=True)).mappings().first()
            if not row:
                return None
            values = dict(status="running", stage="reading", lease_owner=worker, lease_until=time.time()+10)
            c.execute(update(runs).where(runs.c.id == row["id"]).values(**values))
            return dict(row, **values)

    def defer(self, rid, worker, error):
        with self.engine.begin() as c:
            changed = c.execute(update(runs).where(runs.c.id == rid, runs.c.lease_owner == worker,
                runs.c.status == "running", runs.c.dispatch_ref.is_(None),
                runs.c.cancel_requested.is_(False)).values(status="queued", stage="waiting_for_slot",
                    lease_owner=None, lease_until=None, error_code=error, updated=time.time()))
            return changed.rowcount == 1

    def save(self, rid, worker, **values):
        with self.engine.begin() as c:
            row = c.execute(select(runs).where(runs.c.id == rid, runs.c.lease_owner == worker).with_for_update()).mappings().first()
            if not row or row["status"] not in ACTIVE or row["lease_until"] < time.time():
                raise StoreError("lease_lost")
            if row["cancel_requested"] and values.get("status") in {"completed", "partial"}:
                raise StoreError("cancelled")
            c.execute(update(runs).where(runs.c.id == rid).values(updated=time.time(), **values))
            from backlog_assistant.runs import sync
            sync(self, c, dict(row), values)

    def heartbeat(self, rid, worker):
        with self.engine.begin() as c:
            row = c.execute(select(runs).where(runs.c.id == rid, runs.c.lease_owner == worker).with_for_update()).mappings().first()
            if not row or row["status"] not in ACTIVE or row["lease_until"] < time.time():
                raise StoreError("lease_lost")
            if row["cancel_requested"]:
                raise StoreError("cancelled")
            c.execute(update(runs).where(runs.c.id == rid).values(lease_until=time.time()+10))

    def rate(self, owner, rid, body):
        with self.engine.begin() as c:
            self._lock(c, owner)
            row = c.execute(select(runs.c.id).where(runs.c.id == rid, runs.c.owner == owner, runs.c.answer.is_not(None))).first()
            if not row:
                raise StoreError("not_found", 404)
            c.execute(delete(feedback).where(feedback.c.run_id == rid))
            c.execute(feedback.insert().values(run_id=rid, owner=owner, body=body))

    def remove(self, owner, sid):
        blocked = False
        with self.engine.begin() as c:
            self._session(c, owner, sid)
            rows = c.execute(select(runs).where(runs.c.session_id == sid)).mappings().all()
            if any(r["status"] in ACTIVE or r["cleanup_pending"] for r in rows):
                for row in rows:
                    if row["status"] in ACTIVE:
                        c.execute(update(runs).where(runs.c.id == row["id"]).values(cancel_requested=True,
                            status="cancelled" if row["status"] == "queued" else "cancelling"))
                blocked = True
            else:
                refs = [ref for r in rows for ref in r["receipts"]]
                c.execute(outbox.insert().values(id=str(uuid.uuid4()), owner=owner, receipts=refs))
                c.execute(delete(feedback).where(feedback.c.run_id.in_([r["id"] for r in rows])))
                c.execute(delete(runs).where(runs.c.session_id == sid))
                c.execute(delete(keys).where(keys.c.resource_ref == sid))
                c.execute(delete(sessions).where(sessions.c.id == sid))
        if blocked:
            raise StoreError("cancel_before_delete")
