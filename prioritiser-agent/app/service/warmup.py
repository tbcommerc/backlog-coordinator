"""Non-blocking preparation of expensive read-only prioritiser indexes."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import Any

from app.config import get_settings


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="prioritiser-warmup")
_future: Future[dict[str, Any]] | None = None
_future_lock = Lock()


def _warm_runtime() -> dict[str, Any]:
    """Load exactly the indexes enabled by the current runtime configuration."""
    settings = get_settings()
    result: dict[str, Any] = {}

    if settings.strategy_use_rag and (
        settings.strategy_provider == "agent" or settings.dependency_provider == "agent"
    ):
        from app.rag.search import index_status

        result["rag"] = index_status().get("retrieval_mode", "unknown")

    if settings.value_analogy:
        from app.service.scenarios import _analogy_index
        from app.snapshot import get_snapshot

        index = _analogy_index(get_snapshot())
        result["analogy"] = "ok" if index is not None and index.available else "disabled"

    return result


def start_runtime_warmup() -> Future[dict[str, Any]]:
    """Start one complete index warm-up per process."""
    global _future
    with _future_lock:
        if _future is None:
            _future = _executor.submit(_warm_runtime)
        return _future


def get_runtime_warmup_status() -> str:
    """Return readiness without waiting for the background task."""
    with _future_lock:
        future = _future
    if future is None:
        return "not_started"
    if not future.done():
        return "loading"
    exception = future.exception()
    if exception is not None:
        return f"error:{type(exception).__name__}"
    return "ok"


def reset_runtime_warmup() -> None:
    """Reset process-local state for tests after configuration changes."""
    global _future
    with _future_lock:
        _future = None
