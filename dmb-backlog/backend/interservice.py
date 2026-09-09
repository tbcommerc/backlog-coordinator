"""Bounded retries and an in-process circuit breaker for internal HTTP calls."""
from __future__ import annotations

import random
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


class CircuitOpenError(OSError):
    pass


@dataclass
class _Circuit:
    failures: int = 0
    opened_at: float | None = None


_circuits: dict[str, _Circuit] = {}
_lock = threading.Lock()


def request_with_resilience(
    service: str,
    request: urllib.request.Request,
    *,
    timeout: float,
    attempts: int,
    base_delay: float,
    failure_threshold: int,
    reset_seconds: float,
) -> bytes:
    attempts = max(1, attempts)
    with _lock:
        circuit = _circuits.setdefault(service, _Circuit())
        if circuit.opened_at is not None:
            if time.monotonic() - circuit.opened_at < reset_seconds:
                raise CircuitOpenError(f"{service} circuit is open")
            circuit.opened_at = None
            circuit.failures = 0

    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
            with _lock:
                circuit.failures = 0
                circuit.opened_at = None
            return body
        except urllib.error.HTTPError as exc:
            if exc.code not in {502, 503, 504}:
                with _lock:
                    circuit.failures = 0
                    circuit.opened_at = None
                raise
            error: Exception = exc
        except (OSError, TimeoutError) as exc:
            error = exc

        if attempt + 1 < attempts:
            delay = base_delay * (2 ** attempt) + random.uniform(0, base_delay)
            time.sleep(delay)

    with _lock:
        circuit.failures += 1
        if circuit.failures >= max(1, failure_threshold):
            circuit.opened_at = time.monotonic()
    raise error


def reset_circuits() -> None:
    with _lock:
        _circuits.clear()
