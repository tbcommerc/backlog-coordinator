import json
import signal
import threading
from uuid import UUID, uuid4
from sqlalchemy import create_engine
from dmb_agent_contracts.go import GoModel
from dmb_agent_contracts.serve import stopping_event
from dmb_agent_contracts.operation import operation_scope
from dmb_agent_contracts.model import AgentError, ModelRequest, Message
from .config import Settings
from .extraction import SYSTEM, Output, validate_candidate
from .store import Store, fingerprint, now


def execute(store, row, model):
    try:
        with operation_scope(run_id=row["id"],deadline_at=row["deadline_at"],max_model_attempts=1,
                actor_ref="dmb:"+row["actor"]):
            if row["status"] == "queued":
                row=store.transition(row,"preparing",lease_until=row["deadline_at"])
                if row is None:
                    return
            return _execute(store,row,model)
    except AgentError as error:
        if error.code.startswith(("global_limiter_", "operation_queue_")) or error.code == "actor_queue_full":
            store.defer(row,error.code)
            return "deferred"
        else:
            store.transition(row,"failed",error=error.code,finished_at=now())


def _execute(store, row, model):
    # Intent commits before network IO. An expired lease is never re-dispatched.
    row = store.transition(row, "running", dispatch_ref=str(uuid4()), delivery="unknown")
    if not row:
        return
    try:
        request = ModelRequest(request_id=uuid4(), run_id=UUID(row["id"]), purpose="extraction",
            messages=[Message(role="user", content=json.dumps(row["input"], ensure_ascii=False))],
            system_prompt=SYSTEM, output_schema=Output.model_json_schema(), model_profile="local-go-direct",
            deadline_at=row["deadline_at"], max_output_tokens=12000)
        from dmb_agent_contracts.runtime_records import RuntimeRecords
        from dmb_agent_contracts.operation import current_operation
        context = current_operation()
        context.model_profile_ref = row["profile"].get("remote_profile_ref")
        def authorize_binding():
            context.check()
            current = store.get(row["id"])
            if current["version"] != row["version"] or current["status"] != "running":
                raise AgentError("operation_cancelled",409)
        context.runtime_checkpoint = RuntimeRecords(store.engine, authorize_binding).checkpoint
        result = model.complete(request)
        row = store.transition(row, "validating", delivery="accepted")
        if not row:
            return
        payload = validate_candidate(result.structured, row["input"]["transcript"])
        if now() >= row["deadline_at"]:
            raise AgentError("operation_deadline_exceeded", 504)
        store.transition(row, "completed", result=payload, payload_hash=fingerprint(payload), finished_at=now())
    except AgentError as exc:
        store.transition(row, "failed", error=exc.code, finished_at=now())
    except Exception:
        store.transition(row, "failed", error="invalid_model_result", finished_at=now())


def main():
    settings = Settings()
    settings.validate_runtime()
    from dmb_agent_contracts.limiter import require_runtime_limiter
    require_runtime_limiter()
    engine = create_engine(settings.database_url.get_secret_value(), pool_pre_ping=True)
    from .migrate import validate as validate_schema
    validate_schema(engine)
    store = Store(engine, retention=settings.retention_policy())
    if settings.execution_backend == "opencode":
        from dmb_agent_contracts.runtime_records import validate as validate_runtime_schema
        validate_runtime_schema(engine)
        profile = settings.remote_profile()
        profile.preflight()
        model = profile.model_port()
    else:
        model = GoModel(base_url=settings.model_base_url, api_key=settings.model_api_key.get_secret_value(),
                        model=settings.model_name, protocol=settings.model_protocol)
    stopping = stopping_event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())
    try:
        while not stopping.is_set():
            store.expire()
            if settings.execution_backend == "opencode":
                from dmb_agent_contracts.runtime_records import RuntimeRecords
                RuntimeRecords(engine, lambda: None).recover_abandoned(store, profile, require_runtime_limiter())
            row = store.claim()
            if row:
                if row["profile"].get("backend") == "opencode":
                    if row["profile"] != settings.run_profile():
                        store.transition(row,"failed",error="runtime_profile_changed",finished_at=now())
                        continue
                    frozen = model
                else:
                    if settings.execution_backend != "direct":
                        store.transition(row,"failed",error="runtime_profile_changed",finished_at=now())
                        continue
                    frozen = GoModel(base_url=row["profile"]["base_url"], api_key=settings.model_api_key.get_secret_value(),
                        model=row["profile"]["model"], protocol=row["profile"]["protocol"], client=model.client)
                if execute(store, row, frozen) == "deferred":
                    stopping.wait(1)
            else:
                stopping.wait(1)
    finally:
        if hasattr(model,"client"):
            model.client.close()
        engine.dispose()


if __name__ == "__main__":
    main()
