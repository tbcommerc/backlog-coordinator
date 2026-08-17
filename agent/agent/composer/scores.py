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
    total = 0
    for key, weight in COMPLETENESS_WEIGHTS:
        slot = state.slots.get(key)
        if slot and slot.status == "filled" and slot.value:
            total += weight
    return min(100, total)


def confidence_level(state: DialogueState, completeness: int) -> str:
    open_count = len([q for q in state.slots.values()
                      if q.status == "skipped"])
    if completeness >= 80 and state.confirmed and open_count == 0:
        return "high"
    if completeness >= 60:
        return "medium"
    return "low"
