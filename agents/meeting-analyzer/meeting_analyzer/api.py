from uuid import UUID
import hmac
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field
from sqlalchemy import create_engine, select, text, update, func

from dmb_agent_contracts.model import AgentError
from .config import Settings
from .body_limit import BodyLimit
from .extraction import ExtractionInput, Strict
from .store import Store, events, runs, now, TERMINAL

PREFIX = "/internal/agent/v1"


class Source(Strict):
    kind: Literal["meeting_capture"]
    ref: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=0)
    snapshot_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class CreateRun(Strict):
    contract_version: Literal["1.0"]
    operation: Literal["meeting.extract"]
    conversation_ref: None = None
    retry_of: UUID | None = None
    retry_of_key: str | None = Field(default=None,min_length=1,max_length=128)
    source: Source
    input: ExtractionInput


def snapshot(row):
    return {key: row.get(key) for key in ("id", "status", "version", "created_at", "deadline_at", "finished_at", "error", "delivery", "retry_of")}


def create_app(settings=None, engine=None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        if engine is None:
            settings.validate_runtime()
            from dmb_agent_contracts.limiter import require_runtime_limiter
            require_runtime_limiter()
            app.state.engine = create_engine(settings.database_url.get_secret_value(), pool_pre_ping=True)
            from .migrate import validate as validate_schema
            validate_schema(app.state.engine)
            if settings.execution_backend == "opencode":
                from dmb_agent_contracts.runtime_records import validate as validate_runtime_schema
                validate_runtime_schema(app.state.engine)
                settings.remote_profile().preflight()
        else:
            app.state.engine = engine
        app.state.store = Store(app.state.engine, retention=settings.retention_policy())
        yield
        if engine is None:
            app.state.engine.dispose()

    app = FastAPI(title="Meeting Analyzer", version="1.0.0", lifespan=lifespan)
    app.add_middleware(BodyLimit,limit=settings.request_body_limit_bytes)

    @app.exception_handler(AgentError)
    async def agent_error(request, exc):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code,
            "message": exc.code, "retryable": False, "details": {}}})

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        malformed=any(error.get("type")=="json_invalid" or (error.get("loc") and error["loc"][0]=="header") for error in exc.errors())
        code="invalid_request" if malformed else "input_validation_failed"
        return JSONResponse(status_code=400 if malformed else 422,content={"error":{"code":code,
            "message":code,"retryable":False,"details":{}}})

    def auth(x_agent_secret: str = Header(default=""), x_agent_caller: str = Header(default=""),
             x_actor_ref: str = Header(default="")):
        expected = settings.service_secret.get_secret_value()
        if not expected or not hmac.compare_digest(expected, x_agent_secret):
            raise AgentError("service_auth_required", 401)
        if x_agent_caller != "dmb" or not x_actor_ref or len(x_actor_ref) > 128:
            raise AgentError("operation_forbidden", 403)
        return x_agent_caller, x_actor_ref

    def store(request: Request):
        return request.app.state.store

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready(db=Depends(store)):
        try:
            with db.engine.connect() as conn:
                conn.execute(select(runs.c.id).limit(1))
            return {"status": "ready"}
        except Exception:
            return JSONResponse(status_code=503, content={"status": "unavailable", "reason": "storage_not_ready"})

    @app.get(PREFIX + "/capabilities")
    def capabilities(actor=Depends(auth)):
        from dmb_agent_contracts.limiter import limiter_metadata
        return {"service_id": "meeting-analyzer", "service_version": "1.0.0", "contract_version": "1.0",
                "limiter":limiter_metadata(),
                "operations": ["meeting.extract"], "profiles": ["prepared-remote" if settings.execution_backend=="opencode" else "local-go-direct"],
                "run_features":["explicit_retry_links","retry_by_key"],
                "real_remote": "not_verified", "idempotency_window_seconds": settings.idempotency_retention_days * 86400,
                "retention": settings.retention_policy(),
                "max_request_bytes": settings.request_body_limit_bytes,
                "events": "status-only"}

    @app.get("/metrics", include_in_schema=False)
    def metrics(actor=Depends(auth), db=Depends(store)):
        with db.engine.connect() as connection:
            counts = dict(connection.execute(select(runs.c.status, func.count()).group_by(runs.c.status)).all())
        lines = ["# HELP agent_runs Durable operations by current state.", "# TYPE agent_runs gauge"]
        for state in ("queued", "preparing", "running", "validating", "completed", "failed", "cancelled", "interrupted"):
            lines.append('agent_runs{status="'+state+'"} '+str(counts.get(state, 0)))
        return Response(content="\n".join(lines)+"\n", media_type="text/plain; version=0.0.4")

    @app.post(PREFIX + "/runs", status_code=202)
    def create(body: CreateRun, response: Response, idempotency_key: str = Header(min_length=1, max_length=128),
               actor=Depends(auth), db=Depends(store), x_agent_deadline: datetime | None = Header(default=None)):
        import hashlib
        if x_agent_deadline is not None and x_agent_deadline.tzinfo is None:
            raise AgentError("invalid_request",400)
        if body.source.snapshot_hash != "sha256:" + hashlib.sha256(body.input.transcript.encode()).hexdigest():
            raise AgentError("source_revision_conflict", 409)
        row, replayed = db.create(*actor, idempotency_key, body.model_dump(mode="json"),
            settings.run_profile(),
            settings.deadline_seconds, settings.queue_limit, deadline_at=x_agent_deadline)
        url = PREFIX + "/runs/" + row["id"]
        response.headers["Location"] = url
        if replayed:
            response.status_code = 200
        return {"run_id": row["id"], "status": row["status"], "created_at": row["created_at"],
                "status_url": url, "events_url": url + "/events", "replayed": replayed}

    @app.post(PREFIX + "/runs/cancellations")
    def cancel_unknown(body: CreateRun, idempotency_key: str = Header(min_length=1, max_length=128),
                       actor=Depends(auth), db=Depends(store), x_agent_deadline: datetime | None = Header(default=None)):
        import hashlib
        if x_agent_deadline is not None and x_agent_deadline.tzinfo is None:
            raise AgentError("invalid_request", 400)
        if body.source.snapshot_hash != "sha256:" + hashlib.sha256(body.input.transcript.encode()).hexdigest():
            raise AgentError("source_revision_conflict", 409)
        row, replayed = db.cancel_key(*actor, idempotency_key, body.model_dump(mode="json"),
            settings.run_profile(),
            settings.deadline_seconds, deadline_at=x_agent_deadline)
        url = PREFIX + "/runs/" + row["id"]
        return {"run_id": row["id"], "status": row["status"], "created_at": row["created_at"],
                "status_url": url, "events_url": url + "/events", "replayed": replayed}

    @app.get(PREFIX + "/runs/{run_id}")
    def status(run_id: str, actor=Depends(auth), db=Depends(store)):
        return snapshot(db.get(run_id, *actor))

    @app.get(PREFIX + "/runs/{run_id}/result")
    def result(run_id: str, actor=Depends(auth), db=Depends(store)):
        row = db.get(run_id, *actor)
        if row["result_expired"]:
            raise AgentError("result_expired", 410)
        if row["status"] != "completed":
            raise AgentError("run_not_ready", 409)
        return {"run_id": run_id, "payload_hash": row["payload_hash"], "result": row["result"],
                "quality": "full" if row["result"]["items"] else "no_results"}

    @app.post(PREFIX + "/runs/{run_id}/cancel")
    def cancel(run_id: str, actor=Depends(auth), db=Depends(store)):
        for _ in range(3):
            row = db.get(run_id, *actor)
            if row["status"] == "cancelled":
                return snapshot(row)
            if row["status"] in TERMINAL:
                raise AgentError("already_terminal", 409)
            changed = db.transition(row, "cancelled", cancel_requested_at=now(), finished_at=now())
            if changed:
                return snapshot(changed)
        raise AgentError("source_revision_conflict", 409)

    @app.post(PREFIX + "/runs/{run_id}/acknowledgements")
    def acknowledge(run_id: str, actor=Depends(auth), db=Depends(store)):
        row = db.get(run_id, *actor)
        if row["status"] not in TERMINAL:
            raise AgentError("run_not_ready", 409)
        with db.engine.begin() as conn:
            conn.execute(update(runs).where(runs.c.id == run_id, runs.c.ack_at.is_(None)).values(ack_at=now()))
        return {"acknowledged": True}

    @app.get(PREFIX + "/runs/{run_id}/events")
    def stream(run_id: str, last_event_id: str = Header(default="0"), actor=Depends(auth), db=Depends(store)):
        row = db.get(run_id, *actor)
        try:
            cursor = int(last_event_id)
            if cursor < 0 or cursor > row["version"]:
                raise ValueError()
        except ValueError:
            raise AgentError("event_cursor_expired", 410)
        with db.engine.connect() as conn:
            entries = conn.execute(select(events).where(events.c.run_id == run_id, events.c.sequence > cursor)
                                   .order_by(events.c.sequence)).mappings().all()
        if cursor < row["version"] and (not entries or entries[0]["sequence"] > cursor+1):
            raise AgentError("event_cursor_expired", 410)
        def generate():
            for event in entries:
                payload = {"run_id": run_id, "sequence": event["sequence"], "type": event["type"],
                           "occurred_at": event["occurred_at"].isoformat(), "data": {}}
                yield f'id: {event["sequence"]}\nevent: {event["type"]}\ndata: {json.dumps(payload)}\n\n'
        return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})

    return app


app = create_app()
