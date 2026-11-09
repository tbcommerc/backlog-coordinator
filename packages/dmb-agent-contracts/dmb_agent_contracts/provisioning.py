"""External provisioning prerequisite, separate from the pinned OpenCode API."""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class IsolatedLease:
    lease_id: str
    run_id: str
    endpoint: str
    runtime_version: str
    image_digest: str
    expires_at: datetime
    workspace_ref: str
    state_ref: str
    credentials_ref: str
    config_hash: str
    tool_manifest_hash: str
    grant_refs: tuple[str, ...]
    isolation: str = "single_run"


class ProvisioningPort(Protocol):
    """Trusted deployment integration; these are NOT invented OpenCode endpoints.

    acquire is idempotent by run_id, including an unknown transport outcome.
    inspect independently verifies the immutable lease and resource ownership.
    revoke removes every per-run grant before disposal; dispose returns only a
    confirmed cleanup receipt, never infers it from an HTTP timeout or TTL.
    No method receives or returns the upstream model-provider key.
    """
    def acquire(self, run_context: dict, tool_grant: dict, manifest: dict) -> IsolatedLease: ...
    def inspect(self, lease: IsolatedLease) -> IsolatedLease: ...
    def revoke(self, lease: IsolatedLease) -> bool: ...
    def dispose(self, lease: IsolatedLease) -> dict: ...
    def recover(self, run_id: str) -> IsolatedLease | None: ...
