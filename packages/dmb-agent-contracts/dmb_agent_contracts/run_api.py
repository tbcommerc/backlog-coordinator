from uuid import UUID
"""Technical run facade. Authentication and product validation stay service-owned."""
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, update

from .model import AgentError
from .run_store import TERMINAL, events, now, runs

PREFIX = "/internal/agent/v1"


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(min_length=1, max_length=64)
    ref: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=0)
    snapshot_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class CreateRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: Literal["1.0"]
    operation: str = Field(min_length=1, max_length=80)
    conversation_ref: str | None = Field(default=None, max_length=128)
    retry_of: UUID | None = None
    retry_of_key: str | None = Field(default=None,min_length=1,max_length=128)
    source: Source
    input: dict


def snapshot(row):
    return {key: row.get(key) for key in ("id", "status", "version", "created_at",
        "deadline_at", "finished_at", "error", "delivery", "retry_of")}


def router(*, store, authenticate, validate, profile, capabilities,
           deadline_seconds=600, queue_limit=64, authorize_result=None):
    """authenticate returns trusted (caller, actor), never user-submitted roles."""
    api = APIRouter(prefix=PREFIX)

    @api.get("/capabilities")
    def caps(actor=Depends(authenticate)):
        from .limiter import limiter_metadata
        return {**capabilities(), "contract_version": "1.0", "limiter": limiter_metadata(),
            "run_features":["explicit_retry_links","retry_by_key"],
            "idempotency_window_seconds":store.retention["idempotency_days"]*86400,
            "retention":dict(store.retention)}

    def validated(body):
        value = body.model_dump(mode="json")
        try:
            validate(value)  # Must reject unsupported operations and unsafe product input.
        except ValidationError:
            raise AgentError("input_validation_failed", 422) from None
        return value

    def accepted(row, replayed):
        url = PREFIX+"/runs/"+row["id"]
        return {"run_id": row["id"], "status": row["status"], "created_at": row["created_at"],
            "status_url": url, "events_url": url+"/events", "replayed": replayed}

    @api.post("/runs", status_code=202)
    def create(body: CreateRun, response: Response,
               idempotency_key: str = Header(min_length=1, max_length=128),
               x_agent_deadline: datetime | None = Header(default=None), actor=Depends(authenticate)):
        if x_agent_deadline is not None and x_agent_deadline.tzinfo is None:
            raise AgentError("invalid_request", 400)
        row, replayed = store.create(*actor[:2], idempotency_key, validated(body), profile(),
            deadline_seconds, queue_limit, deadline_at=x_agent_deadline, trusted_context=actor[2] if len(actor)>2 else {})
        response.headers["Location"] = PREFIX+"/runs/"+row["id"]
        if replayed:
            response.status_code = 200
        return accepted(row, replayed)

    @api.post("/runs/cancellations")
    def cancel_unknown(body: CreateRun, idempotency_key: str = Header(min_length=1, max_length=128),
                       x_agent_deadline: datetime | None = Header(default=None), actor=Depends(authenticate)):
        row, replayed = store.cancel_key(*actor[:2], idempotency_key, validated(body), profile(),
            deadline_seconds, deadline_at=x_agent_deadline, trusted_context=actor[2] if len(actor)>2 else {})
        return accepted(row, replayed)

    @api.get("/runs/{run_id}")
    def status(run_id: str, actor=Depends(authenticate)):
        return snapshot(store.get(run_id, *actor[:2]))

    @api.get("/runs/{run_id}/result")
    async def result(run_id: str, actor=Depends(authenticate), x_read_proof: str = Header(default="")):
        row = store.get(run_id, *actor[:2])
        if row["result_expired"]:
            raise AgentError("result_expired", 410)
        if row["status"] != "completed":
            raise AgentError("run_not_ready", 409)
        if authorize_result is not None:
            await authorize_result(row, x_read_proof)
        return {"run_id": run_id, "payload_hash": row["payload_hash"], "result": row["result"]}

    @api.post("/runs/{run_id}/cancel")
    def cancel(run_id: str, actor=Depends(authenticate)):
        for _ in range(3):
            row = store.get(run_id, *actor[:2])
            if row["status"] == "cancelled":
                return snapshot(row)
            if row["status"] in TERMINAL:
                raise AgentError("already_terminal", 409)
            changed = store.transition(row, "cancelled", cancel_requested_at=now(), finished_at=now())
            if changed:
                return snapshot(changed)
        raise AgentError("source_revision_conflict", 409)

    @api.post("/runs/{run_id}/acknowledgements")
    def acknowledge(run_id: str, actor=Depends(authenticate)):
        row = store.get(run_id, *actor[:2])
        if row["status"] not in TERMINAL:
            raise AgentError("run_not_ready", 409)
        with store.engine.begin() as connection:
            connection.execute(update(runs).where(runs.c.id == run_id,
                runs.c.ack_at.is_(None)).values(ack_at=now()))
        return {"acknowledged": True}

    @api.get("/runs/{run_id}/events")
    def stream(run_id: str, last_event_id: str = Header(default="0"), actor=Depends(authenticate)):
        row = store.get(run_id, *actor[:2])
        try:
            cursor = int(last_event_id)
            if cursor < 0 or cursor > row["version"]:
                raise ValueError()
        except ValueError:
            raise AgentError("event_cursor_expired", 410)
        with store.engine.connect() as connection:
            entries = connection.execute(select(events).where(events.c.run_id == run_id,
                events.c.sequence > cursor).order_by(events.c.sequence)).mappings().all()
        if cursor < row["version"] and (not entries or entries[0]["sequence"] > cursor+1):
            raise AgentError("event_cursor_expired", 410)
        def generate():
            for event in entries:
                payload = {"run_id": run_id, "sequence": event["sequence"], "type": event["type"],
                    "occurred_at": event["occurred_at"].isoformat(), "data": {}}
                yield f'id: {event["sequence"]}\nevent: {event["type"]}\ndata: {json.dumps(payload)}\n\n'
        return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})

    return api


def install_error_handlers(app):
    from fastapi.exceptions import RequestValidationError
    from fastapi.exception_handlers import request_validation_exception_handler
    from fastapi.responses import JSONResponse

    @app.exception_handler(AgentError)
    async def agent_error(request, error):
        return JSONResponse(status_code=error.status, content={"error": {"code": error.code,
            "message": error.code, "retryable": False, "details": {}}})

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, error):
        if not request.url.path.startswith(PREFIX+"/"):
            return await request_validation_exception_handler(request, error)
        malformed = any(item.get("type") == "json_invalid" or item.get("loc", [None])[0] == "header"
            for item in error.errors())
        code = "invalid_request" if malformed else "input_validation_failed"
        return JSONResponse(status_code=400 if malformed else 422, content={"error": {
            "code": code, "message": code, "retryable": False, "details": {}}})
