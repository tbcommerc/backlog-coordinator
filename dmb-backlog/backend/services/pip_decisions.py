"""Read-only helpers for the cross-stage PI decision context."""

import json
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import TaskHistory, User


PIP_DECISIONS = frozenset({"accept", "rework", "reject"})


def parse_pip_decision(value: Optional[str]) -> Optional[dict]:
    """Parse a structured ``task_history.pip_decision`` value safely."""
    if not value:
        return None
    try:
        payload = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None

    decision = str(payload.get("decision") or "").strip().lower()
    if decision not in PIP_DECISIONS:
        return None
    reason = str(payload.get("reason") or "").strip() or None
    return {"decision": decision, "reason": reason}


def load_latest_pip_decisions(db: Session, task_ids: Iterable[int]) -> dict[int, dict]:
    """Load the latest PI decision for every requested task in one query."""
    normalized_ids = sorted({int(task_id) for task_id in task_ids if task_id is not None})
    if not normalized_ids:
        return {}

    ranked = db.query(
        TaskHistory.task_id.label("task_id"),
        TaskHistory.new_value.label("new_value"),
        TaskHistory.changed_at.label("changed_at"),
        TaskHistory.changed_by.label("changed_by"),
        func.row_number().over(
            partition_by=TaskHistory.task_id,
            order_by=(TaskHistory.changed_at.desc(), TaskHistory.id.desc()),
        ).label("row_number"),
    ).filter(
        TaskHistory.task_id.in_(normalized_ids),
        TaskHistory.field_name == "pip_decision",
    ).subquery()

    rows = db.query(
        ranked.c.task_id,
        ranked.c.new_value,
        ranked.c.changed_at,
        User.name.label("decided_by_name"),
    ).outerjoin(
        User,
        User.id == ranked.c.changed_by,
    ).filter(
        ranked.c.row_number == 1,
    ).all()

    result = {}
    for row in rows:
        parsed = parse_pip_decision(row.new_value)
        if not parsed:
            continue
        result[int(row.task_id)] = {
            **parsed,
            "decided_at": row.changed_at,
            "decided_by_name": row.decided_by_name,
        }
    return result
