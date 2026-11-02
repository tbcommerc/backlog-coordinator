"""Coalesce concurrent identical LLM operations inside one process."""

from __future__ import annotations

import time
from concurrent.futures import Future
from dataclasses import dataclass
from threading import Lock
from typing import Callable, TypeVar


T = TypeVar("T")
_COMPLETED_TTL_SECONDS = 5.0


@dataclass
class _Flight:
    future: Future
    expires_at: float | None = None


_lock = Lock()
_flights: dict[str, _Flight] = {}


def run_singleflight(
    key: str,
    operation: Callable[[], T],
    *,
    retain_seconds: float = 0.0,
) -> tuple[T, bool]:
    """Run one owner operation; concurrent callers receive its exact result.

    The boolean is true for a shared result. A completed result remains in the
    process for a few seconds so a request arriving before the owner's database
    transaction commits cannot issue the same network call again.
    """
    now = time.monotonic()
    with _lock:
        expired = [
            flight_key
            for flight_key, flight in _flights.items()
            if flight.expires_at is not None and now >= flight.expires_at
        ]
        for flight_key in expired:
            _flights.pop(flight_key, None)

        flight = _flights.get(key)
        if flight is None:
            flight = _Flight(Future())
            _flights[key] = flight
            owner = True
        else:
            owner = False

    if not owner:
        return flight.future.result(), True

    try:
        result = operation()
    except BaseException as exc:
        flight.future.set_exception(exc)
        # Mark the exception as observed when there were no concurrent waiters.
        flight.future.exception()
        with _lock:
            if _flights.get(key) is flight:
                _flights.pop(key, None)
        raise

    flight.future.set_result(result)
    with _lock:
        if retain_seconds > 0:
            flight.expires_at = time.monotonic() + min(
                retain_seconds,
                _COMPLETED_TTL_SECONDS,
            )
        elif _flights.get(key) is flight:
            _flights.pop(key, None)
    return result, False


def reset_singleflight() -> None:
    """Clear process-local state between tests or controlled reloads."""
    with _lock:
        _flights.clear()
