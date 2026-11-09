"""Transport-level runtime protocol; domain types stay in their services."""
from typing import Any, Generic, Protocol, TypeVar
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RuntimeCapabilities:
    contract_version: str
    structured_output: bool
    async_dispatch: bool
    inspect_delivery: bool
    cancel: bool
    cleanup: bool
    tool_scoping: bool
    usage_accounting: bool
    streaming: bool


@dataclass
class RuntimeHandle:
    session_id: str
    message_id: str
    schema: dict
    dispatch_ref: str | None = None
    delivery: str = "not_attempted"
    cancelled: bool = False
    cleanup: str = "pending"
    preparation_ref: str | None = None
    run_id: str | None = None


class RuntimePort(Protocol):
    def capabilities(self) -> RuntimeCapabilities: ...
    def prepare(self, run_context: dict, tool_grant: dict, result_schema: dict) -> RuntimeHandle: ...
    def submit(self, handle: RuntimeHandle, task: dict, dispatch_ref: str) -> str: ...
    def observe(self, handle: RuntimeHandle, cursor=None) -> list[dict]: ...
    def inspect(self, handle: RuntimeHandle) -> str: ...
    def collect(self, handle: RuntimeHandle) -> dict: ...
    def cancel(self, handle: RuntimeHandle, reason: str) -> dict: ...
    def dispose(self, handle: RuntimeHandle) -> dict: ...


HandleT = TypeVar("HandleT")
CandidateT = TypeVar("CandidateT")


class AsyncRuntimePort(Protocol[HandleT, CandidateT]):
    """Async counterpart; opaque handles and candidates remain service-owned."""
    def capabilities(self) -> RuntimeCapabilities: ...
    async def prepare(self, run_context: dict, tool_grant: Any, result_schema: dict) -> HandleT: ...
    async def submit(self, handle: HandleT, task: dict, dispatch_ref: str) -> str: ...
    async def observe(self, handle: HandleT, cursor=None) -> list[dict]: ...
    async def inspect(self, handle: HandleT) -> str: ...
    async def collect(self, handle: HandleT) -> CandidateT: ...
    async def cancel(self, handle: HandleT, reason: str = "user_cancel") -> Any: ...
    async def dispose(self, handle: HandleT) -> Any: ...
