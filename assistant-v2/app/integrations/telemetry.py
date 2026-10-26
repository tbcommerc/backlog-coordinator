from __future__ import annotations

import threading
import time
from collections import Counter


_lock = threading.Lock()
_requests: Counter[tuple[str, str, str]] = Counter()
_latency_seconds: Counter[tuple[str, str]] = Counter()


def monotonic() -> float:
    return time.monotonic()


def observe_http(*, method: str, operation: str, status: int, elapsed_seconds: float) -> None:
    # operation is the bounded FastAPI route template, never a concrete URL/ID.
    method_label = method.upper() if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"} else "OTHER"
    status_label = f"{max(1, min(5, status // 100))}xx"
    operation_label = operation if operation.startswith("/") else "unmatched"
    with _lock:
        _requests[(method_label, operation_label, status_label)] += 1
        _latency_seconds[(method_label, operation_label)] += max(0.0, elapsed_seconds)


def render_prometheus() -> str:
    lines = [
        "# HELP assistant_v2_http_requests_total HTTP requests by bounded route template.",
        "# TYPE assistant_v2_http_requests_total counter",
    ]
    with _lock:
        request_items = sorted(_requests.items())
        latency_items = sorted(_latency_seconds.items())
    for (method, operation, status), value in request_items:
        lines.append(
            f'assistant_v2_http_requests_total{{method="{method}",operation="{operation}",status="{status}"}} {value}'
        )
    lines.extend([
        "# HELP assistant_v2_http_request_duration_seconds_sum Accumulated HTTP duration by bounded route template.",
        "# TYPE assistant_v2_http_request_duration_seconds_sum counter",
    ])
    for (method, operation), value in latency_items:
        lines.append(
            f'assistant_v2_http_request_duration_seconds_sum{{method="{method}",operation="{operation}"}} {value:.6f}'
        )
    return "\n".join(lines) + "\n"
