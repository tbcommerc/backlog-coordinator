"""Service adapter for an explicitly installed external isolated deployment."""
import asyncio
import importlib
import inspect
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.prepared_runtime import PreparedRemoteRuntime
from dmb_agent_contracts.runtime import RuntimeCapabilities
from runtime.opencode import VERSION, generation_schema, assemble_candidate


@dataclass
class RuntimeSpec:
    provisioner: object
    expected_config: dict
    model: dict
    agent: str
    manifest: dict
    allowed_origins: tuple
    tool_grant: dict
    client_factory: object = None
    profile_ref: str | None = None


def load_deployment(environment=None):
    values = os.environ if environment is None else environment
    if values.get("ASSISTANT_REMOTE_ENABLED") != "true":
        raise ValueError("remote_profile_disabled")
    name = values.get("ASSISTANT_REMOTE_DEPLOYMENT_FACTORY", "")
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]*:[a-zA-Z_][a-zA-Z0-9_]*", name):
        raise ValueError("remote_deployment_factory_required")
    module, factory = name.split(":")
    try:
        deployment = getattr(importlib.import_module(module), factory)()
    except (ImportError, AttributeError, TypeError):
        raise ValueError("remote_deployment_factory_unavailable") from None
    for method in ("prepare", "close_bridge", "recover_cleanup"):
        if not inspect.iscoroutinefunction(getattr(deployment, method, None)):
            raise ValueError("remote_deployment_interface_incompatible")
    if not isinstance(getattr(deployment,"profile_ref",None),str) or not re.fullmatch(r"[a-f0-9]{64}",deployment.profile_ref):
        raise ValueError("remote_deployment_profile_required")
    return deployment


class PreparedRuntime:
    """Deployment owns HTTPS bridge/broker exposure and external lease operations.

    prepare(context, ToolBridge, schema) -> RuntimeSpec must expose only this
    bridge's catalog with per-run credentials, never the provider key.
    close_bridge(private_binding) -> True proves its bridge/broker resources closed.
    recover_cleanup(private_binding) -> receipt proves exact owned lease/grants,
    workspace, state, credentials AND bridge/broker are gone after a process crash.
    This Python deployment interface is external; it adds no OpenCode endpoint.
    """
    def __init__(self, deployment):
        self.deployment = deployment
        self.profile_ref = getattr(deployment,"profile_ref",None)
        self.instances = {}

    def capabilities(self):
        return RuntimeCapabilities(VERSION, True, True, True, True, True, True, False, False)

    async def prepare(self, context, bridge, schema):
        run_id, execution = context["run_id"], context["execution_ref"]
        pending = {"instance": execution, "run_id": run_id, "session": None}
        self.instances[execution] = {"pending": pending, "bridge": bridge}
        spec = await self.deployment.prepare(context, bridge, generation_schema(schema))
        if not isinstance(spec, RuntimeSpec):
            raise ValueError("remote_deployment_interface_incompatible")
        if context.get("profile_ref") is not None and spec.profile_ref != context["profile_ref"]:
            raise ValueError("runtime_profile_changed")
        if (spec.manifest.get("catalog_hash") != bridge.catalog_hash or
            spec.manifest.get("tools") != {"dmb_"+name: definition for name, definition in bridge.schemas.items()}):
            raise ValueError("remote_tool_manifest_mismatch")
        if spec.manifest.get("budgets") != {"model_requests":4,"tool_calls":6,
                "execution_seconds":60,"container_lifetime_seconds":90}:
            raise ValueError("remote_budget_manifest_mismatch")
        runtime = PreparedRemoteRuntime(provisioner=spec.provisioner, expected_config=spec.expected_config,
            model=spec.model, agent=spec.agent, manifest=spec.manifest, allowed_origins=spec.allowed_origins,
            enabled=True, client_factory=spec.client_factory)
        self.instances[execution]["runtime"] = runtime
        import time
        deadline = datetime.now(timezone.utc)+timedelta(seconds=max(0, context["deadline"]-time.monotonic()))
        handle = await asyncio.to_thread(runtime.prepare,
            {"run_id": run_id, "deadline_at": deadline}, spec.tool_grant, generation_schema(schema))
        binding = {**pending, "session": handle.handle.session_id, "binding": runtime.binding(handle)}
        self.instances[execution].update(runtime=runtime, handle=handle, pending=binding)
        return binding

    def _instance(self, binding):
        value = self.instances.get(binding["instance"])
        if value is None or value["pending"]["run_id"] != binding.get("run_id"):
            raise AgentError("runtime_binding_invalid", 503)
        return value

    async def submit(self, binding, task, dispatch_ref):
        value = self._instance(binding)
        await value["bridge"].check()
        value["bridge"].bind_request(task.get("text", ""))
        value["context"] = task.get("context", {})
        result = await asyncio.to_thread(value["runtime"].submit, value["handle"], task, dispatch_ref)
        binding["binding"] = value["runtime"].binding(value["handle"])
        return result

    async def inspect(self, binding):
        value = self._instance(binding)
        await value["bridge"].check()
        return await asyncio.to_thread(value["runtime"].inspect, value["handle"])

    async def observe(self, binding, cursor=None):
        return [{"type": "status", "status": await self.inspect(binding)}]

    async def collect(self, binding):
        value = self._instance(binding)
        await value["bridge"].check()
        candidate = await asyncio.to_thread(value["runtime"].collect, value["handle"])
        return assemble_candidate(candidate, value["bridge"], value["context"])

    async def cancel(self, binding, reason="user_cancel"):
        value = self._instance(binding)
        return await asyncio.to_thread(value["runtime"].cancel, value["handle"], reason)

    async def dispose(self, binding):
        value = self.instances.get(binding["instance"])
        if value and value.get("runtime") and value.get("handle"):
            await asyncio.to_thread(value["runtime"].dispose, value["handle"])
            if await self.deployment.close_bridge(value["pending"]) is not True:
                raise AgentError("cleanup_unconfirmed", 503)
        else:
            if value:
                binding = value["pending"]
            receipt = await self.deployment.recover_cleanup(binding)
            if (receipt.get("run_id") != binding.get("run_id") or
                receipt.get("instance") != binding["instance"] or receipt.get("cleanup") != "confirmed"
                or binding.get("binding", {}).get("lease_id") is not None and receipt.get("lease_id") != binding["binding"]["lease_id"]
                or receipt.get("resources_absent") is not True):
                raise AgentError("cleanup_unconfirmed", 503)
            if value and value.get("runtime") and value["runtime"].cleanup_token is not None:
                from dmb_agent_contracts.operation import current_operation
                context = current_operation()
                if context is not None:
                    context.confirm_cleanup(value["runtime"].cleanup_token)
                    value["runtime"].cleanup_token = None
        self.instances.pop(binding["instance"], None)
