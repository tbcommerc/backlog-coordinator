"""Map the common facade onto the existing mTLS/attestation execution boundary."""
from contextlib import nullcontext
import hashlib
import re

from sqlalchemy import select, update, case

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_api import router
from dmb_agent_contracts.run_store import Store as RunStore, TERMINAL, fingerprint, now, runs as technical_runs
from contracts.models import MessageCreate
from .store import runs as legacy_runs


class FacadeStore(RunStore):
    def __init__(self, legacy):
        super().__init__(legacy.engine)
        self.legacy = legacy

    def create(self, caller, actor, key, body, profile, deadline_seconds, queue_limit, **options):
        with self.engine.begin() as connection:
            row, replayed = super().create(caller, actor, key, body, profile, deadline_seconds,
                queue_limit, connection=connection, **options)
            if not replayed:
                original = self.legacy.enqueue(actor, body["conversation_ref"], key, body["input"],
                    connection=connection, run_id=row["id"])
                if original["id"] != row["id"]:
                    raise AgentError("idempotency_conflict", 409)
            return row, replayed

    def transition(self, row, status, *, connection=None, **values):
        with (nullcontext(connection) if connection is not None else self.engine.begin()) as transaction:
            transaction.execute(select(legacy_runs.c.id).where(legacy_runs.c.id == row["id"]).with_for_update()).first()
            changed = super().transition(row, status, connection=transaction, **values)
            if changed is not None and status == "cancelled":
                transaction.execute(update(legacy_runs).where(legacy_runs.c.id == row["id"],
                    legacy_runs.c.status.in_(("queued", "running", "cancelling"))).values(
                        cancel_requested=True, status=case((legacy_runs.c.status == "queued", "cancelled"), else_="cancelling")))
            return changed

    def cancel_key(self, *args, **options):
        with self.engine.begin() as connection:
            previous = connection.execute(select(technical_runs.c.id).where(technical_runs.c.caller == args[0],
                technical_runs.c.actor == args[1], technical_runs.c.key == args[2])).scalar()
            if previous:
                connection.execute(select(legacy_runs.c.id).where(legacy_runs.c.id == previous).with_for_update()).first()
            row, replayed = super().cancel_key(*args, connection=connection, **options)
            if row["status"] == "cancelled":
                connection.execute(update(legacy_runs).where(legacy_runs.c.id == row["id"],
                    legacy_runs.c.status.in_(("queued", "running", "cancelling"))).values(
                        cancel_requested=True, status=case((legacy_runs.c.status == "queued", "cancelled"), else_="cancelling")))
            return row, replayed


def sync(legacy, connection, row, values):
    """Publish verified answer and technical status in the SAME database transaction."""
    current = connection.execute(select(technical_runs).where(technical_runs.c.id == row["id"])
        .with_for_update()).mappings().first()
    if current is None:
        return  # A legacy API run has no common-facade envelope.
    current = dict(current)
    merged = {**row, **values}
    status, stage = merged["status"], merged["stage"]
    if current["status"] in TERMINAL:
        if status in ("completed", "partial") and current["status"] != "completed":
            from .store import StoreError
            raise StoreError("cancelled", 409)
        return
    store = RunStore(legacy.engine)
    desired = ("completed" if status in ("completed", "partial") else
        "cancelled" if status in ("cancelled", "cancelling") else
        "interrupted" if status == "interrupted" else "failed" if status in ("expired", "failed") else
        "validating" if stage == "verifying" else "running" if merged.get("dispatch_ref") else
        "preparing" if stage == "preparing" or merged.get("handle") else "queued")
    if desired == "queued":
        return
    if desired in ("completed", "validating", "running", "preparing"):
        path = ("queued", "preparing", "running", "validating", "completed")
        for next_status in path[path.index(current["status"])+1:path.index(desired)+1]:
            extra = {"lease_until": current["deadline_at"]}
            if next_status == "running":
                extra.update(delivery="unknown", dispatch_ref=merged.get("dispatch_ref"))
            if next_status == "completed":
                payload = {"quality": "partial" if status == "partial" else "full", "payload": merged["answer"]}
                extra.update(result=payload, payload_hash=fingerprint(payload), delivery="accepted", finished_at=now())
            current = store.transition(current, next_status, connection=connection, **extra)
            if current is None:
                raise AgentError("source_revision_conflict", 409)
    else:
        if current["status"] == "queued" and desired == "interrupted":
            desired = "failed"
        store.transition(current, desired, connection=connection, finished_at=now(), error=merged.get("error_code"))



def execution_profile(runtime):
    from runtime.fake import FakeRuntime
    from runtime.opencode import OpenCodeRuntime
    from runtime.prepared import PreparedRuntime
    if isinstance(runtime,FakeRuntime):
        return {"runtime":"synthetic_fixture","contract":"1.17.13","provider":"synthetic"}
    if isinstance(runtime,OpenCodeRuntime):
        return {"runtime":"local_isolated","contract":"1.17.13","provider":"opencode_go",
            "model":runtime.model,"image":runtime.launcher.image,
            "endpoint_ref":hashlib.sha256(runtime.launcher.provider_url.rstrip("/").encode()).hexdigest()}
    if isinstance(runtime,PreparedRuntime):
        reference = getattr(runtime.deployment,"profile_ref","")
        if not isinstance(reference,str) or not re.fullmatch(r"[a-f0-9]{64}",reference):
            raise AgentError("runtime_profile_unqualified",503)
        return {"runtime":"remote","contract":"1.17.13","provider":"opencode_go","profile_ref":reference}
    raise AgentError("runtime_profile_unqualified",503)


def build_router(legacy, data, identity, runtime):
    store = FacadeStore(legacy)

    async def authenticate(owner=__import__("fastapi").Depends(identity)):
        return "dmb", owner

    def validate(body):
        if body["operation"] != "backlog.answer":
            raise AgentError("unsupported_operation", 422)
        message = MessageCreate.model_validate(body["input"])
        if (not body.get("conversation_ref") or body["source"]["kind"] != "assistant_context"
            or body["source"]["ref"] != body["conversation_ref"]
            or body["source"]["revision"] != message.context_revision):
            raise AgentError("input_validation_failed", 422)
        if body["source"]["snapshot_hash"] != "sha256:"+fingerprint(body["input"]):
            raise AgentError("source_revision_conflict", 409)

    async def authorize_result(row, proof):
        original = legacy.get_run(row["actor"], row["id"])
        try:
            await data.validate(row["actor"], original["receipts"], proof)
        except Exception:
            raise AgentError("operation_forbidden", 403) from None

    return router(store=store, authenticate=authenticate, validate=validate,
        profile=lambda: execution_profile(runtime),
        capabilities=lambda: {"service_id": "backlog-assistant", "service_version": "1.0.0",
            "operations": ["backlog.answer"], "profiles":[execution_profile(runtime)["runtime"]], "read_only": True, "real_remote": "not_verified"},
        deadline_seconds=75, queue_limit=20, authorize_result=authorize_result)
