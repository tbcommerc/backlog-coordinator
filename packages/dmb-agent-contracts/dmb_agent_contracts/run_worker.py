"""Durable technical execution with service-owned transactional product handlers."""
import threading
from contextlib import nullcontext
from uuid import uuid4

from .model import AgentError
from .operation import operation_scope
from .run_store import TERMINAL, fingerprint, now


def execute(store, row, handler, *, transaction_scope=lambda connection: nullcontext(), max_model_attempts=None):
    """handler(row, connection) returns a validated, JSON-serializable product envelope.

    Any domain writes MUST use connection through the service's transaction_scope.
    A failed final CAS raises inside the same transaction and rolls them all back.
    """
    try:
        with operation_scope(run_id=row["id"], deadline_at=row["deadline_at"],
                actor_ref=row["caller"]+":"+row["actor"], max_model_attempts=max_model_attempts) as context:
            row = store.transition(row, "preparing", lease_until=row["deadline_at"])
            if row is None:
                return
            row = store.transition(row, "running", dispatch_ref=str(uuid4()), delivery="unknown")
            if row is None:
                return
            context.model_profile_ref = row["profile"].get("remote_profile_ref")
            from .runtime_records import RuntimeRecords
            def authorize_binding():
                context.check()
                current = store.get(row["id"])
                if current["version"] != row["version"] or current["status"] != "running":
                    raise AgentError("operation_cancelled", 409)
            context.runtime_checkpoint = RuntimeRecords(store.engine, authorize_binding).checkpoint
            stopped = threading.Event()

            def monitor():
                while not stopped.wait(.1):
                    try:
                        current = store.get(row["id"])
                        if current["status"] in TERMINAL or current["version"] != row["version"]:
                            context.cancel()
                            return
                    except Exception:
                        context.cancel()  # An unverifiable ownership fence cannot authorize work.
                        return

            watcher = threading.Thread(target=monitor, daemon=True)
            watcher.start()
            try:
                with store.engine.begin() as connection, transaction_scope(connection):
                    context.check()
                    payload = handler(row, connection)
                    from fastapi.encoders import jsonable_encoder
                    payload = jsonable_encoder(payload)
                    context.check()
                    validating = store.transition(row, "validating", connection=connection, delivery="accepted")
                    if validating is None:
                        raise AgentError("operation_cancelled", 409)
                    completed = store.transition(validating, "completed", connection=connection,
                        result=payload, payload_hash=fingerprint(payload), finished_at=now())
                    if completed is None:
                        raise AgentError("operation_cancelled", 409)
            finally:
                stopped.set()
                watcher.join(timeout=2)
    except AgentError as error:
        if error.code.startswith(("global_limiter_", "operation_queue_")) or error.code == "actor_queue_full":
            store.defer(row, error.code)
            return "deferred"
        current = store.get(row["id"])
        if current["status"] not in TERMINAL and current["version"] == row["version"]:
            store.transition(current, "failed", error=error.code, finished_at=now())
    except Exception:
        current = store.get(row["id"])
        if current["status"] not in TERMINAL and current["version"] == row["version"]:
            store.transition(current, "failed", error="invalid_model_result", finished_at=now())


class Worker:
    def __init__(self, store, handler, *, runtime_profile=None, **options):
        self.store, self.handler, self.options = store, handler, options
        self.runtime_profile = runtime_profile
        self.stopping = threading.Event()
        self.thread = None

    def start(self):
        if self.thread is not None:
            raise RuntimeError("worker_already_started")
        self.thread = threading.Thread(target=self.run, daemon=True, name="agent-durable-runs")
        self.thread.start()

    def run(self):
        while not self.stopping.is_set():
            try:
                self.store.expire()
                if self.runtime_profile is not None:
                    profile = self.runtime_profile()
                    if profile is not None:
                        from .runtime_records import RuntimeRecords
                        from .limiter import require_runtime_limiter
                        RuntimeRecords(self.store.engine, lambda: None).recover_abandoned(
                            self.store, profile, require_runtime_limiter())
                row = self.store.claim()
                if row is not None:
                    outcome = execute(self.store, row, self.handler, **self.options)
                    if outcome != "deferred":
                        continue
            except Exception:
                pass  # No private input/provider errors in lifecycle logs; readiness checks schema.
            self.stopping.wait(1)

    def stop(self):
        self.stopping.set()
        if self.thread is not None:
            self.thread.join(timeout=2)
