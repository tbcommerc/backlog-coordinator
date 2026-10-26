from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


ALLOWED_OPERATIONS = frozenset({"add", "replace", "remove"})
PILOT_TASK_PATHS = frozenset({
    "/title",
    "/description",
    "/comment",
    "/link_mockups",
    "/link_requirements",
})
PROTECTED_PREFIXES = (
    "/priority",
    "/status",
    "/owner",
    "/user",
    "/role",
    "/team",
    "/dictionary",
    "/business_customer",
    "/department",
)


@dataclass(frozen=True)
class DiffValidationError:
    ordinal: int
    code: str
    path: str


def validate_operations(operations: Iterable[dict[str, Any]]) -> list[DiffValidationError]:
    errors: list[DiffValidationError] = []
    seen: set[int] = set()
    for raw in operations:
        ordinal = int(raw.get("ordinal", 0))
        op = str(raw.get("op", ""))
        path = str(raw.get("path", ""))
        if ordinal < 1 or ordinal in seen:
            errors.append(DiffValidationError(ordinal, "invalid_ordinal", path))
        seen.add(ordinal)
        if op not in ALLOWED_OPERATIONS:
            errors.append(DiffValidationError(ordinal, "operation_not_allowed", path))
        if path.startswith(PROTECTED_PREFIXES) or path not in PILOT_TASK_PATHS:
            errors.append(DiffValidationError(ordinal, "path_not_allowed", path))
        if not raw.get("evidence_refs"):
            errors.append(DiffValidationError(ordinal, "lineage_required", path))
        if not str(raw.get("rationale", "")).strip():
            errors.append(DiffValidationError(ordinal, "rationale_required", path))
    return errors


def aggregate_diff_status(decisions: Iterable[str]) -> str:
    values = list(decisions)
    if not values or all(value == "pending" for value in values):
        return "proposed"
    if all(value == "accepted" for value in values):
        return "accepted"
    if all(value == "rejected" for value in values):
        return "rejected"
    return "partially_accepted"
