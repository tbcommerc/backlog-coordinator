"""Deterministic readiness policies; the model never sets readiness."""
from __future__ import annotations

from ..dialogue.state import DialogueState, value_status
from .fingerprint import canonical_fingerprint
from .models import ReadinessResult


def _handled(state: DialogueState, key: str) -> bool:
    slot = state.slots.get(key)
    return bool(slot and (value_status(slot.value) == "filled" or slot.status in {
        "filled", "unknown", "not_specified", "not_applicable", "known_none", "deferred",
    }))


def _critical_gap_or_conflict(state: DialogueState) -> bool:
    conflict = any(
        item.get("status", "open") == "open"
        and item.get("severity", item.get("criticality", "")) in {"critical", "high"}
        for item in state.requirement_conflicts
    )
    gap = any(
        item.status == "open" and item.criticality in {"critical", "high"}
        for item in state.gaps
    )
    return conflict or gap


def _acceptance_is_checkable(state: DialogueState) -> bool:
    value = state.get("acceptance_criteria")
    if not value:
        return False
    criteria = value if isinstance(value, list) else str(value).replace("\n", ";").split(";")
    normalized = [str(item).strip() for item in criteria if str(item).strip()]
    return bool(normalized) and all(
        len(item) >= 15 and len(item.split()) >= 3 for item in normalized
    )


def assignment_readiness(state: DialogueState) -> ReadinessResult:
    blocking: list[str] = []
    source = state.source_context or {}
    if not source.get("source_type"):
        blocking.append("source_type_missing")
    if not source.get("channel"):
        blocking.append("source_channel_missing")
    for key in (
        "assignment_statement", "business_goal", "expected_result", "scope_in",
        "originator", "deadline_or_urgency", "owner_next_step",
    ):
        if not _handled(state, key):
            blocking.append(f"{key}_missing")
    if _critical_gap_or_conflict(state):
        blocking.append("critical_gap_or_conflict_open")
    if not state.final_summary_confirmed:
        blocking.append("final_summary_not_confirmed")
    warnings = [
        f"{key}_open" for key in ("scope_out", "stakeholders", "constraints", "initial_risks")
        if not _handled(state, key)
    ]
    return ReadinessResult(ready=not blocking, blocking_codes=blocking, warning_codes=warnings)


def requirement_readiness(state: DialogueState, draft: dict | None = None) -> ReadinessResult:
    blocking: list[str] = []
    for key in (
        "need_statement", "business_goal", "as_is", "to_be", "scope_in", "scope_out",
        "role", "process", "scenarios", "acceptance_criteria",
    ):
        if not _handled(state, key):
            blocking.append(f"{key}_missing")
    for key in ("business_rules", "dependencies", "risks"):
        if not _handled(state, key):
            blocking.append(f"{key}_not_declared")
    if not _acceptance_is_checkable(state):
        blocking.append("acceptance_criteria_not_checkable")
    if _critical_gap_or_conflict(state):
        blocking.append("critical_gap_or_conflict_open")
    for key in ("need_statement", "business_goal", "to_be", "scope_in", "scenarios", "acceptance_criteria"):
        slot = state.slots.get(key)
        if slot and slot.status == "filled" and (slot.assumption or not (slot.evidence or slot.provenance)):
            blocking.append(f"{key}_provenance_invalid")
    if not state.final_summary_confirmed:
        blocking.append("final_summary_not_confirmed")
    if draft is not None:
        fingerprint = draft.get("fingerprint")
        if not fingerprint:
            blocking.append("fingerprint_missing")
        elif fingerprint != canonical_fingerprint(draft):
            blocking.append("fingerprint_invalid")
    optional = (
        "alternative_scenarios", "exception_scenarios", "data_integrations",
        "non_functional_requirements", "success_metrics", "constraints", "stakeholders",
    )
    warnings = [f"{key}_open" for key in optional if not _handled(state, key)]
    return ReadinessResult(
        ready=not list(dict.fromkeys(blocking)),
        blocking_codes=list(dict.fromkeys(blocking)),
        warning_codes=warnings,
    )
