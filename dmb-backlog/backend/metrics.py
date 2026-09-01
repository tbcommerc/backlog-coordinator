"""Small dependency-free Prometheus exporter for operational signals."""
from __future__ import annotations

import math
import threading
from collections import defaultdict
from datetime import datetime, timezone


_lock = threading.RLock()
_counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
_gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
_histograms: dict[tuple[str, tuple[tuple[str, str], ...]], dict] = {}
_DEFAULT_BUCKETS = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)


def _labels(labels: dict | None) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((str(key), str(value)) for key, value in (labels or {}).items()))


def inc_counter(name: str, amount: float = 1.0, labels: dict | None = None) -> None:
    with _lock:
        _counters[(name, _labels(labels))] += amount


def set_gauge(name: str, value: float, labels: dict | None = None) -> None:
    with _lock:
        _gauges[(name, _labels(labels))] = float(value)


def add_gauge(name: str, amount: float, labels: dict | None = None) -> None:
    key = (name, _labels(labels))
    with _lock:
        _gauges[key] = _gauges.get(key, 0.0) + float(amount)


def observe_histogram(name: str, value: float, labels: dict | None = None) -> None:
    key = (name, _labels(labels))
    with _lock:
        item = _histograms.setdefault(key, {
            "buckets": [0 for _ in _DEFAULT_BUCKETS],
            "count": 0,
            "sum": 0.0,
        })
        item["count"] += 1
        item["sum"] += float(value)
        for index, upper in enumerate(_DEFAULT_BUCKETS):
            if value <= upper:
                item["buckets"][index] += 1


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _format_labels(labels: tuple[tuple[str, str], ...], extra: tuple[str, str] | None = None) -> str:
    values = list(labels)
    if extra:
        values.append(extra)
    if not values:
        return ""
    return "{" + ",".join(f'{key}="{_escape(value)}"' for key, value in values) + "}"


def collect_runtime_gauges() -> None:
    """Collect shared-state gauges at scrape time without mutating business data."""
    try:
        from sqlalchemy import func
        from database import SessionLocal, engine
        from models import EventOutbox

        db = SessionLocal()
        try:
            pending_query = db.query(EventOutbox).filter(
                EventOutbox.processed_at.is_(None),
                EventOutbox.dead_lettered_at.is_(None),
            )
            pending = pending_query.count()
            oldest = pending_query.with_entities(func.min(EventOutbox.created_at)).scalar()
            dead = db.query(EventOutbox).filter(EventOutbox.dead_lettered_at.is_not(None)).count()
        finally:
            db.close()
        set_gauge("dmb_outbox_pending", pending)
        set_gauge("dmb_outbox_dead_letter", dead)
        if oldest is None:
            age = 0
        else:
            now = datetime.now(timezone.utc) if oldest.tzinfo else datetime.utcnow()
            age = max(0, (now - oldest).total_seconds())
        set_gauge("dmb_outbox_oldest_pending_seconds", age)
        set_gauge("dmb_dependency_up", 1, {"dependency": "database"})

        pool = engine.pool
        for metric_name, attr in (
            ("dmb_db_pool_checked_out", "checkedout"),
            ("dmb_db_pool_checked_in", "checkedin"),
            ("dmb_db_pool_overflow", "overflow"),
        ):
            getter = getattr(pool, attr, None)
            if callable(getter):
                set_gauge(metric_name, getter())
    except Exception:
        set_gauge("dmb_dependency_up", 0, {"dependency": "database"})
        inc_counter("dmb_metrics_collection_errors_total")


def render_prometheus() -> str:
    collect_runtime_gauges()
    lines: list[str] = []
    with _lock:
        counters = list(_counters.items())
        gauges = list(_gauges.items())
        histograms = list(_histograms.items())

    counter_names = sorted({name for (name, _), _value in counters})
    gauge_names = sorted({name for (name, _), _value in gauges})
    histogram_names = sorted({name for (name, _), _value in histograms})
    for name in counter_names:
        lines.append(f"# TYPE {name} counter")
        for (metric_name, labels), value in sorted(counters):
            if metric_name == name:
                lines.append(f"{name}{_format_labels(labels)} {value:g}")
    for name in gauge_names:
        lines.append(f"# TYPE {name} gauge")
        for (metric_name, labels), value in sorted(gauges):
            if metric_name == name:
                lines.append(f"{name}{_format_labels(labels)} {value:g}")
    for name in histogram_names:
        lines.append(f"# TYPE {name} histogram")
        for (metric_name, labels), item in sorted(histograms):
            if metric_name != name:
                continue
            for upper, count in zip(_DEFAULT_BUCKETS, item["buckets"]):
                lines.append(f"{name}_bucket{_format_labels(labels, ('le', str(upper)))} {count}")
            lines.append(f"{name}_bucket{_format_labels(labels, ('le', '+Inf'))} {item['count']}")
            lines.append(f"{name}_count{_format_labels(labels)} {item['count']}")
            value_sum = item["sum"]
            lines.append(f"{name}_sum{_format_labels(labels)} {value_sum if math.isfinite(value_sum) else 0:g}")
    return "\n".join(lines) + "\n"
