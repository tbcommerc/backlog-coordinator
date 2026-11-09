"""Versioned tool boundary. Only the trusted coordinator can issue grants.

Opaque per-run tokens are stored as digests. Grant/receipt/task locks and the
factor write share a transaction; no model IO happens inside that transaction.
"""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import JSON, Column, DateTime, ForeignKey, String, Table, select, func

from .core.models import Base, Task
from .core.references import get_reference
from .core.service import REASON_MANUAL, recompute_factor_priority
from .strategy.rubric import RubricError, score_dependencies, score_strategy
from .strategy.store import assessment_summary, save_dependencies, save_strategy

grants = Table("agent_tool_grants", Base.metadata,
    Column("id", String(36), primary_key=True), Column("token_hash", String(64), nullable=False, unique=True),
    Column("run_id", String(36), nullable=False, index=True), Column("subject", String(128), nullable=False),
    Column("issuer", String(64), nullable=False), Column("audience", String(64), nullable=False),
    Column("role", String(32), nullable=False), Column("task_key", String(64), nullable=False),
    Column("source_hash", String(64), nullable=False), Column("rubric_hash", String(64), nullable=False),
    Column("allowed_evidence", JSON, nullable=False), Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)))
receipts = Table("agent_tool_receipts", Base.metadata,
    Column("grant_id", String(36), ForeignKey("agent_tool_grants.id"), primary_key=True),
    Column("call_id", String(128), primary_key=True), Column("request_hash", String(64), nullable=False),
    Column("response", JSON, nullable=False), Column("created_at", DateTime(timezone=True), nullable=False))

OPERATIONS = {
    "strategy-analyst": {"rubric-read", "assessments-read", "strategy-assess"},
    "dependency-analyst": {"rubric-read", "assessments-read", "dependency-assess"},
}
SOURCE_FIELDS = ("task_key", "team", "title", "task_type", "channel", "customer", "customer_division",
                 "project", "status", "assignee", "deadline_raw", "involved_teams_raw", "comment", "raw",
                 "effort_man_days", "value_manual_mln", "created_date", "deadline",
                 "is_regulatory", "is_rnd", "is_blocking")


def fingerprint(value):
    from fastapi.encoders import jsonable_encoder
    return hashlib.sha256(json.dumps(jsonable_encoder(value), sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source_hash(task):
    return fingerprint({field: getattr(task, field) for field in SOURCE_FIELDS})


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


ShortText = Annotated[str, Field(min_length=1, max_length=255)]


class GrantRequest(Strict):
    run_id: UUID
    subject: str = Field(min_length=1, max_length=128)
    role: Literal["strategy-analyst", "dependency-analyst"]
    task_key: str = Field(min_length=1, max_length=64)
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    allowed_evidence: list[ShortText] = Field(default_factory=list, max_length=60)


class Dependency(Strict):
    team: str = Field(min_length=1, max_length=128)
    type: Literal["blocking", "coordination", "informational"]
    reason: str = Field(default="", max_length=2000)


class ToolCall(Strict):
    run_id: UUID
    call_id: str = Field(min_length=1, max_length=128)
    operation: Literal["rubric-read", "assessments-read", "strategy-assess", "dependency-assess"]
    task_key: str | None = Field(default=None, min_length=1, max_length=64)
    factor: Literal["F5", "F6"] | None = None
    answers: dict[ShortText, ShortText] | None = Field(default=None, max_length=60)
    teams: list[Dependency] | None = Field(default=None, max_length=60)
    rationale: str = Field(default="", max_length=5000)
    evidence: list[ShortText] = Field(default_factory=list, max_length=60)


def parent_run(session, run_id, *, subject=None, task_key=None):
    from dmb_agent_contracts.run_store import runs
    row = session.execute(select(runs).where(runs.c.id == str(run_id)).with_for_update()).mappings().first()
    if row is None or row["caller"] != "dmb" or row["operation"] not in {"value.estimate","priority.estimate"}:
        raise HTTPException(403, "tool_parent_forbidden")
    if row["status"] != "running" or aware(row["deadline_at"]) <= now():
        raise HTTPException(409, "tool_parent_inactive")
    if (subject is not None and row["actor"] != subject or
        task_key is not None and (row["source"].get("kind") != "work_item" or row["source"].get("ref") != task_key)):
        raise HTTPException(403, "tool_parent_forbidden")
    return row


def issue(session, request):
    parent = parent_run(session, request.run_id, subject=request.subject, task_key=request.task_key)
    task = session.scalar(select(Task).where(Task.task_key == request.task_key).with_for_update())
    if task is None:
        raise HTTPException(404, "task_not_found")
    if source_hash(task) != request.source_hash:
        raise HTTPException(409, "source_revision_conflict")
    token = secrets.token_urlsafe(32)
    expires = min(now()+timedelta(seconds=180), aware(parent["deadline_at"]))
    grant_id = str(uuid4())
    session.execute(grants.insert().values(id=grant_id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        run_id=str(request.run_id), subject=request.subject, issuer="dmb-coordinator",
        audience="value-priority-assessor.tools.v1", role=request.role, task_key=request.task_key,
        source_hash=request.source_hash, rubric_hash=fingerprint(get_reference(session, "strategy_rubric")),
        allowed_evidence=request.allowed_evidence, expires_at=expires))
    return {"grant_id": grant_id, "token": token, "expires_at": expires, "contract_version": "1.0",
            "operations": sorted(OPERATIONS[request.role])}


def execute(session, token, request):
    if not token or len(token) > 128:
        raise HTTPException(401, "tool_auth_required")
    grant = session.execute(select(grants).where(grants.c.token_hash == hashlib.sha256(token.encode()).hexdigest())
                            .with_for_update()).mappings().first()
    if grant is None or grant["revoked_at"] or aware(grant["expires_at"]) <= now():
        raise HTTPException(401, "tool_grant_expired_or_revoked")
    if (grant["audience"] != "value-priority-assessor.tools.v1" or grant["issuer"] != "dmb-coordinator"
            or grant["run_id"] != str(request.run_id) or request.operation not in OPERATIONS.get(grant["role"], set())):
        raise HTTPException(403, "tool_scope_forbidden")
    expected_factor = "F5" if grant["role"] == "strategy-analyst" else "F6"
    if (request.task_key is not None and request.task_key != grant["task_key"]) or (request.factor is not None and request.factor != expected_factor):
        raise HTTPException(403, "tool_scope_forbidden")
    if not set(request.evidence) <= set(grant["allowed_evidence"]):
        raise HTTPException(403, "evidence_scope_forbidden")
    parent_run(session, request.run_id, subject=grant["subject"], task_key=grant["task_key"])
    task = session.scalar(select(Task).where(Task.task_key == grant["task_key"]).with_for_update())
    if task is None:
        raise HTTPException(404, "task_not_found")
    rubric = get_reference(session, "strategy_rubric")
    # Re-check current source and methodology even for receipt reads.
    if source_hash(task) != grant["source_hash"] or fingerprint(rubric) != grant["rubric_hash"]:
        raise HTTPException(409, "source_revision_conflict")
    digest = fingerprint(request.model_dump(mode="json"))
    receipt = session.execute(select(receipts).where(receipts.c.grant_id == grant["id"],
        receipts.c.call_id == request.call_id)).mappings().first()
    if receipt:
        if receipt["request_hash"] != digest:
            raise HTTPException(409, "idempotency_conflict")
        return receipt["response"]
    if session.scalar(select(func.count()).select_from(receipts).where(receipts.c.grant_id == grant["id"])) >= 12:
        raise HTTPException(429, "tool_budget_exceeded")
    if request.operation in {"rubric-read", "assessments-read"}:
        if request.answers is not None or request.teams is not None or request.rationale or request.evidence:
            raise HTTPException(422, "unexpected_tool_arguments")
        factor = "strategy_fit" if grant["role"] == "strategy-analyst" else "dependencies"
        response = {"rubric": rubric[factor]} if request.operation == "rubric-read" else assessment_summary(session, task)
    else:
        if not request.rationale:
            raise HTTPException(422, "rationale_required")
        try:
            if request.operation == "strategy-assess":
                if request.answers is None or request.teams is not None:
                    raise HTTPException(422, "invalid_strategy_arguments")
                assessment = score_strategy(request.answers, rubric, request.rationale, request.evidence)
            else:
                if request.teams is None or request.answers is not None:
                    raise HTTPException(422, "invalid_dependency_arguments")
                assessment = score_dependencies([t.model_dump() for t in request.teams], rubric,
                                                request.rationale, request.evidence)
        except RubricError:
            raise HTTPException(422, "invalid_factor_assessment") from None
        # A tool produces a staged candidate, never an active product write.
        # The parent worker promotes it in its final publication transaction.
        response = {"assessment": assessment.as_dict(), "status": "staged"}
    if aware(grant["expires_at"]) <= now():
        raise HTTPException(401, "tool_grant_expired_or_revoked")
    # Datetimes in assessment summaries are normalized before durable receipt storage.
    from fastapi.encoders import jsonable_encoder
    response = jsonable_encoder(response)
    session.execute(receipts.insert().values(grant_id=grant["id"], call_id=request.call_id,
        request_hash=digest, response=response, created_at=now()))
    return response



def promote_staged(session, run_id):
    """Called only inside the parent run's final product/CAS transaction.

    Receipt locks, current task/rubric validation, active factor writes and the
    parent's final CAS must share this Session/connection. No network IO here.
    """
    parent = parent_run(session, run_id)
    candidates = session.execute(select(grants, receipts.c.call_id, receipts.c.response, receipts.c.created_at)
        .join(receipts, receipts.c.grant_id == grants.c.id).where(grants.c.run_id == str(run_id))
        .order_by(receipts.c.created_at, receipts.c.call_id).with_for_update()).mappings().all()
    latest = {}
    for item in candidates:
        if item["response"].get("status") == "staged":
            latest[(item["task_key"], item["role"])] = item
    promoted = []
    for item in latest.values():
        if item["subject"] != parent["actor"] or item["task_key"] != parent["source"].get("ref"):
            raise HTTPException(403, "tool_parent_forbidden")
        if item["revoked_at"] or aware(item["expires_at"]) <= now():
            raise HTTPException(409, "tool_candidate_expired_or_revoked")
        task = session.scalar(select(Task).where(Task.task_key == item["task_key"]).with_for_update())
        rubric = get_reference(session, "strategy_rubric")
        if task is None or source_hash(task) != item["source_hash"] or fingerprint(rubric) != item["rubric_hash"]:
            raise HTTPException(409, "source_revision_conflict")
        candidate = item["response"]["assessment"]
        try:
            if item["role"] == "strategy-analyst":
                assessment = score_strategy(candidate["answers"], rubric, candidate["rationale"], candidate["evidence"])
                save_strategy(session, task, assessment, provider="remote_tool", actor=item["role"])
            else:
                assessment = score_dependencies(candidate["teams"], rubric, candidate["rationale"], candidate["evidence"])
                save_dependencies(session, task, assessment, provider="remote_tool", actor=item["role"])
        except (RubricError, KeyError, TypeError):
            raise HTTPException(422, "invalid_factor_assessment") from None
        if fingerprint(assessment.as_dict()) != fingerprint(candidate):
            raise HTTPException(409, "source_revision_conflict")
        session.flush()
        recompute_factor_priority(session, task, reason=REASON_MANUAL)
        promoted.append({"grant_id":item["id"], "call_id":item["call_id"], "factor":item["role"]})
    return promoted

def create_router(get_db, require_service):
    router = APIRouter(prefix="/internal/tools/v1", tags=["Scoped tools"])

    @router.get("/snapshots/{task_key}")
    def snapshot_identity(task_key: str, session=Depends(get_db), caller=Depends(require_service)):
        if not 1 <= len(task_key) <= 64:
            raise HTTPException(422, "invalid_task_key")
        task = session.scalar(select(Task).where(Task.task_key == task_key))
        if task is None:
            raise HTTPException(404, "task_not_found")
        return {"task_key": task.task_key, "source_hash": source_hash(task), "contract_version": "1.0"}

    @router.post("/grants")
    def create_grant(request: GrantRequest, session=Depends(get_db), caller=Depends(require_service)):
        return issue(session, request)

    @router.post("/grants/{grant_id}/revoke")
    def revoke(grant_id: UUID, session=Depends(get_db), caller=Depends(require_service)):
        session.execute(grants.update().where(grants.c.id == str(grant_id), grants.c.revoked_at.is_(None)).values(revoked_at=now()))
        return {"revoked": True}

    @router.post("/call")
    def call_tool(request: ToolCall, authorization: str = Header(default=""), session=Depends(get_db)):
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        return execute(session, token, request)

    return router
