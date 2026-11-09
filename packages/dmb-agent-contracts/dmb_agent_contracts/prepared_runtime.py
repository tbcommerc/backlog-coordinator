"""Prepared remote tools profile over an externally provisioned single-run lease."""
import hashlib
import json
import re
from fnmatch import fnmatchcase
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import UUID

from .model import AgentError
from .operation import current_operation
from .remote import RemoteOpenCode, VERSION
from .runtime import RuntimeHandle


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(",", ":")).encode()).hexdigest()


def origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
        or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise AgentError("runtime_origin_not_allowed", 422)
    return parsed.scheme+"://"+parsed.netloc


@dataclass
class PreparedHandle:
    lease: object
    runtime: object
    handle: object
    cancelled: bool = False
    cleanup: str = "pending"


class ScopedOpenCode(RemoteOpenCode):
    def __init__(self, *, allowed_tools, **options):
        super().__init__(**options)
        self.allowed_tools = allowed_tools
        self.strict_session_scope = True

    def _validate_tools(self, effective):
        expected = {"*": "deny", "StructuredOutput": "allow",
            **{name: "allow" for name in self.allowed_tools}}
        if effective.get("permission") != expected or not effective.get("mcp"):
            raise AgentError("runtime_tool_scoping_unsupported", 422)
        for server in effective["mcp"].values():
            if server.get("type") != "remote" or server.get("oauth") is not False:
                raise AgentError("runtime_tool_scoping_unsupported", 422)
            parsed = urlsplit(server.get("url", ""))
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise AgentError("runtime_tool_scoping_unsupported", 422)

    def capabilities(self):
        return replace(super().capabilities(), tool_scoping=True)

    def _validate_agents(self, agents):
        if not isinstance(agents, list) or len(agents) != 1:
            raise AgentError("runtime_profile_incompatible", 422)
        super()._validate_agents(agents)

    def _validate_agent_permissions(self, agent):
        rules = agent.get("permission")
        allowed = {"StructuredOutput", *self.allowed_tools}
        if not isinstance(rules, list) or not any(rule == {"permission": "*", "pattern": "*", "action": "deny"} for rule in rules):
            raise AgentError("runtime_tool_scoping_unsupported", 422)
        for rule in rules:
            if (not isinstance(rule, dict) or set(rule) != {"permission", "pattern", "action"}
                or not isinstance(rule["permission"], str) or not isinstance(rule["pattern"], str)
                or rule["action"] not in ("allow", "deny")
                or rule["action"] == "allow" and (rule["permission"] not in allowed or rule["pattern"] != "*")):
                raise AgentError("runtime_tool_scoping_unsupported", 422)
        for name in allowed:
            matching = [rule for rule in rules if fnmatchcase(name, rule["permission"]) and rule["pattern"] == "*"]
            if not matching or matching[-1]["action"] != "allow":
                raise AgentError("runtime_tool_scoping_unsupported", 422)
        if agent.get("model", self.model) != self.model:
            raise AgentError("runtime_profile_incompatible", 422)


class PreparedRemoteRuntime:
    """Off by default. Provisioning is a trusted deployment dependency, not a new API.

    A fresh instance owns one run; handles stay in the service's private queue.
    No server URL, tool schema, grant or permission is accepted from task text.
    """
    def __init__(self, *, provisioner, expected_config, model, agent, manifest,
                 allowed_origins, enabled=False, client_factory=None):
        if not enabled:
            raise AgentError("remote_profile_disabled", 422)
        self.provisioner, self.expected_config = provisioner, deepcopy(expected_config)
        self.model, self.agent, self.manifest = deepcopy(model), agent, deepcopy(manifest)
        self.allowed_origins = {origin(value) for value in allowed_origins}
        self.client_factory = client_factory
        self.prepared = False
        self.run_id = None
        self.handle = None
        self.cleanup_token = None
        tools = manifest.get("tools", {})
        if (manifest.get("version") != "1.0" or not isinstance(tools, dict) or not tools
            or any(not re.fullmatch(r"dmb_[a-z][a-z0-9_]{0,63}", name) for name in tools)):
            raise AgentError("runtime_manifest_invalid", 422)
        import jsonschema
        try:
            for schema in tools.values():
                jsonschema.Draft202012Validator.check_schema(schema)
        except (TypeError, jsonschema.SchemaError):
            raise AgentError("runtime_manifest_invalid", 422) from None
        self.tools = tuple(sorted(tools))
        network = manifest.get("network", {})
        try:
            bridge, broker = network["tool_bridge"], network["model_broker"]
            for endpoint in (bridge, broker):
                parsed = urlsplit(endpoint)
                origin(parsed.scheme+"://"+parsed.netloc)
                if parsed.query or parsed.fragment:
                    raise ValueError()
            providers = expected_config["provider"]
            provider_id = model["providerID"]
            if (set(providers) != {provider_id} or expected_config["enabled_providers"] != [provider_id]
                or providers[provider_id]["options"]["baseURL"] != broker
                or len(expected_config["mcp"]) != 1
                or next(iter(expected_config["mcp"].values()))["url"] != bridge):
                raise ValueError()
        except (KeyError, ValueError, TypeError, StopIteration):
            raise AgentError("runtime_network_manifest_invalid", 422) from None

    def capabilities(self):
        if self.handle is None:
            raise AgentError("runtime_preflight_required", 503)
        self._active(self.handle)
        return self.handle.runtime.capabilities()

    def binding(self, handle):
        """Private queue record: no endpoint, provider key, bridge token or password."""
        return {"version": "1.0", "run_id": handle.lease.run_id, "lease_id": handle.lease.lease_id,
            "session_id": handle.handle.session_id, "message_id": handle.handle.message_id,
            "schema": handle.handle.schema, "dispatch_ref": handle.handle.dispatch_ref,
            "delivery": handle.handle.delivery, "cancelled": handle.cancelled,
            "preparation_ref":handle.handle.preparation_ref}

    def restore(self, binding, run_context, tool_grant):
        if self.prepared or binding.get("version") != "1.0" or binding.get("run_id") != str(run_context["run_id"]):
            raise AgentError("runtime_binding_invalid", 503)
        lease = self.provisioner.recover(binding["run_id"])
        if lease is None or lease.lease_id != binding.get("lease_id"):
            raise AgentError("runtime_binding_invalid", 503)
        self._verify(lease, run_context, tool_grant)
        if (not re.fullmatch(r"ses_[a-zA-Z0-9_-]{1,124}", binding.get("session_id", ""))
            or not re.fullmatch(r"msg_[a-zA-Z0-9_-]{1,124}", binding.get("message_id", ""))
            or binding.get("delivery") not in ("not_attempted", "accepted", "unknown")):
            raise AgentError("runtime_binding_invalid", 503)
        runtime = ScopedOpenCode(base_url=lease.endpoint, expected_config=self.expected_config,
            model=self.model, agent=self.agent, enabled=True, allowed_tools=self.tools,
            client=self.client_factory(lease) if self.client_factory else None)
        runtime.capabilities()
        inner = RuntimeHandle(binding["session_id"], binding["message_id"], binding["schema"],
            dispatch_ref=binding.get("dispatch_ref"), delivery=binding["delivery"], cancelled=binding.get("cancelled", False),
            preparation_ref=binding.get("preparation_ref"),run_id=lease.run_id)
        self.prepared, self.run_id = True, lease.run_id
        self.handle = PreparedHandle(lease, runtime, inner, cancelled=inner.cancelled)
        return self.handle

    def _active(self, handle):
        if handle.cancelled or handle.cleanup == "confirmed":
            raise AgentError("already_terminal", 409)
        if handle.lease.expires_at <= datetime.now(timezone.utc) or self.provisioner.inspect(handle.lease) != handle.lease:
            raise AgentError("runtime_lease_lost", 503)
        context = current_operation()
        if context is not None:
            if str(context.run_id) != handle.lease.run_id:
                raise AgentError("runtime_lease_mismatch", 503)
            context.check()

    def _verify(self, lease, run_context, tool_grant):
        UUID(lease.run_id)
        if self.provisioner.inspect(lease) != lease:
            raise AgentError("runtime_lease_mismatch", 503)
        deadline = run_context["deadline_at"]
        if (lease.run_id != str(run_context["run_id"]) or tool_grant.get("run_id") != lease.run_id
            or lease.isolation != "single_run" or lease.runtime_version != VERSION
            or origin(lease.endpoint) not in self.allowed_origins
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", lease.image_digest)
            or lease.config_hash != digest(self.expected_config)
            or lease.tool_manifest_hash != digest(self.manifest)
            or not lease.grant_refs or set(lease.grant_refs) != set(tool_grant.get("refs", []))
            or len({lease.workspace_ref, lease.state_ref, lease.credentials_ref}) != 3
            or not all((lease.lease_id, lease.workspace_ref, lease.state_ref, lease.credentials_ref))
            or lease.expires_at.tzinfo is None or deadline.tzinfo is None
            or not datetime.now(timezone.utc) < lease.expires_at <= deadline):
            raise AgentError("runtime_lease_mismatch", 503)

    def prepare(self, run_context, tool_grant, result_schema):
        if self.prepared:
            raise AgentError("runtime_lease_already_used", 409)
        self.prepared = True
        self.run_id = str(UUID(str(run_context["run_id"])))
        context = current_operation()
        if context is not None:
            self.cleanup_token = context.hold_slot_for_cleanup()
        try:
            lease = self.provisioner.acquire(run_context, tool_grant, self.manifest)
            self._verify(lease, run_context, tool_grant)
            runtime = ScopedOpenCode(base_url=lease.endpoint, expected_config=self.expected_config,
                model=self.model, agent=self.agent, enabled=True, allowed_tools=self.tools,
                client=self.client_factory(lease) if self.client_factory else None)
            handle = runtime.prepare(run_context, {}, result_schema)
            self.handle = PreparedHandle(lease, runtime, handle)
            return self.handle
        except BaseException:
            try:
                self.recover_cleanup(self.run_id)
            except Exception:
                pass  # Unconfirmed resources retain the operation lease and durable journal.
            raise

    def recover_cleanup(self, run_id):
        """Trusted janitor entry after restart/unknown provisioning outcome."""
        run_id = str(UUID(str(run_id)))
        lease = self.provisioner.recover(run_id)
        if lease is None or lease.run_id != run_id or self.provisioner.inspect(lease) != lease:
            raise AgentError("cleanup_unconfirmed", 503)
        revoked = self.provisioner.revoke(lease)
        receipt = self.provisioner.dispose(lease)
        self._confirm_receipt(lease, revoked, receipt)
        return {"cleanup": "confirmed"}

    def _confirm_receipt(self, lease, revoked, receipt):
        if (revoked is not True or receipt.get("lease_id") != lease.lease_id
            or receipt.get("run_id") != lease.run_id or receipt.get("cleanup") != "confirmed"
            or receipt.get("resources_absent") is not True):
            raise AgentError("cleanup_unconfirmed", 503)
        context = current_operation()
        if context is not None and self.cleanup_token is not None:
            if str(context.run_id) != lease.run_id:
                raise AgentError("runtime_lease_mismatch", 503)
            context.confirm_cleanup(self.cleanup_token)
            self.cleanup_token = None

    def submit(self, handle, task, dispatch_ref):
        self._active(handle)
        handle.runtime.capabilities()  # Detect configuration drift before dispatch.
        return handle.runtime.submit(handle.handle, task, dispatch_ref)

    def observe(self, handle, cursor=None):
        self._active(handle)
        return handle.runtime.observe(handle.handle, cursor)

    def inspect(self, handle):
        if handle.cancelled:
            return "cancelled"
        self._active(handle)
        return handle.runtime.inspect(handle.handle)

    def collect(self, handle):
        self._active(handle)
        candidate = handle.runtime.collect(handle.handle)
        self._active(handle)
        return candidate

    def cancel(self, handle, reason="user_cancel"):
        handle.cancelled = True
        handle.handle.cancelled = True
        revoked = self.provisioner.revoke(handle.lease)
        try:
            handle.runtime.cancel(handle.handle, reason)
        except AgentError:
            pass
        return {"publication_forbidden": True, "grants_revoked": revoked is True, "cleanup": "pending"}

    def dispose(self, handle):
        if handle.cleanup == "confirmed":
            return {"cleanup": "confirmed"}
        revoked = self.provisioner.revoke(handle.lease)
        handle.runtime.dispose(handle.handle)
        receipt = self.provisioner.dispose(handle.lease)
        try:
            self._confirm_receipt(handle.lease, revoked, receipt)
        except AgentError:
            handle.cleanup = "failed"
            raise
        handle.cleanup = "confirmed"
        return {"cleanup": "confirmed"}
