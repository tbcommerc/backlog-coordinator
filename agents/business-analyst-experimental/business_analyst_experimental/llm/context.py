"""Request-local LLM conversation identity, independent of session storage."""
import hashlib
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator
from dmb_agent_contracts.operation import operation_scope


_conversation_id: ContextVar[str | None] = ContextVar("llm_conversation_id", default=None)


def current_llm_session() -> str | None:
    """Return an opaque provider identity without exposing the application ID."""
    return _conversation_id.get()


@contextmanager
def llm_session(session_id: str) -> Iterator[None]:
    opaque_id = "dmb-v2-" + hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    token = _conversation_id.set(opaque_id)
    try:
        with operation_scope():
            yield
    finally:
        _conversation_id.reset(token)
