"""Durable coordinator facade; deterministic scoring stays in the product service."""
import hmac

from fastapi import Header, HTTPException
from sqlalchemy.orm import Session

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_api import router
from dmb_agent_contracts.run_store import Store, fingerprint
from dmb_agent_contracts.run_worker import Worker
from .api.contract import TaskAttributes
from .config import get_settings
from .core.db import get_engine
from .service import handle_request


def authenticate(x_prioritiser_secret: str = Header(default=""),
                 x_agent_caller: str = Header(default=""), x_actor_ref: str = Header(default="")):
    expected = get_settings().service_secret
    if not expected or not hmac.compare_digest(expected, x_prioritiser_secret):
        raise AgentError("service_auth_required", 401)
    if x_agent_caller != "dmb" or not x_actor_ref or len(x_actor_ref) > 128:
        raise AgentError("operation_forbidden", 403)
    return "dmb", x_actor_ref


def profile():
    settings = get_settings()
    value = {"backend": settings.execution_backend, "provider": settings.model_provider,
        "protocol": settings.model_protocol, "base_url": settings.openai_base_url,
        "model": settings.openai_model, "strategy_provider": settings.strategy_provider,
        "dependency_provider": settings.dependency_provider}
    if settings.execution_backend == "opencode":
        from dmb_agent_contracts.remote_configuration import RemoteProfile
        value["remote_profile_ref"] = RemoteProfile.from_settings(settings).profile_ref
    return value


def validate(body):
    if body["operation"] not in ("value.estimate", "priority.estimate"):
        raise AgentError("unsupported_operation", 422)
    task = TaskAttributes.model_validate(body["input"])
    if body.get("conversation_ref") is not None or body["source"]["kind"] != "work_item" or body["source"]["ref"] != task.task_id:
        raise AgentError("input_validation_failed", 422)
    if body["source"]["snapshot_hash"] != "sha256:"+fingerprint(body["input"]):
        raise AgentError("source_revision_conflict", 409)


def handle(row, connection):
    if row["profile"] != profile():
        raise AgentError("runtime_profile_changed", 503)
    # Independent F5/F6 sessions hold technical model-cache records only. The
    # transient Task is never persisted; the response history joins this run CAS.
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        response = handle_request(TaskAttributes.model_validate(row["input"]),
            "value" if row["operation"] == "value.estimate" else "priority", session)
        if response.status == "error":
            raise AgentError("provider_unavailable", 503)
        payload = response.model_dump(mode="json")
        from .remote_tools import promote_staged
        try:
            promote_staged(session, row["id"])
        except HTTPException as error:
            raise AgentError(error.detail, error.status_code) from None
        session.commit()  # Release only the nested savepoint, never the outer run transaction.
    quality = "needs_input" if response.status == "insufficient_data" else "full"
    return {"quality": quality, "payload": payload}


store = Store(get_engine())
def recovery_profile():
    settings = get_settings()
    if settings.execution_backend != "opencode":
        return None
    from dmb_agent_contracts.remote_configuration import RemoteProfile
    return RemoteProfile.from_settings(settings)


worker = Worker(store, handle, runtime_profile=recovery_profile)
api = router(store=store, authenticate=authenticate, validate=validate, profile=profile,
    capabilities=lambda: {"service_id": "value-priority-assessor", "service_version": "0.1.0",
        "operations": ["value.estimate", "priority.estimate"], "profiles": ["prepared-remote" if get_settings().execution_backend=="opencode" else "local-go-direct"],
        "real_remote": "not_verified"}, deadline_seconds=180)
