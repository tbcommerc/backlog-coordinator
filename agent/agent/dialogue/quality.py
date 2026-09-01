"""Business-requirement quality model, separate from slot completeness."""
from dataclasses import dataclass, field
import re

from .state import DialogueState, SLOT_LABELS


QUALITY_PROFILES = {
    "feature": {
        "required": ["need_statement", "role", "process", "to_be", "scenarios", "acceptance_criteria", "value"],
        "recommended": ["product", "module", "data_integrations", "regulatory_flags", "risks"],
    },
    "change": {
        "required": ["need_statement", "role", "process", "as_is", "to_be", "acceptance_criteria"],
        "recommended": ["product", "module", "data_integrations", "dependencies", "value", "risks"],
    },
    "problem": {
        "required": ["need_statement", "role", "process", "as_is", "to_be", "acceptance_criteria", "value"],
        "recommended": ["product", "module", "scenarios", "risks"],
    },
    "incident": {
        "required": ["need_statement"],
        "recommended": ["role", "module", "product", "data_integrations"],
    },
    "clarification": {
        "required": ["need_statement"],
        "recommended": ["role", "process"],
    },
}

SLOT_PHASE = {
    "intent": "identify_intent", "need_statement": "need_statement",
    "role": "business_context", "process": "business_context", "product": "business_context",
    "module": "business_context", "as_is": "as_is_to_be", "to_be": "as_is_to_be",
    "users": "roles_scenarios", "scenarios": "roles_scenarios",
    "business_rules": "business_rules", "acceptance_criteria": "business_rules",
    "data_integrations": "data_integrations", "dependencies": "data_integrations",
    "risks": "data_integrations", "value": "value_priority", "priority": "value_priority",
    "regulatory_flags": "value_priority",
}

MEASURABLE_MARKERS = (
    "в течение", "не позднее", "не более", "не менее", "при условии", "если ",
    "когда ", "отображается", "формируется", "сохраняется", "запрещено", "доступно",
)
VAGUE_MARKERS = ("удобно", "быстро", "корректно", "качественно", "оптимально", "гибко")
NON_VALUE_MARKERS = (
    "требование руководства", "поручение руководства", "надо сделать",
    "попросило руководство", "решение руководства",
)


@dataclass
class QualityIssue:
    code: str
    message: str
    severity: str = "warning"
    slot: str = ""
    question: str = ""

    def as_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class QualityAssessment:
    score: int
    level: str
    profile: str
    issues: list[QualityIssue] = field(default_factory=list)
    conflicts: list[QualityIssue] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "level": self.level,
            "profile": self.profile,
            "issues": [i.as_dict() for i in self.issues],
            "conflicts": [i.as_dict() for i in self.conflicts],
        }


def profile_for(state: DialogueState) -> dict:
    return QUALITY_PROFILES.get(state.get("intent") or "problem", QUALITY_PROFILES["problem"])


def required_slots_for_phase(state: DialogueState, phase: str) -> list[str]:
    slots = ["intent"] if phase == "identify_intent" else []
    slots.extend(slot for slot in profile_for(state)["required"] if SLOT_PHASE.get(slot) == phase)
    return list(dict.fromkeys(slots))


def acceptance_is_measurable(value: str) -> bool:
    low = (value or "").lower()
    return bool(re.search(r"\d", low) or any(marker in low for marker in MEASURABLE_MARKERS)) \
        and not (len(low.split()) <= 4 and any(marker in low for marker in VAGUE_MARKERS))


def business_value_is_effect(value: str) -> bool:
    low = (value or "").strip().lower()
    return bool(low) and not any(marker in low for marker in NON_VALUE_MARKERS)


def _conflicts(state: DialogueState) -> list[QualityIssue]:
    conflicts = []
    as_is = (state.get("as_is") or "").strip().lower()
    to_be = (state.get("to_be") or "").strip().lower()
    if as_is and to_be and re.sub(r"\W+", " ", as_is) == re.sub(r"\W+", " ", to_be):
        conflicts.append(QualityIssue(
            "as_is_equals_to_be", "As-Is и To-Be описаны одинаково.", "critical", "to_be",
            "Чем целевое состояние должно отличаться от текущего процесса?",
        ))
    integrations = (state.get("data_integrations") or "").lower()
    combined = " ".join((state.get("need_statement") or "", to_be)).lower()
    if any(x in integrations for x in ("нет интеграц", "без интеграц")) and any(
        x in combined for x in (" api", "api ", "интеграц", "данные из", "внешн")
    ):
        conflicts.append(QualityIssue(
            "integration_conflict", "Описание одновременно требует и исключает интеграцию.",
            "critical", "data_integrations", "Нужен ли обмен данными с внешней системой?",
        ))
    return conflicts


def assess_quality(state: DialogueState) -> QualityAssessment:
    intent = state.get("intent") or "problem"
    profile = profile_for(state)
    issues = []
    required = profile["required"]
    recommended = profile["recommended"]

    required_filled = 0
    for slot in required:
        if state.get(slot):
            required_filled += 1
        else:
            issues.append(QualityIssue(
                "missing_required", f"Не раскрыто: {SLOT_LABELS.get(slot, slot)}.",
                "critical", slot, f"Уточните: {SLOT_LABELS.get(slot, slot)}.",
            ))
    recommended_filled = sum(1 for slot in recommended if state.get(slot))
    score = int(75 * required_filled / max(1, len(required)) + 25 * recommended_filled / max(1, len(recommended)))

    criteria = state.get("acceptance_criteria") or ""
    if criteria and not acceptance_is_measurable(criteria):
        issues.append(QualityIssue(
            "acceptance_not_measurable", "Критерии приёмки сформулированы непроверяемо.",
            "warning", "acceptance_criteria",
            "Какое наблюдаемое условие или показатель подтвердит выполнение требования?",
        ))
        score = max(0, score - 10)

    value = state.get("value") or ""
    if value and not business_value_is_effect(value):
        issues.append(QualityIssue(
            "value_is_driver_not_effect",
            "Указан источник инициативы, но не раскрыт ожидаемый бизнес-эффект.",
            "warning", "value",
            "Какой бизнес-эффект даст изменение или какой риск оно снизит?",
        ))
        score = max(0, score - 10)

    conflicts = _conflicts(state)
    score = max(0, score - 20 * len(conflicts))
    level = "high" if score >= 80 and not conflicts else "medium" if score >= 55 else "low"
    return QualityAssessment(score, level, intent, issues, conflicts)
