"""Small dependency-free Prometheus metrics registry for request latency."""

from __future__ import annotations

from collections import defaultdict
from threading import Lock


_lock = Lock()
_requests: dict[tuple[str, str, bool], int] = defaultdict(int)
_duration_ms: dict[tuple[str, str], int] = defaultdict(int)
_duration_count: dict[tuple[str, str], int] = defaultdict(int)
_phase_ms: dict[tuple[str, str], int] = defaultdict(int)
_phase_count: dict[tuple[str, str], int] = defaultdict(int)
_llm_calls = 0
_llm_retries = 0


def record_request(
    *,
    request_type: str,
    status: str,
    cached: bool,
    duration_ms: int,
    llm_calls: int = 0,
    phases: dict[str, int] | None = None,
) -> None:
    global _llm_calls
    with _lock:
        _requests[(request_type, status, cached)] += 1
        _duration_ms[(request_type, status)] += max(0, duration_ms)
        _duration_count[(request_type, status)] += 1
        _llm_calls += max(0, llm_calls)
        for phase, value in (phases or {}).items():
            _phase_ms[(request_type, phase)] += max(0, value)
            _phase_count[(request_type, phase)] += 1


def record_llm_retry() -> None:
    global _llm_retries
    with _lock:
        _llm_retries += 1


def render_prometheus() -> str:
    with _lock:
        requests = dict(_requests)
        duration_ms = dict(_duration_ms)
        duration_count = dict(_duration_count)
        phase_ms = dict(_phase_ms)
        phase_count = dict(_phase_count)
        llm_calls = _llm_calls
        llm_retries = _llm_retries

    lines = [
        "# HELP prioritiser_requests_total Completed prioritiser requests.",
        "# TYPE prioritiser_requests_total counter",
    ]
    for (request_type, status, cached), value in sorted(requests.items()):
        lines.append(
            "prioritiser_requests_total"
            f'{{request_type="{request_type}",status="{status}",'
            f'cached="{str(cached).lower()}"}} {value}'
        )
    lines.extend(
        [
            "# HELP prioritiser_request_duration_seconds Request wall time.",
            "# TYPE prioritiser_request_duration_seconds summary",
        ]
    )
    for labels, value in sorted(duration_ms.items()):
        request_type, status = labels
        suffix = f'{{request_type="{request_type}",status="{status}"}}'
        lines.append(
            f"prioritiser_request_duration_seconds_sum{suffix} {value / 1000:.6f}"
        )
        lines.append(
            f"prioritiser_request_duration_seconds_count{suffix} "
            f"{duration_count[labels]}"
        )
    lines.extend(
        [
            "# HELP prioritiser_phase_duration_seconds Internal phase wall time.",
            "# TYPE prioritiser_phase_duration_seconds summary",
        ]
    )
    for labels, value in sorted(phase_ms.items()):
        request_type, phase = labels
        suffix = f'{{request_type="{request_type}",phase="{phase}"}}'
        lines.append(
            f"prioritiser_phase_duration_seconds_sum{suffix} {value / 1000:.6f}"
        )
        lines.append(
            f"prioritiser_phase_duration_seconds_count{suffix} {phase_count[labels]}"
        )
    lines.extend(
        [
            "# HELP prioritiser_llm_calls_total Logical cache-miss LLM calls.",
            "# TYPE prioritiser_llm_calls_total counter",
            f"prioritiser_llm_calls_total {llm_calls}",
            "# HELP prioritiser_llm_retries_total Retried transient HTTP calls.",
            "# TYPE prioritiser_llm_retries_total counter",
            f"prioritiser_llm_retries_total {llm_retries}",
        ]
    )
    return "\n".join(lines) + "\n"


def reset_metrics() -> None:
    global _llm_calls, _llm_retries
    with _lock:
        _requests.clear()
        _duration_ms.clear()
        _duration_count.clear()
        _phase_ms.clear()
        _phase_count.clear()
        _llm_calls = 0
        _llm_retries = 0
