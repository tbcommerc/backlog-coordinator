"""Durable dialogue facade; legacy product routes remain available."""
import hmac
import json
from typing import Literal
from dataclasses import asdict, is_dataclass

from fastapi import Header, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, Field

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_api import router
from dmb_agent_contracts.run_store import Store, fingerprint
from dmb_agent_contracts.run_worker import Worker
from .config import settings
from .session import session_store
from .api.router import chat, document_action
from .api.schemas import ChatRequest, DocumentActionRequest


class MessageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)


class DocumentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_draft_hash: str = Field(default="", max_length=80)
    instruction: str = Field(default="", max_length=5000)
    action: Literal["create_draft", "draft", "propose_change", "review"] | None = None
    field: str = Field(default="", max_length=64)


def authenticate(x_agent_secret: str = Header(default=""), x_agent_caller: str = Header(default=""),
                 x_actor_ref: str = Header(default=""), x_agent_context: str = Header(default="{}")):
    if not settings.AGENT_SECRET or not hmac.compare_digest(settings.AGENT_SECRET, x_agent_secret):
        raise AgentError("service_auth_required", 401)
    if x_agent_caller != "dmb" or not x_actor_ref.isascii() or not x_actor_ref.isdigit() or len(x_actor_ref)>18:
        raise AgentError("operation_forbidden", 403)
    try:
        if len(x_agent_context)>4096: raise ValueError()
        context=json.loads(x_agent_context)
        allowed={"name","email","role_name","customer_access","team_name","department","is_ba","operator_role"}
        if not isinstance(context,dict) or set(context)-allowed: raise ValueError()
        if any(not isinstance(value,str) or len(value)>256 for key,value in context.items() if key!="is_ba"): raise ValueError()
        if "is_ba" in context and not isinstance(context["is_ba"],bool): raise ValueError()
    except (ValueError,TypeError):
        raise AgentError("invalid_request",400) from None
    return "dmb",str(int(x_actor_ref)),{**context,"user_id":int(x_actor_ref)}


def profile():
    value = {"backend":settings.EXECUTION_BACKEND,"provider":settings.MODEL_PROVIDER,"protocol":settings.MODEL_PROTOCOL,
        "base_url":settings.OPENAI_BASE_URL,"model":settings.OPENAI_MODEL}
    if settings.EXECUTION_BACKEND == "opencode":
        from dmb_agent_contracts.remote_configuration import RemoteProfile
        value["remote_profile_ref"] = RemoteProfile.from_settings(settings).profile_ref
    return value


def validate(body):
    if not settings.ENABLED or settings.KILL_SWITCH:
        raise AgentError("service_disabled",503)
    if body["operation"] not in {"dialogue.message", "document.generate", "document.review"}:
        raise AgentError("unsupported_operation",422)
    (MessageInput if body["operation"] == "dialogue.message" else DocumentInput).model_validate(body["input"])
    if body["operation"] != "dialogue.message":
        action = body["input"].get("action")
        if (action is not None and (action == "review") != (body["operation"] == "document.review")):
            raise AgentError("unsupported_operation",422)
    if not body.get("conversation_ref") or body["source"]["kind"]!="dialogue" or body["source"]["ref"]!=body["conversation_ref"]:
        raise AgentError("input_validation_failed",422)
    if body["source"]["snapshot_hash"]!="sha256:"+fingerprint(body["input"]):
        raise AgentError("source_revision_conflict",409)


def handle(row, connection):
    if row["profile"]!=profile():
        raise AgentError("runtime_profile_changed",503)
    with session_store.serialized(row["conversation_ref"]):
        state=session_store.get(row["conversation_ref"])
        if state is None or state.user_id!=int(row["actor"]):
            raise AgentError("operation_forbidden",403)
        if state._storage_version!=row["source"]["revision"]:
            raise AgentError("source_revision_conflict",409)
        try:
            if row["operation"] == "dialogue.message":
                response=chat(ChatRequest(session_id=row["conversation_ref"],message_id=row["id"],
                    message=row["input"]["message"],context=row["trusted_context"]),None)
            else:
                content = dict(row["input"])
                action = content.pop("action", None) or ("review" if row["operation"] == "document.review" else "create_draft")
                response=document_action(DocumentActionRequest(session_id=row["conversation_ref"],
                    user_id=int(row["actor"]), idempotency_key=row["id"], action=action, **content), None)
        except HTTPException as error:
            code="operation_forbidden" if error.status_code in (403,404) else "source_revision_conflict" if error.status_code==409 else "runtime_unavailable"
            raise AgentError(code,error.status_code) from None
        payload=asdict(response) if is_dataclass(response) else response
        if payload.get("action") in {"unavailable","error"}:
            raise AgentError("provider_unavailable",503)
        return {"quality":"needs_input" if payload.get("action")=="refused" else "full","payload":payload}


store=Store(session_store.engine)
def recovery_profile():
    if settings.EXECUTION_BACKEND != "opencode":
        return None
    from dmb_agent_contracts.remote_configuration import RemoteProfile
    return RemoteProfile.from_settings(settings)


worker=Worker(store,handle,runtime_profile=recovery_profile,transaction_scope=session_store.transaction)
api=router(store=store,authenticate=authenticate,validate=validate,profile=profile,
    capabilities=lambda:{"service_id":"business-analyst-experimental","service_version":settings.APP_VERSION,
        "operations":["dialogue.message", "document.generate", "document.review"],"profiles":["prepared-remote" if settings.EXECUTION_BACKEND=="opencode" else "local-go-direct"],"real_remote":"not_verified"},
    deadline_seconds=150)


@api.get("/conversations/{conversation_ref}")
def conversation_revision(conversation_ref: str, actor=Depends(authenticate)):
    state = session_store.get(conversation_ref)
    if state is None or state.user_id != int(actor[1]):
        raise AgentError("run_not_found",404)
    return {"conversation_ref":conversation_ref,"revision":state._storage_version,"source_kind":"dialogue"}
