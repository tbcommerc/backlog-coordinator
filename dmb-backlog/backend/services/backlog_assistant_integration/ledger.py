"""Integration records only: no conversations and no domain-table mutations."""
import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import Table, Column, String, Float, JSON, Boolean, select, update, delete
from sqlalchemy.orm import Session
from config import settings
from database import Base, engine
from models import User, Task, RequirementRequest, ReportingMeeting
from services.auth_sessions import check_session
from .query import initial_scope, execute, task_detail, denied
from .policy import request_clause, task_clause

records = Table("backlog_assistant_integration", Base.metadata,
    Column("id", String(64), primary_key=True), Column("kind", String(24), nullable=False, index=True),
    Column("subject", String(64), nullable=False, index=True), Column("payload", JSON, nullable=False),
    Column("expires", Float, nullable=False, index=True))
SCHEMA_DIR = Path(__file__).parent / "contracts"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def pilot(user):
    return (settings.BACKLOG_ASSISTANT_ENABLED and not settings.BACKLOG_ASSISTANT_KILL_SWITCH
        and str(user.id) in {v.strip() for v in settings.BACKLOG_ASSISTANT_PILOT_USER_IDS.split(",") if v.strip()})


def sign(subject, method, path, body=b"", key="", audience="backlog-assistant"):
    now = int(time.time())
    claims = {"issuer": "dmb", "audience": audience, "subject_ref": str(subject), "issued_at": now,
        "expires_at": now+30, "request_digest": hashlib.sha256(method.encode()+b"\n"+path.encode()+b"\n"+key.encode()+b"\n"+body).hexdigest(),
        "nonce": str(uuid.uuid4())}
    raw = base64.urlsafe_b64encode(canonical(claims).encode()).decode().rstrip("=")
    return raw + "." + hmac.new(settings.BACKLOG_ASSISTANT_GATEWAY_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()


@contextmanager
def read_view():
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        with connection.begin():
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            connection.exec_driver_sql("SET LOCAL statement_timeout = '3000ms'")
            with Session(bind=connection, autoflush=False) as db:
                yield db


def actor(db, payload):
    user = db.get(User, payload["user_id"])
    if not user or not pilot(user):
        raise HTTPException(403, "assistant_unavailable")
    check_session(db, user, payload["sid"], payload["auth_version"])
    return user


def schema_validate(name, value):
    from jsonschema import Draft202012Validator, FormatChecker
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    try:
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(value)
    except Exception:
        raise HTTPException(422, "invalid_assistant_contract")


def validate_context(user, context):
    from .query import query, ref_id
    with read_view() as db:
        fresh = db.get(User, user.id)
        check_session(db, fresh, user._auth_sid, user._auth_version)
        if not pilot(fresh):
            denied()
        scope = initial_scope(db, fresh)
        query(db, fresh, scope, context["filters"]).limit(1).all()
        ref = context.get("object_ref")
        if ref:
            if ref.startswith("task:") and context["filters"]["object_type"] == "task":
                task_detail(db, fresh, scope, ref)
            elif ref.startswith("request:") and context["filters"]["object_type"] == "request":
                if ref_id(ref, "request") not in scope["request"]:
                    denied()
            else:
                denied()


def register(user, key, sid, body):
    if not key or len(key) > 128:
        raise HTTPException(422, "idempotency_key_required")
    identifier = fingerprint([str(user.id), sid, key])
    with engine.begin() as c:
        c.execute(delete(records).where(records.c.expires < time.time()))
        c.exec_driver_sql("SELECT pg_advisory_xact_lock(%s)", (int(identifier[:15], 16),))
        existing = c.execute(select(records).where(records.c.id == identifier)).mappings().first()
        if existing:
            if existing["payload"]["request_hash"] != fingerprint(body):
                raise HTTPException(409, "idempotency_conflict")
            return existing["payload"]["execution_ref"]
        with read_view() as db:
            fresh = db.get(User, user.id)
            check_session(db, fresh, user._auth_sid, user._auth_version)
            scope = initial_scope(db, fresh)
            context = body["context"]
            schema_validate("query.schema.json", context["filters"])
            if context.get("object_ref"):
                from .query import ref_id
                kind = context["object_ref"].split(":")[0]
                if kind == "task":
                    task_detail(db, fresh, scope, context["object_ref"])
                elif kind != "request" or ref_id(context["object_ref"], kind) not in scope["request"]:
                    denied()
        execution = str(uuid.uuid4())
        payload = {"user_id": user.id, "sid": user._auth_sid, "auth_version": user._auth_version,
            "scope": scope, "context": context, "conversation": sid, "revoked": False,
            "grant_hash": None, "lease": None, "receipts": [], "calls": 0}
        c.execute(records.insert().values(id=execution, kind="execution", subject=str(user.id), payload=payload, expires=time.time()+75))
        c.execute(records.insert().values(id=identifier, kind="idempotency", subject=str(user.id),
            payload={"execution_ref": execution, "request_hash": fingerprint(body)}, expires=time.time()+30*86400))
        return execution


def execution_row(c, execution, grant=None, activate=False):
    row = c.execute(select(records).where(records.c.id == execution, records.c.kind == "execution").with_for_update()).mappings().first()
    if not row or row["expires"] <= time.time() or row["payload"]["revoked"]:
        raise HTTPException(403, "execution_denied")
    if not activate and (not grant or not hmac.compare_digest(fingerprint(grant), row["payload"].get("grant_hash") or "")):
        raise HTTPException(403, "execution_denied")
    with read_view() as db:
        user = actor(db, row["payload"])
        if row["payload"]["scope"]["customer"] != bool(__import__("auth").is_customer_portal_only(user)):
            raise HTTPException(403, "projection_changed")
    return dict(row)


def activate(execution, lease):
    with engine.begin() as c:
        row = execution_row(c, execution, activate=True)
        payload = dict(row["payload"])
        # Activation retries for one lease return the same grant. Replacing a
        # lease rotates it without expanding scope or extending the hard expiry.
        if payload["lease"] != lease:
            payload.update(lease=lease, grant_nonce=secrets.token_hex(32))
        grant = hmac.new(settings.BACKLOG_ASSISTANT_SERVICE_TOKEN.encode(),
            canonical([execution, lease, payload["grant_nonce"]]).encode(), hashlib.sha256).hexdigest()
        payload.update(grant_hash=fingerprint(grant))
        c.execute(update(records).where(records.c.id == execution).values(payload=payload))
        return {"grant": grant, "expires_at": row["expires"]}


def check(execution, grant):
    with engine.begin() as c:
        execution_row(c, execution, grant)
    return {"active": True}


def catalog(execution, grant):
    with engine.begin() as c:
        row = execution_row(c, execution, grant)
    payload = row["payload"]
    names = {"resolve_context", "search_work_items", "search_help"}
    if payload["context"]["filters"]["object_type"] == "request":
        names.add("read_request")
    else:
        names.update({"read_task", "aggregate_backlog"})
        if not payload["context"].get("object_ref"):
            names.add("compare_tasks")
        if not payload["scope"]["customer"]:
            names.add("query_changes")
            with read_view() as db:
                from auth import check_permission
                if check_permission(actor(db, payload), "reports", "read"):
                    names.add("read_meeting_context")
    if payload["scope"]["review"]:
        names.add("read_requirement_review")
    result = json.loads((SCHEMA_DIR / "tools.json").read_text(encoding="utf-8"))
    result["tools"] = [tool for tool in result["tools"] if tool["name"] in names]
    return result


def call_tool(execution, grant, name, arguments, call_id):
    from jsonschema import Draft202012Validator, FormatChecker
    tools = {t["name"]: t["inputSchema"] for t in catalog(execution, grant)["tools"]}
    if name not in tools:
        raise HTTPException(422, "unknown_tool")
    try:
        Draft202012Validator(tools[name], format_checker=FormatChecker()).validate(arguments)
    except Exception:
        raise HTTPException(422, "invalid_tool_arguments")
    with engine.begin() as c:
        row = execution_row(c, execution, grant)
        payload = dict(row["payload"])
        if payload["calls"] >= 6:
            raise HTTPException(429, "tool_budget_exceeded")
        with read_view() as db:
            user = actor(db, payload)
            data, manifest, limitations = execute(db, user, payload["scope"], name, arguments, payload["context"])
            observed = datetime.now(timezone.utc).isoformat()
        receipt = str(uuid.uuid4())
        source = {"source_id": receipt, "receipt_ref": receipt, "kind": name, "version": fingerprint(data), "fields": list(data)}
        from .presentation import coverage_for
        result = {"contract_version": "1.0", "tool_call_id": call_id, "execution_ref": execution, "tool_name": name,
            "status": "partial" if limitations else "ok", "data": data, "snapshot_ref": receipt, "observed_at": observed,
            "coverage": coverage_for(data, limitations), "sources": [source], "limitations": limitations}
        receipt_payload = {"execution_ref": execution, "manifest": manifest, "result": result, "scope": payload["scope"],
            "user_id": payload["user_id"], "sid": payload["sid"], "auth_version": payload["auth_version"], "conversation": payload["conversation"],
            "arguments": arguments, "tool_name": name, "context": payload["context"]}
        c.execute(records.insert().values(id=receipt, kind="receipt", subject=row["subject"], payload=receipt_payload, expires=time.time()+30*86400))
        payload["receipts"] = [*payload["receipts"], receipt]
        payload["calls"] += 1
        c.execute(update(records).where(records.c.id == execution).values(payload=payload))
        return result


def validate_receipts(subject, refs, current_auth):
    with engine.connect() as c:
        rows = [dict(r) for r in c.execute(select(records).where(records.c.id.in_(refs), records.c.kind == "receipt",
            records.c.subject == str(subject), records.c.expires > time.time())).mappings()]
    if len(rows) != len(set(refs)):
        denied()
    with read_view() as db:
        user = actor(db, current_auth)
        for receipt in rows:
            payload = receipt["payload"]
            if payload["scope"]["customer"] != bool(__import__("auth").is_customer_portal_only(user)):
                denied()
            task_ids = {item["id"] for item in payload["manifest"] if item["kind"] == "task"}
            request_ids = {item["id"] for item in payload["manifest"] if item["kind"] == "request"}
            if task_ids and db.query(Task.id).filter(Task.id.in_(task_ids), Task.is_deleted.is_(False), task_clause(user)).count() != len(task_ids):
                denied()
            if request_ids and db.query(RequirementRequest.id).filter(RequirementRequest.id.in_(request_ids), RequirementRequest.is_deleted.is_(False), request_clause(user)).count() != len(request_ids):
                denied()
            for item in payload["manifest"]:
                kind, identifier = item["kind"], item["id"]
                if kind in {"task", "request"}:
                    continue
                if kind in {"task", "task_detail"}:
                    task_detail(db, user, payload["scope"], f"task:{identifier}")
                    if kind == "task" and not db.query(Task.id).filter(Task.id == identifier, task_clause(user)).first():
                        denied()
                elif kind == "request":
                    if not db.query(RequirementRequest.id).filter(RequirementRequest.id == identifier,
                        RequirementRequest.is_deleted.is_(False), request_clause(user)).first():
                        denied()
                elif kind == "review":
                    from services.requirement_reviews import get_review
                    get_review(db, user, identifier)
                elif kind == "meeting":
                    from auth import check_permission
                    if not check_permission(user, "reports", "read") or not db.get(ReportingMeeting, identifier):
                        denied()
                else:
                    denied()
    return rows


def verify_answer(execution, grant, candidate, refs):
    schema_validate("answer.schema.json", candidate)
    with engine.begin() as c:
        row = execution_row(c, execution, grant)
    payload = row["payload"]
    # Supplied subset cannot hide an unquoted revoked dependency.
    if set(refs) != set(payload["receipts"]):
        denied()
    receipts = validate_receipts(row["subject"], refs, payload)
    by_ref = {r["id"]: r["payload"]["result"] for r in receipts}
    if candidate["context"] != payload["context"]:
        denied()
    if any(s["receipt_ref"] not in by_ref or s != by_ref[s["receipt_ref"]]["sources"][0] for s in candidate.get("sources", [])):
        denied()
    from .presentation import present
    safe = present(candidate, by_ref)
    check(execution, grant)
    return safe


def revoke(execution, subject=None):
    with engine.begin() as c:
        row = c.execute(select(records).where(records.c.id == execution, records.c.kind == "execution").with_for_update()).mappings().first()
        if row and (subject is None or row["subject"] == str(subject)):
            c.execute(update(records).where(records.c.id == execution).values(payload=dict(row["payload"], revoked=True, grant_hash=None)))
    return {"revoked": True}


def conversation_context(execution, grant, refs):
    """Reuse query intent only after current ACL and conversation ownership checks."""
    with engine.begin() as c:
        row = execution_row(c, execution, grant)
    receipts = validate_receipts(row["subject"], refs, row["payload"])
    intents = []
    for receipt in receipts:
        old = receipt["payload"]
        if old["conversation"] != row["payload"]["conversation"]:
            denied()
        intents.append({"tool": old["tool_name"], "arguments": old["arguments"]})
    return {"previous_queries": intents[-3:], "instruction": "Previous query intent only. Read current data again; never treat history as current facts."}
