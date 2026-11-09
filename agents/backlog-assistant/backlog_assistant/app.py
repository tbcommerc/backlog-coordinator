"""Internal Agent API. TLS client certificates terminate in the dedicated ASGI server."""
import asyncio
import os
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, Request, HTTPException, Header, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text, select
from contracts.models import SessionCreate, MessageCreate, SessionPatch, Feedback
from backlog_assistant.security import verify
from backlog_assistant.store import Store, StoreError, runs as run_table
from backlog_assistant.worker import Worker


def create_app(store, data, runtime, secret, *, run_workers=True, fixture_registration=None):
    if len(secret) < 32:
        raise ValueError("gateway_secret_minimum_32_characters")

    @asynccontextmanager
    async def lifespan(app):
        workers = [asyncio.create_task(Worker(store, data, runtime).run()) for _ in range(4)] if run_workers else []
        app.state.workers = workers
        yield
        for worker in workers:
            worker.cancel()
        for worker in workers:
            with suppress(asyncio.CancelledError):
                await worker

    app = FastAPI(title="Backlog Assistant", version="1.0.0", lifespan=lifespan)

    @app.exception_handler(StoreError)
    async def store_error(request, exc):
        if request.url.path.startswith("/internal/agent/v1/"):
            code = {"not_found": "run_not_found", "capacity_exceeded": "queue_full",
                "context_conflict": "source_revision_conflict", "run_active": "source_revision_conflict"}.get(exc.code, exc.code)
            return JSONResponse({"error": {"code": code, "message": code,
                "retryable": False, "details": {}}}, status_code=exc.status)
        return JSONResponse({"detail": exc.code}, status_code=exc.status)

    async def identity(request: Request):
        raw = await request.body()
        if len(raw) > 32000:
            raise HTTPException(413, "request_too_large")
        target = request.url.path + ("?" + request.url.query if request.url.query else "")
        try:
            actor, claims = verify(secret, request.headers.get("X-Gateway-Attestation", ""), request.method,
                target, raw, request.headers.get("Idempotency-Key", ""))
        except ValueError:
            raise HTTPException(401, "invalid_attestation")
        store.consume_nonce(claims)
        return actor.owner

    from backlog_assistant.runs import build_router
    from dmb_agent_contracts.run_api import install_error_handlers
    from dmb_agent_contracts.body_limit import BodyLimit
    app.include_router(build_router(store, data, identity, runtime))
    install_error_handlers(app)
    app.add_middleware(BodyLimit, limit=32000)
    from dmb_agent_contracts.run_metrics import install as install_run_metrics
    from backlog_assistant.runs import FacadeStore
    async def metrics_identity(owner=Depends(identity)):
        return "dmb", owner
    install_run_metrics(app, FacadeStore(store), metrics_identity)

    def public_session(row):
        return {"id": row["id"], "title": "Разговор о бэклоге", "context_revision": row["revision"],
                "archived": row["archived"], "updated_at": row["updated"]}

    async def public_run(row, proof):
        response = {"id": row["id"], "message_id": row["id"], "session_id": row["session_id"],
            "status": row["status"], "stage": row["stage"], "error_code": row.get("error_code"), "answer": None}
        # Revalidate on EVERY history read, even when execution grant is expired.
        if row.get("answer"):
            try:
                await data.validate(row["owner"], row["receipts"], proof)
                response["answer"] = row["answer"]
                response["text"] = row["input"]["text"]
            except Exception:
                response["error_code"] = "sources_unavailable"
        return response

    def require_key(value):
        if not value or not value.strip() or len(value) > 128:
            raise HTTPException(422, "idempotency_key_required")
        return value

    @app.get("/health/live")
    async def live():
        return {"status":"ok"}

    @app.get("/health/ready")
    @app.get("/health")
    async def health(request:Request):
        if any(worker.done() for worker in getattr(app.state, "workers", [])):
            raise HTTPException(503, "worker_unavailable")
        with store.engine.connect() as connection:
            connection.execute(select(run_table.c.id).limit(1))
        return {"status": "ready" if request.url.path.endswith("/ready") else "ok", "contract_version": "1.0"}

    @app.get("/v1/capabilities")
    async def capabilities(owner=Depends(identity)):
        return {"contract_version": "1.0", "read_only": True, "runtime": type(runtime).__name__}

    if fixture_registration is not None:
        @app.post("/fixtures/executions", tags=["Synthetic development only"])
        async def fixture_execution(owner=Depends(identity)):
            return {"execution_ref": fixture_registration(owner)}

    @app.post("/v1/sessions", status_code=201)
    async def create(body: SessionCreate, owner=Depends(identity), idempotency_key: str = Header(default="")):
        return public_session(store.create(owner, require_key(idempotency_key), body.model_dump(mode="json")))

    @app.get("/v1/sessions")
    async def listing(owner=Depends(identity), cursor: int = Query(default=0, ge=0)):
        rows = store.list_sessions(owner, cursor)
        return {"items": [public_session(r) for r in rows], "next_cursor": cursor+50 if len(rows) == 50 else None}

    @app.get("/v1/sessions/{sid}")
    async def session(sid: str, owner=Depends(identity), x_read_proof: str = Header(default="")):
        row = store.session(owner, sid)
        response = public_session(row)
        response["runs"] = [await public_run(r, x_read_proof) for r in row["runs"]]
        # Historical user quotes may contain inaccessible data; do not echo them.
        return response

    @app.patch("/v1/sessions/{sid}")
    async def patch(sid: str, body: SessionPatch, owner=Depends(identity)):
        return public_session(store.patch(owner, sid, body.model_dump(mode="json")))

    @app.delete("/v1/sessions/{sid}")
    async def remove(sid: str, owner=Depends(identity)):
        store.remove(owner, sid)
        return {"deleted": True}

    @app.post("/v1/sessions/{sid}/messages", status_code=202)
    async def message(sid: str, body: MessageCreate, owner=Depends(identity), idempotency_key: str = Header(default="")):
        row = store.enqueue(owner, sid, require_key(idempotency_key), body.model_dump(mode="json"))
        return {"run_id": row["id"], "status": row["status"]}

    @app.get("/v1/runs/{rid}")
    async def run(rid: str, owner=Depends(identity), x_read_proof: str = Header(default="")):
        return await public_run(store.get_run(owner, rid), x_read_proof)

    @app.get("/v1/internal/runs/{rid}")
    async def run_manifest(rid: str, owner=Depends(identity)):
        row = store.get_run(owner, rid)
        return {"receipt_refs": row["receipts"], "execution_refs": [row["execution_ref"]]}

    @app.get("/v1/internal/sessions/{sid}")
    async def session_manifest(sid: str, owner=Depends(identity)):
        row = store.session(owner, sid)
        return {"receipt_refs": [ref for r in row["runs"] for ref in r["receipts"]],
                "execution_refs": [r["execution_ref"] for r in row["runs"]]}

    def result_run(owner, result_id):
        from sqlalchemy import select
        from backlog_assistant.store import runs
        with store.engine.connect() as connection:
            for row in connection.execute(select(runs).where(runs.c.owner == owner)).mappings():
                if result_id in row["receipts"]:
                    return dict(row)
        raise StoreError("not_found", 404)

    @app.get("/v1/internal/results/{result_id}")
    async def result_manifest(result_id: str, owner=Depends(identity)):
        row = result_run(owner, result_id)
        return {"receipt_refs": row["receipts"], "execution_refs": [row["execution_ref"]]}

    @app.get("/v1/results/{result_id}")
    async def result(result_id: str, owner=Depends(identity), cursor: int = Query(0, ge=0, le=1000000),
                     x_read_proof: str = Header(default="")):
        row = result_run(owner, result_id)
        try:
            await data.validate(owner, row["receipts"], x_read_proof)
            return await data.result(owner, result_id, cursor, x_read_proof)
        except Exception:
            raise HTTPException(404, "sources_unavailable")

    @app.post("/v1/runs/{rid}/cancel")
    async def cancel(rid: str, owner=Depends(identity)):
        store.cancel(owner, rid)
        return {"cancel_requested": True}

    @app.post("/v1/messages/{rid}/feedback")
    async def rate(rid: str, body: Feedback, owner=Depends(identity)):
        store.rate(owner, rid, body.model_dump())
        return {"saved": True}

    return app
