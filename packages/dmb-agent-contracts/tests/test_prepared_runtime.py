"""contract_emulator: real HTTP reference fixture plus external lease attestation."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.prepared_runtime import PreparedRemoteRuntime, digest
from dmb_agent_contracts.provisioning import IsolatedLease
from test_remote_http import CONFIG, SCHEMA, emulator


def prepared(url, **faults):
    run_id = str(uuid4())
    context = {"run_id": run_id, "deadline_at": datetime.now(timezone.utc)+timedelta(seconds=30)}
    grant = {"run_id": run_id, "refs": ["synthetic-grant"]}
    manifest = {"version": "1.0", "tools": {"dmb_read_task": {"type": "object", "additionalProperties": False}},
        "network": {"tool_bridge": "https://bridge.invalid/mcp", "model_broker": "https://broker.invalid/v1"}}
    config = {**CONFIG, "permission": {"*": "deny", "StructuredOutput": "allow", "dmb_read_task": "allow"},
        "provider": {"controlled": {"options": {"baseURL": "https://broker.invalid/v1"}}},
        "enabled_providers": ["controlled"],
        "mcp": {"dmb": {"type": "remote", "url": "https://bridge.invalid/mcp", "oauth": False}}}
    lease = IsolatedLease("synthetic-lease", run_id, "https://runtime.invalid", "1.17.13", "sha256:"+"1"*64,
        context["deadline_at"], "workspace-one", "state-one", "credentials-one", digest(config), digest(manifest),
        ("synthetic-grant",))
    lease = replace(lease, **faults.get("lease", {}))

    class Provisioner:
        revoked = False
        removed = False
        def acquire(self, run_context, tool_grant, tool_manifest):
            assert run_context == context and tool_grant == grant and tool_manifest == manifest
            return lease
        def inspect(self, item):
            assert item == lease
            return lease
        def recover(self, identity):
            assert identity == run_id
            return lease
        def revoke(self, item):
            self.revoked = True
            return True
        def dispose(self, item):
            self.removed = True
            return {"lease_id": lease.lease_id, "run_id": lease.run_id,
                "cleanup": "failed" if faults.get("cleanup") else "confirmed", "resources_absent": True}

    provisioner = Provisioner()
    client = httpx.Client(base_url=url, timeout=1, trust_env=False)
    runtime = PreparedRemoteRuntime(provisioner=provisioner, expected_config=config,
        model={"providerID": "controlled", "modelID": "synthetic"}, agent="bounded", manifest=manifest,
        allowed_origins=["https://runtime.invalid"], enabled=True, client_factory=lambda _: client)
    return runtime, provisioner, context, grant, config, client


def test_qualified_tools_use_reference_http_and_owned_cleanup():
    with emulator() as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": name, "pattern": "*", "action": action} for name, action in config["permission"].items()]}]
        try:
            handle = runtime.prepare(context, grant, SCHEMA)
            assert runtime.capabilities().tool_scoping is True
            assert runtime.submit(handle, {"text": "synthetic"}, "dispatch-one") == "accepted"
            assert runtime.collect(handle) == {"items": []}
            with pytest.raises(AgentError, match="duplicate_dispatch"):
                runtime.submit(handle, {}, "dispatch-two")
            assert state["dispatch_count"] == 1
            assert runtime.dispose(handle) == {"cleanup": "confirmed"}
            assert provisioner.revoked and provisioner.removed
        finally:
            client.close()


@pytest.mark.parametrize("change", [{"isolation": "shared"}, {"config_hash": "wrong"},
    {"tool_manifest_hash": "wrong"}, {"runtime_version": "2.0"},
    {"grant_refs": ("foreign",)}, {"state_ref": "workspace-one"}])
def test_incompatible_lease_is_rejected_before_session_creation(change):
    with emulator() as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url, lease=change)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": name, "pattern": "*", "action": action} for name, action in config["permission"].items()]}]
        try:
            with pytest.raises(AgentError, match="runtime_lease_mismatch"):
                runtime.prepare(context, grant, SCHEMA)
            assert state["dispatch_count"] == 0
            assert provisioner.revoked and provisioner.removed
        finally:
            client.close()


def test_cancel_blocks_candidate_even_when_abort_or_cleanup_fails():
    with emulator() as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url, cleanup=True)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": name, "pattern": "*", "action": action} for name, action in config["permission"].items()]}]
        try:
            handle = runtime.prepare(context, grant, SCHEMA)
            runtime.submit(handle, {}, "dispatch")
            assert runtime.cancel(handle)["publication_forbidden"] is True
            with pytest.raises(AgentError, match="already_terminal"):
                runtime.collect(handle)
            with pytest.raises(AgentError, match="cleanup_unconfirmed"):
                runtime.dispose(handle)
            assert handle.cleanup == "failed" and provisioner.revoked
        finally:
            client.close()


def test_unknown_dispatch_is_observed_without_second_submit():
    with emulator(disconnect=True) as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": name, "pattern": "*", "action": action} for name, action in config["permission"].items()]}]
        try:
            handle = runtime.prepare(context, grant, SCHEMA)
            assert runtime.submit(handle, {}, "dispatch") == "unknown"
            assert runtime.inspect(handle) == "completed"
            assert runtime.collect(handle) == {"items": []}
            assert state["dispatch_count"] == 1
            runtime.dispose(handle)
        finally:
            client.close()


def test_agent_override_cannot_enable_shell_even_when_global_config_matches():
    with emulator() as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": "*", "pattern": "*", "action": "deny"},
            {"permission": "bash", "pattern": "*", "action": "allow"}]}]
        try:
            with pytest.raises(AgentError, match="runtime_tool_scoping_unsupported"):
                runtime.prepare(context, grant, SCHEMA)
            assert state["dispatch_count"] == 0 and provisioner.revoked and provisioner.removed
        finally:
            client.close()


def test_private_binding_restores_observation_without_dispatch_replay():
    with emulator(disconnect=True) as (url, state):
        runtime, provisioner, context, grant, config, client = prepared(url)
        state["config"] = config
        state["agents"] = [{"name": "bounded", "mode": "primary", "options": {}, "permission": [
            {"permission": name, "pattern": "*", "action": action} for name, action in config["permission"].items()]}]
        try:
            handle = runtime.prepare(context, grant, SCHEMA)
            assert runtime.submit(handle, {}, "dispatch") == "unknown"
            binding = runtime.binding(handle)
            assert not set(binding) & {"endpoint", "password", "token", "provider_key", "expected_config"}
            restored = PreparedRemoteRuntime(provisioner=provisioner, expected_config=config,
                model=runtime.model, agent="bounded", manifest=runtime.manifest,
                allowed_origins=["https://runtime.invalid"], enabled=True, client_factory=lambda _: client)
            observed = restored.restore(binding, context, grant)
            assert restored.collect(observed) == {"items": []}
            with pytest.raises(AgentError, match="duplicate_dispatch"):
                restored.submit(observed, {}, "second-dispatch")
            assert state["dispatch_count"] == 1
            assert restored.dispose(observed)["cleanup"] == "confirmed"
        finally:
            client.close()
