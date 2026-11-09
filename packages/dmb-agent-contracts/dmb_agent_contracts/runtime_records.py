"""Durable private runtime binding checkpoints, independent of product run tables."""
from datetime import datetime, timezone
import os
import socket
from sqlalchemy import MetaData, Table, Column, String, Integer, JSON, DateTime, select, update, inspect

from .model import AgentError

metadata = MetaData()
bindings = Table("agent_runtime_bindings", metadata,
    Column("run_id", String(36), primary_key=True), Column("request_id", String(36), primary_key=True),
    Column("binding", JSON, nullable=False), Column("delivery", String(24), nullable=False),
    Column("cleanup", String(24), nullable=False), Column("updated_at", DateTime(timezone=True), nullable=False))
versions = Table("agent_runtime_migrations", metadata, Column("version", Integer, primary_key=True))


def validate(engine):
    inspector = inspect(engine)
    if not set(metadata.tables) <= set(inspector.get_table_names()):
        raise AgentError("runtime_binding_schema_not_migrated", 503)
    for table in metadata.tables.values():
        actual = {column["name"]: column for column in inspector.get_columns(table.name)}
        if set(actual) != set(table.columns.keys()) or any(
            actual[column.name]["type"]._type_affinity != column.type._type_affinity or
            actual[column.name]["nullable"] != column.nullable for column in table.columns):
            raise AgentError("runtime_binding_schema_incompatible", 503)
        if inspector.get_pk_constraint(table.name).get("constrained_columns") != list(table.primary_key.columns.keys()):
            raise AgentError("runtime_binding_schema_incompatible", 503)
    with engine.connect() as connection:
        if connection.execute(select(versions.c.version)).scalars().all() != [1]:
            raise AgentError("runtime_binding_schema_incompatible", 503)


def migrate(engine, *, backup_verified=False, allowed_existing=()):
    existing = set(inspect(engine).get_table_names())
    if existing - set(metadata.tables) - set(allowed_existing):
        raise AgentError("runtime_binding_database_not_owned", 503)
    if set(metadata.tables) <= existing:
        validate(engine)
        return
    if existing and not backup_verified:
        raise AgentError("runtime_binding_backup_required", 503)
    if existing & set(metadata.tables):
        raise AgentError("runtime_binding_schema_incompatible", 503)
    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(versions.insert().values(version=1))
    validate(engine)


class RuntimeRecords:
    def __init__(self, engine, authorize):
        self.engine, self.authorize = engine, authorize

    def checkpoint(self, request, binding):
        if binding.get("cleanup") != "confirmed" and binding.get("owner_finished") is not True:
            self.authorize()
        # Binding must never contain network credentials or model text.
        allowed = {"session_id", "message_id", "dispatch_ref", "delivery", "cleanup", "cancelled", "lease_id", "profile_ref", "preparation_ref", "owner_finished"}
        if (set(binding)-allowed or binding.get("delivery") not in {"not_attempted","unknown","accepted"}
                or binding.get("cleanup") not in {"pending","failed","confirmed"}
                or not isinstance(binding.get("owner_finished",False),bool)):
            raise AgentError("runtime_binding_invalid", 503)
        with self.engine.begin() as connection:
            condition = (bindings.c.run_id == str(request.run_id), bindings.c.request_id == str(request.request_id))
            present = connection.execute(select(bindings).where(*condition).with_for_update()).mappings().first()
            from .limiter import process_identity
            status, birth = process_identity(os.getpid())
            if present is None and (status != "alive" or not isinstance(birth, str) or not birth):
                raise AgentError("runtime_owner_unverifiable",503)
            owner = present["binding"].get("owner") if present else {
                "host": socket.gethostname(), "pid": os.getpid(), "birth": birth}
            stored_binding = {**binding, "owner": owner}
            value = dict(binding=stored_binding, delivery=binding["delivery"], cleanup=binding["cleanup"],
                updated_at=datetime.now(timezone.utc))
            if present is None:
                self.authorize()
                connection.execute(bindings.insert().values(run_id=str(request.run_id), request_id=str(request.request_id), **value))
            else:
                if (present["binding"].get("preparation_ref") != binding.get("preparation_ref") or
                    present["binding"].get("message_id") != binding.get("message_id") or
                    present["binding"].get("profile_ref") != binding.get("profile_ref") or
                    present["binding"].get("dispatch_ref") is not None and present["binding"].get("dispatch_ref") != binding.get("dispatch_ref") or
                    present["binding"].get("session_id") is not None and present["binding"].get("session_id") != binding.get("session_id")):
                    raise AgentError("runtime_binding_conflict", 409)
                order = {"not_attempted":0,"unknown":1,"accepted":2}
                if (order.get(binding["delivery"],-1) < order.get(present["delivery"],-1) or
                    present["cleanup"] == "confirmed" and binding["cleanup"] != "confirmed" or
                    present["binding"].get("owner_finished") is True and binding.get("owner_finished") is not True):
                    raise AgentError("runtime_binding_conflict",409)
                connection.execute(update(bindings).where(*condition).values(**value))


    def recover_abandoned(self, store, profile, limiter):
        """Cleanup only: never collect results or dispatch an interrupted request.

        A terminal product fence AND a demonstrably dead local process (or this
        process's durable final checkpoint) are required. Old records without an owner remain pending for operator review.
        """
        from .limiter import process_identity
        from .run_store import TERMINAL
        from .runtime import RuntimeHandle
        with self.engine.connect() as connection:
            rows = connection.execute(select(bindings).order_by(bindings.c.updated_at)).mappings().all()
        touched = set()
        for row in rows:
            value = row["binding"]
            owner = value.get("owner") or {}
            if (owner.get("host") != socket.gethostname() or not isinstance(owner.get("pid"), int)
                    or not isinstance(owner.get("birth"), str) or not owner["birth"]):
                continue
            status, birth = process_identity(owner["pid"])
            own_finished = (owner["pid"] == os.getpid() and birth == owner["birth"]
                and value.get("owner_finished") is True)
            if status == "unknown" or status == "alive" and birth == owner.get("birth") and not own_finished:
                continue
            try:
                current_run = store.get(row["run_id"])
            except AgentError:
                continue  # Missing metadata cannot authorize a cleanup or block other runs.
            if current_run["status"] not in TERMINAL or value.get("profile_ref") != profile.profile_ref:
                continue
            if row["cleanup"] == "confirmed":
                touched.add(row["run_id"])
                continue
            runtime = profile.runtime()
            try:
                if value.get("session_id"):
                    handle = RuntimeHandle(value["session_id"], value["message_id"], {},
                        preparation_ref=value["preparation_ref"], run_id=row["run_id"])
                else:
                    handle = runtime.recover_session({"run_id":row["run_id"],
                        "preparation_ref":value["preparation_ref"], "message_id":value["message_id"]}, {})
                if handle is None:
                    continue  # A search miss does not prove a timed-out create absent.
                try:
                    runtime.cancel(handle, "abandoned_owner")
                except AgentError:
                    pass
                if runtime.dispose(handle).get("cleanup") != "confirmed":
                    continue
                with self.engine.begin() as connection:
                    current = connection.execute(select(bindings).where(
                        bindings.c.run_id == row["run_id"], bindings.c.request_id == row["request_id"])
                        .with_for_update()).mappings().one()
                    if current["binding"] != value:
                        continue
                    connection.execute(update(bindings).where(bindings.c.run_id == row["run_id"],
                        bindings.c.request_id == row["request_id"]).values(
                            binding={**value, "cleanup":"confirmed", "cancelled":True}, cleanup="confirmed",
                            updated_at=datetime.now(timezone.utc)))
                touched.add(row["run_id"])
            except AgentError:
                continue  # Keep the slot occupied when cleanup cannot be proven.
        for run_id in touched:
            with self.engine.connect() as connection:
                pending = connection.execute(select(bindings.c.request_id).where(
                    bindings.c.run_id == run_id, bindings.c.cleanup != "confirmed")).first()
            if pending is None:
                limiter.confirm_run_cleanup(run_id)
        return len(touched)
