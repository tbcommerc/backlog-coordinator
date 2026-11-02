"""Deterministic gap registry derived from dialogue and quality state."""
from __future__ import annotations

import hashlib

from .quality import QualityAssessment, split_criteria
from .state import DialogueState, Gap, SLOT_LABELS


TECHNICAL_SLOTS = {"data_integrations", "dependencies", "module"}


def _gap_id(category: str, slot: str, question: str) -> str:
    digest = hashlib.sha1(f"{category}|{slot}|{question}".encode("utf-8")).hexdigest()[:10]
    return f"gap-{digest}"


def synchronize_gaps(state: DialogueState, assessment: QualityAssessment) -> list[Gap]:
    """One registry for quality issues, unknown answers, exclusions and questions.

    A still-failing derived check reopens its gap. Explicit N/A is a resolved
    applicability decision, not an unanswered question and not an empty field.
    """
    previous = {gap.id: gap for gap in state.gaps}
    candidates: list[Gap] = []

    for issue in assessment.issues + assessment.conflicts:
        question = issue.question or issue.message
        category = "technical" if issue.slot in TECHNICAL_SLOTS else "quality"
        criticality = "high" if issue.severity == "critical" else "medium"
        gap_id = _gap_id(category, issue.slot, question)
        candidates.append(Gap(
            id=gap_id, category=category, criticality=criticality,
            question=question, source=f"quality:{issue.code}", slot=issue.slot,
        ))

    issue_slots = {issue.slot for issue in assessment.issues if issue.code == "missing_required"}
    for key, slot in state.slots.items():
        if key == "open_questions":
            continue
        if slot.status == "not_applicable":
            question = f"Применимость: {SLOT_LABELS.get(key, key)}"
            category = "technical" if key in TECHNICAL_SLOTS else "user_requirement"
            candidates.append(Gap(
                id=_gap_id(category, key, question), category=category, criticality="low",
                question=question, source="dialogue:not_applicable", slot=key,
                status="resolved", resolution=str(slot.value or "Не применимо"),
            ))
            continue
        if slot.status not in {"skipped", "unknown"} or key in issue_slots:
            continue
        question = f"Не уточнено: {SLOT_LABELS.get(key, key)}"
        category = "technical" if key in TECHNICAL_SLOTS else "user_requirement"
        gap_id = _gap_id(category, key, question)
        candidates.append(Gap(
            id=gap_id, category=category, criticality="low",
            question=question, source=f"dialogue:{slot.status}", slot=key,
            status="deferred" if slot.status == "skipped" else "open",
        ))

    for key in ("dependencies", "risks", "regulatory_flags"):
        if state.slots[key].status == "empty":
            question = f"Требуется уточнение: {SLOT_LABELS.get(key, key)}"
            category = "technical" if key in TECHNICAL_SLOTS else "user_requirement"
            candidates.append(Gap(
                id=_gap_id(category, key, question), category=category, criticality="low",
                question=question, source="dialogue:empty", slot=key,
            ))
    for question in split_criteria(state.get("open_questions")):
        candidates.append(Gap(
            id=_gap_id("user_requirement", "open_questions", question),
            category="user_requirement", criticality="medium", question=question,
            source="dialogue:explicit_question", slot="open_questions",
        ))
    for item in getattr(state, "requirement_assumptions", []):
        if item.get("status", "open") == "resolved" or not item.get("text"):
            continue
        key = item.get("slot") or item.get("field", "")
        question = f"Проверить допущение: {item['text']}"
        candidates.append(Gap(
            id=_gap_id("quality", key, question), category="quality", criticality="medium",
            question=question, source="dialogue:assumption", slot=key,
        ))

    merged = []
    for gap in candidates:
        old = previous.get(gap.id)
        if old and old.status == "resolved" and gap.source == "dialogue:explicit_question":
            gap.status = old.status
            gap.resolution = old.resolution
        if not any(item.id == gap.id for item in merged):
            merged.append(gap)
    state.gaps = merged
    return merged
