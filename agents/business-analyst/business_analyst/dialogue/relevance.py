"""Deterministic relevance gate for answers to the currently asked slot."""
from dataclasses import dataclass
import re

from .quality import acceptance_is_measurable


@dataclass
class RelevanceDecision:
    relevant: bool
    confidence: float
    reason: str


OFF_TOPIC_PATTERNS = (
    r"\bперевед\w*\s+(?:слово|фразу)", r"\bрасскаж\w*\s+(?:шутк|анекдот)",
    r"\bспой\w*", r"\bнапиши\w*\s+(?:стих|рецепт)", r"\bкакая\s+погода",
    r"\bкто\s+выиграл", r"\bкурс\s+(?:биткоин|доллар|евро)",
)

SLOT_MARKERS = {
    "role": ("пользовател", "сотрудник", "оператор", "офицер", "менеджер", "аналитик", "администратор", "комплаенс"),
    "users": ("пользовател", "сотрудник", "оператор", "офицер", "менеджер", "аналитик", "администратор", "комплаенс"),
    "department": ("отдел", "департамент", "управлен", "команд", "офис", "подразделен"),
    "process": ("процесс", "расч", "клиринг", "марж", "отчёт", "отчет", "сделк", "учёт", "учет", "сверк"),
    "product": ("облигац", "акци", "паи", "репо", "пфи", "валют", "продукт", "инструмент"),
    "module": ("модул", "сделк", "расч", "лимит", "отчёт", "отчет", "справочник", "карточк", "реестр"),
    "as_is": ("сейчас", "сегодня", "вручную", "приходится", "текущ", "не работает", "проблем"),
    "to_be": ("долж", "хотим", "нужно", "требуется", "будет", "автомат", "добав", "показы", "вывод"),
    "value": ("сократ", "сниз", "ускор", "эконом", "риск", "ошиб", "контрол", "ценност", "эффект"),
    "data_integrations": ("данн", "api", "интеграц", "систем", "выгруз", "загруз", "справочник", "файл"),
    "business_rules": ("только", "нельзя", "обяз", "запрещ", "услов", "правил", "провер",
                       "цвет", "зелён", "зелен", "красн", "син", "кнопк", "дизайн"),
    "scenarios": ("сценар", "когда", "если", "после", "пользователь", "действ"),
    "dependencies": ("завис", "команд", "систем", "релиз", "доработ"),
    "risks": ("риск", "ошиб", "потер", "наруш", "последств"),
    "regulatory_flags": ("регулятор", "комплаенс", "риск", "aml", "kyc", "огранич"),
}


def assess_answer(slot: str, message: str) -> RelevanceDecision:
    low = " ".join((message or "").lower().split())
    if not low or low in {".", "..", "...", "-", "ок", "хз"}:
        return RelevanceDecision(False, 0.0, "empty_or_low_information")
    if any(re.search(pattern, low) for pattern in OFF_TOPIC_PATTERNS):
        return RelevanceDecision(False, 0.98, "explicit_off_topic_command")
    if slot == "intent":
        return RelevanceDecision(True, 0.7, "intent_is_classified_separately")
    if slot == "need_statement":
        relevant = len(low.split()) >= 4
        return RelevanceDecision(relevant, 0.65 if relevant else 0.2, "need_statement_length")
    if slot == "acceptance_criteria":
        relevant = acceptance_is_measurable(low)
        return RelevanceDecision(relevant, 0.9 if relevant else 0.35, "acceptance_observability")
    if slot == "priority":
        relevant = any(marker in low for marker in ("высок", "средн", "низк", "сроч", "приоритет"))
        return RelevanceDecision(relevant, 0.9 if relevant else 0.2, "priority_markers")
    markers = SLOT_MARKERS.get(slot)
    if markers:
        relevant = any(marker in low for marker in markers)
        return RelevanceDecision(relevant, 0.8 if relevant else 0.3, "slot_semantic_markers")
    relevant = len(low.split()) >= 2
    return RelevanceDecision(relevant, 0.6 if relevant else 0.25, "generic_content")
