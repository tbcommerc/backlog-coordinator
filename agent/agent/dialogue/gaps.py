"""Deterministic gap registry derived from dialogue and quality state."""
from __future__ import annotations

import hashlib

from .quality import QualityAssessment
from .state import DialogueState, Gap, SLOT_LABELS


TECHNICAL_SLOTS = {"data_integrations", "dependencies", "module"}


def _gap_id(category: str, slot: str, question: str) -> str:
    digest = hashlib.sha1(f"{category}|{slot}|{question}".encode("utf-8")).hexdigest()[:10]
    return f"gap-{digest}"


def synchronize_gaps(state: DialogueState, assessment: QualityAssessment) -> list[Gap]:
    """Refresh derived gaps while preserving explicit resolutions."""
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

    for key, slot in state.slots.items():
        if slot.status != "skipped":
            continue
        question = f"Не уточнено: {SLOT_LABELS.get(key, key)}"
        category = "technical" if key in TECHNICAL_SLOTS else "user_requirement"
        gap_id = _gap_id(category, key, question)
        candidates.append(Gap(
            id=gap_id, category=category, criticality="low",
            question=question, source="dialogue:skipped", slot=key,
            status="deferred",
        ))

    merged = []
    for gap in candidates:
        old = previous.get(gap.id)
        if old and old.status == "resolved":
            gap.status = old.status
            gap.resolution = old.resolution
        merged.append(gap)
    state.gaps = merged
    return merged
