"""Slot extractor - deterministic structured data extraction from user answers.

Uses KB ontology + heuristics. Always extracts opportunistically (role,
product, module, process mentioned anywhere in the answer) and then targets
the current slot asked by the planner.

Returns confidence scores for each extraction:
- 0.95: exact match (ontology or keyword)
- 0.85: strong keyword match
- 0.70: weak keyword match
- 0.50: inferred from context
"""
import re

from ..kb.ontology import ontology
from .state import DialogueState, INTENTS
from .question_bank import QUESTIONS

_INTENT_RULES = [
    ("feature", ["новую функциональность", "новая функциональность", "функциональность", "новую возможность", "разработать", "feature", "доработка", "перекрасить", "перекраска", "цвет", "стиль", "дизайн", "добавить кнопку", "создать кнопку", "новая кнопка", "новый экран", "новая страница", "новый раздел", "хочу чтобы было", "хочу добавить", "нужно добавить", "было бы удобно", "можно ли сделать"]),
    ("change", ["изменение существующ", "изменить существующ", "изменени", "change", "модификаци", "скорректирова", "изменить цвет", "поменять цвет", "перекрасить в", "изменить кнопку", "поменять кнопку", "изменить расположение", "переместить"]),
    ("problem", ["проблем", "неудобств", "неудобно", "не устраива", "сложно", "долго", "вручную", "боль", "неудобн"]),
    ("clarification", ["разъясн", "уточни", "как работает", "что значит", "что означает", "что такое", "как понимать", "вопрос по", "поясн", "объясн", "расшифруй", "статус"]),
    ("incident", ["инцидент", "ошибк", "баг", "не работает", "падает", "сбой", "ошибка в работе", "не проходит", "failed", "не расчитал", "не загружает"]),
]

_ROLE_KEYWORDS = [
    ("бэк-офицер", ["бэк-офицер", "бэк офис", "back office", "back-office", "бэк-офис", "операционн"]),
    ("фронт-офицер", ["фронт-офицер", "фронт офис", "front office", "трейдер", "фронт-офис"]),
    ("риск-менеджер", ["риск-менеджер", "риск менеджер", "риск-аналитик", "risk"]),
    ("клиентский менеджер", ["клиентский менеджер", "клиентский менедж", "км"]),
    ("комплаенс", ["комплаенс", "compliance", "комплаенс-сотрудник"]),
    ("администратор платформы", ["администратор", "админ", "admin"]),
    ("казначейство", ["казначейств", "treasury"]),
]

_PRIORITY_RULES = [
    ("Высокий", ["срочно", "критично", "высокий приоритет", "важно", "горящий", "как можно быстрее", "сейчас"]),
    ("Низкий", ["низкий приоритет", "не срочно", "можно позже", "не горит", "когда-нибудь"]),
]


def _first_match(text: str, rules: list[tuple]) -> str | None:
    low = text.lower()
    for value, keywords in rules:
        for kw in keywords:
            if kw in low:
                return value
    return None


def _contains(text: str, *keywords) -> bool:
    low = text.lower()
    return any(k in low for k in keywords)


class SlotExtractor:
    def __init__(self):
        self.ontology = ontology

    def extract_intent(self, message: str) -> tuple[str | None, float]:
        low = message.strip().lower()
        for key, label in INTENTS.items():
            if low == key or low == label.lower():
                return key, 0.95
        result = _first_match(message, _INTENT_RULES)
        if result:
            return result, 0.85
        return None, 0.0

    def extract_role(self, message: str) -> tuple[str | None, float]:
        found = self.ontology.match_role(message)
        if found:
            return found, 0.95
        result = _first_match(message, _ROLE_KEYWORDS)
        if result:
            return result, 0.85
        return None, 0.0

    def extract_product(self, message: str) -> tuple[str | None, float]:
        result = self.ontology.match_product(message)
        if result:
            return result, 0.95
        return None, 0.0

    def extract_module(self, message: str) -> tuple[str | None, float]:
        result = self.ontology.match_module(message)
        if result:
            return result, 0.95
        return None, 0.0

    def extract_process(self, message: str) -> tuple[str | None, float]:
        result = self.ontology.match_process(message)
        if result:
            return result, 0.95
        return None, 0.0

    def extract_priority(self, message: str) -> tuple[str | None, float]:
        found = _first_match(message, _PRIORITY_RULES)
        if found:
            return found, 0.85
        if _contains(message, "приоритет"):
            low = message.lower()
            if "высок" in low:
                return "Высокий", 0.80
            if "низк" in low:
                return "Низкий", 0.80
        return None, 0.0

    def extract_department(self, message: str, ctx) -> tuple[str | None, float]:
        if ctx and ctx.department:
            return ctx.department, 0.90
        for name in ("дид", "дрг", "дрд", "дит", "дб", "убр", "дкп", "департамент"):
            if name in message.lower():
                return message.strip().upper(), 0.75
        return None, 0.0

    def opportunistic(self, state: DialogueState, message: str, ctx) -> dict:
        """Fill any still-empty context slots mentioned in the answer.
        
        Returns dict of {slot_key: (value, confidence)}.
        """
        updates = {}
        if not state.slots["role"].handled:
            v, conf = self.extract_role(message)
            if v:
                updates["role"] = (v, conf)
        if not state.slots["product"].handled:
            v, conf = self.extract_product(message)
            if v:
                updates["product"] = (v, conf)
        if not state.slots["module"].handled:
            v, conf = self.extract_module(message)
            if v:
                updates["module"] = (v, conf)
        if not state.slots["process"].handled:
            v, conf = self.extract_process(message)
            if v:
                updates["process"] = (v, conf)
        if not state.slots["priority"].handled:
            v, conf = self.extract_priority(message)
            if v:
                updates["priority"] = (v, conf)
        if not state.slots["department"].handled:
            v, conf = self.extract_department(message, ctx)
            if v:
                updates["department"] = (v, conf)
        updates.update(self._extract_semantic_details(state, message))
        return updates

    def _extract_semantic_details(self, state: DialogueState, message: str) -> dict:
        """Extract explicit business meaning from a rich free-form message.

        This intentionally uses only strong linguistic markers. It may leave a
        slot empty, but must not invent meaning merely to complete a checklist.
        """
        updates = {}
        text = " ".join(message.strip().split())
        low = text.lower()
        if len(text) < 18:
            return updates

        sentences = [part.strip(" ,.;:") for part in re.split(r"[.!?;\n]+", text) if part.strip()]

        def matching(markers):
            return [sentence for sentence in sentences
                    if any(marker in sentence.lower() for marker in markers)]

        candidates = {
            "as_is": matching(("сейчас", "сегодня", "вручную", "приходится", "текущий процесс")),
            "to_be": matching(("хотим", "нужно чтобы", "должен ", "должна ", "должно ",
                               "целевой", "ожидаем", "требуется возможность")),
            "value": matching(("чтобы сократить", "чтобы снизить", "чтобы ускорить",
                               "эконом", "эффект", "ценность", "избежать потерь")),
            "business_rules": matching(("только если", "только после", "нельзя", "запрещено",
                                         "обязательно", "при условии")),
            "data_integrations": matching(("интеграц", " api", "api ", "данные из", "выгрузк",
                                            "загрузк", "источник данных", "внешн")),
            "acceptance_criteria": matching(("в течение", "не позднее", "считаем выполненным",
                                              "критер", "приёмк", "приемк")),
        }
        for slot, parts in candidates.items():
            if parts and not state.slots[slot].handled:
                updates[slot] = ("; ".join(dict.fromkeys(parts))[:2000], 0.82)
        return updates

    def targeted(self, state: DialogueState, slot: str, message: str, ctx) -> tuple[str | None, float]:
        """Extract value for the specific slot the agent asked about.
        
        Returns tuple of (value, confidence).
        """
        if message.strip() == "__skip__":
            return None, 0.0
        if slot == "intent":
            return self.extract_intent(message)
        if slot == "role":
            v, conf = self.extract_role(message)
            if v:
                return v, conf
            return self._plain(message), 0.60
        if slot == "product":
            v, conf = self.extract_product(message)
            if v:
                return v, conf
            return self._plain(message), 0.60
        if slot == "module":
            v, conf = self.extract_module(message)
            if v:
                return v, conf
            return self._plain(message), 0.60
        if slot == "process":
            v, conf = self.extract_process(message)
            if v:
                return v, conf
            return self._plain(message), 0.60
        if slot == "priority":
            return self.extract_priority(message)
        if slot == "department":
            return self.extract_department(message, ctx)
        # free-text slots: accept the answer as-is
        return self._plain(message), 0.90

    @staticmethod
    def _plain(message: str) -> str:
        msg = message.strip()
        if len(msg) > 2000:
            msg = msg[:2000]
        return msg


extractor = SlotExtractor()
