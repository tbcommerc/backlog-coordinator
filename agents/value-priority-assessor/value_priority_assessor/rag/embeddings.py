"""Общий кэш модели эмбеддингов.

Модель весит порядка гигабайта и загружается около четырнадцати секунд. Её
используют два независимых потребителя — поиск по корпусу и поиск аналогов для
Value, — и каждый раньше держал свою копию: двойной расход памяти и двойная
задержка на старте.

Модель не имеет состояния между вызовами, поэтому один экземпляр на процесс
безопасен.
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import Any


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embedding-warmup")
_futures: dict[str, Future[Any]] = {}
_futures_lock = Lock()


def _load_encoder(model_name: str) -> Any:
    from sentence_transformers import SentenceTransformer
    from value_priority_assessor.config import get_settings

    settings = get_settings()
    return SentenceTransformer(
        model_name,
        revision=settings.rag_embedding_revision,
        cache_folder=settings.rag_model_cache_dir or None,
        local_files_only=settings.rag_local_files_only,
    )


def start_encoder_warmup(model_name: str) -> Future[Any]:
    """Start one shared model load per process without blocking health checks."""
    with _futures_lock:
        future = _futures.get(model_name)
        if future is None:
            future = _executor.submit(_load_encoder, model_name)
            _futures[model_name] = future
        return future


def get_encoder(model_name: str) -> Any:
    """Return the shared encoder, waiting for the single warm-up when necessary."""
    return start_encoder_warmup(model_name).result()


def get_encoder_status(model_name: str) -> str:
    """Return a non-blocking readiness state for the shared encoder."""
    with _futures_lock:
        future = _futures.get(model_name)
    if future is None:
        return "not_started"
    if not future.done():
        return "loading"
    exception = future.exception()
    if exception is not None:
        return f"error:{type(exception).__name__}"
    return "ok"


def reset_encoders() -> None:
    with _futures_lock:
        _futures.clear()
