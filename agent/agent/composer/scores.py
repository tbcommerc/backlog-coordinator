"""Completeness and confidence scoring.

Completeness uses the weighted blocks from the spec (problem, target result,
role, process, product, acceptance criteria, modules/data impact,
value/priority, regulatory flags). Confidence reflects how well confirmed and
how few open questions remain.
"""
from ..dialogue.state import DialogueState

# (slot, weight)
COMPLETENESS_WEIGHTS = [
    ("need_statement", 15),   # проблема описана
    ("to_be", 15),            # целевой результат
    ("role", 10),             # определена роль
    ("process", 10),          # определён процесс
    ("product", 10),          # продукт / тип сделок
    ("acceptance_criteria", 15),  # acceptance criteria
    ("module", 10),           # влияние на модули/данные
    ("value", 10),            # приоритет / ценность
    ("regulatory_flags", 5),  # регуляторные флаги
]

MIN_COMPLETENESS = 60


def completeness_score(state: DialogueState) -> int:
    total = 0.0
    for key, weight in COMPLETENESS_WEIGHTS:
        slot = state.slots.get(key)
        if slot and slot.status == "filled" and slot.value:
            # Presence alone is not full completeness: inferred or uncertain
            # content receives only part of the section weight.
            confidence = max(0.0, min(1.0, float(slot.confidence)))
            factor = 0.55 + 0.35 * confidence
            if slot.confirmed or state.confirmed:
                factor += 0.10
            if slot.assumption:
                factor -= 0.20
            total += weight * max(0.25, min(1.0, factor))
    return min(100, round(total))


def confidence_level(state: DialogueState, completeness: int) -> str:
    relevant = [state.slots[key] for key, _ in COMPLETENESS_WEIGHTS
                if state.slots.get(key) and state.slots[key].status == "filled"]
    if not relevant:
        return "low"
    average = sum(slot.confidence for slot in relevant) / len(relevant)
    assumptions = sum(1 for slot in relevant if slot.assumption)
    low_confidence = sum(1 for slot in relevant if slot.confidence < 0.7)
    open_count = sum(1 for slot in state.slots.values() if slot.status == "skipped")
    if completeness >= 80 and state.confirmed and open_count == 0 \
            and assumptions == 0 and low_confidence == 0 and average >= 0.85:
        return "high"
    if completeness >= 55 and average >= 0.6 and assumptions <= 1:
        return "medium"
    return "low"
