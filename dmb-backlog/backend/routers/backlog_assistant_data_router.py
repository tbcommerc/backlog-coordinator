"""Private router. Mounted ONLY by the mandatory-mTLS data-server entrypoint."""
import base64
import hashlib
import hmac
import json
import time
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete
from config import settings
from database import engine
from services.backlog_assistant_integration import ledger


def service_auth(authorization: str = Header(default="")):
    if len(settings.BACKLOG_ASSISTANT_SERVICE_TOKEN) < 32 or not hmac.compare_digest(
        authorization, "Bearer "+settings.BACKLOG_ASSISTANT_SERVICE_TOKEN):
        raise HTTPException(401, "service_auth_required")


router = APIRouter(dependencies=[Depends(service_auth)])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Activation(Strict):
    lease: str = Field(min_length=1, max_length=128)


class ToolCall(Strict):
    arguments: dict
    tool_call_id: str = Field(min_length=1, max_length=128)


class Verification(Strict):
    execution_ref: str
    candidate: dict
    receipt_refs: list[str] = Field(max_length=100)


class ReadSources(Strict):
    owner: str
    receipt_refs: list[str] = Field(max_length=1000)


@router.post("/executions/{execution}/activate")
def activate(execution: str, body: Activation):
    return ledger.activate(execution, body.lease)


@router.post("/executions/{execution}/check")
def check(execution: str, x_execution_grant: str = Header(default="")):
    return ledger.check(execution, x_execution_grant)


@router.get("/executions/{execution}/tools")
def catalog(execution: str, x_execution_grant: str = Header(default="")):
    return ledger.catalog(execution, x_execution_grant)


@router.post("/executions/{execution}/tools/{name}")
def tool(execution: str, name: str, body: ToolCall, x_execution_grant: str = Header(default="")):
    return ledger.call_tool(execution, x_execution_grant, name, body.arguments, body.tool_call_id)


@router.post("/answers/verify")
def verify(body: Verification, x_execution_grant: str = Header(default="")):
    return ledger.verify_answer(body.execution_ref, x_execution_grant, body.candidate, body.receipt_refs)


@router.post("/sources/validate")
def validate(body: ReadSources, x_read_proof: str = Header(default="")):
    subject, proof = parse_proof(body, x_read_proof)
    ledger.validate_receipts(subject, body.receipt_refs, proof)
    return {"valid": True}


def parse_proof(body, x_read_proof):
    try:
        encoded, signature = x_read_proof.split(".")
        expected = hmac.new(settings.BACKLOG_ASSISTANT_GATEWAY_SECRET.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        proof = json.loads(base64.urlsafe_b64decode(encoded))
        issuer, subject = json.loads(body.owner)
        if (issuer != "dmb" or subject != proof["subject"] or proof["expires"] <= time.time()
                or proof["expires"] > time.time()+60 or set(body.receipt_refs) - set(proof["receipt_refs"])):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise HTTPException(403, "read_proof_required")
    return subject, proof


class ReadResult(ReadSources):
    cursor: int = Field(default=0, ge=0, le=1000000)


@router.post("/results/{result_id}")
def result(result_id: str, body: ReadResult, x_read_proof: str = Header(default="")):
    subject, proof = parse_proof(body, x_read_proof)
    if body.receipt_refs != [result_id]:
        raise HTTPException(422, "result_ref_mismatch")
    rows = ledger.validate_receipts(subject, body.receipt_refs, proof)
    payload = rows[0]["payload"]
    from copy import deepcopy
    arguments = deepcopy(payload["arguments"])
    if "query" in arguments:
        arguments["query"]["cursor"] = body.cursor
    elif body.cursor:
        raise HTTPException(422, "result_not_pageable")
    with ledger.read_view() as db:
        user = ledger.actor(db, proof)
        data, _, limitations = ledger.execute(db, user, payload["scope"], payload["tool_name"], arguments, payload["context"])
    from datetime import datetime, timezone
    return {"data": dict(data, result_ref=result_id), "limitations": limitations, "refreshed": True,
        "observed_at": datetime.now(timezone.utc).isoformat()}


@router.post("/executions/{execution}/revoke")
def revoke(execution: str):
    return ledger.revoke(execution)


@router.post("/receipts/purge")
def purge(body: ReadSources):
    try:
        issuer, subject = json.loads(body.owner)
        if issuer != "dmb":
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, "invalid_owner")
    with engine.begin() as c:
        c.execute(delete(ledger.records).where(ledger.records.c.kind == "receipt", ledger.records.c.subject == subject,
            ledger.records.c.id.in_(body.receipt_refs)))
    return {"purged": True}


class ConversationContext(Strict):
    receipt_refs: list[str] = Field(max_length=18)


@router.post("/executions/{execution}/conversation")
def conversation(execution: str, body: ConversationContext, x_execution_grant: str = Header(default="")):
    return ledger.conversation_context(execution, x_execution_grant, body.receipt_refs)
