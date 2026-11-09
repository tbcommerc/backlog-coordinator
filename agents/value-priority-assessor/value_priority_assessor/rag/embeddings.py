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
_futures: dict[tuple, Future[Any]] = {}
_futures_lock = Lock()


def _profile(model_name):
    from value_priority_assessor.config import get_settings
    settings=get_settings()
    return (model_name,settings.rag_embedding_revision,settings.rag_model_cache_dir or None,settings.rag_local_files_only)


def _load_encoder(model_name: str, profile=None) -> Any:
    from sentence_transformers import SentenceTransformer
    profile=profile or _profile(model_name)
    return SentenceTransformer(model_name, revision=profile[1], cache_folder=profile[2], local_files_only=profile[3])


def start_encoder_warmup(model_name: str) -> Future[Any]:
    """Start one shared model load per process without blocking health checks."""
    profile=_profile(model_name)
    with _futures_lock:
        future = _futures.get(profile)
        if future is None:
            future = _executor.submit(_load_encoder, model_name, profile)
            _futures[profile] = future
        return future


def get_encoder(model_name: str) -> Any:
    """Return the shared encoder, waiting for the single warm-up when necessary."""
    return start_encoder_warmup(model_name).result()


def get_encoder_status(model_name: str) -> str:
    """Return a non-blocking readiness state for the shared encoder."""
    profile=_profile(model_name)
    with _futures_lock:
        future = _futures.get(profile)
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
