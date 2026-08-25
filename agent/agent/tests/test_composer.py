from agent.composer.composer import build_draft, build_defect_draft, validate
from agent.context import UserContext
from agent.dialogue.state import DialogueState

FULL_SLOTS = {
    "intent": "feature",
    "need_statement": "Нужна автоматическая проверка расчётов по облигациям",
    "role": "Бэк-офицер",
    "process": "Расчёты",
    "product": "Облигации",
    "as_is": "Ручная сверка",
    "to_be": "Автоматическая сверка расчётов",
    "users": "Бэк-офицеры",
    "acceptance_criteria": "Система формирует отчёт о несостоявшихся расчётах",
    "data_integrations": "API расчётной системы",
    "value": "Снижение операционных рисков",
}


def _state(**kw):
    s = DialogueState()
    if kw.get("intent"):
        s.set("intent", kw["intent"])
    return s


def _full_state():
    s = _state(intent="feature")
    for k, v in FULL_SLOTS.items():
        s.set(k, v)
    return s


def test_build_draft_full():
    draft = build_draft(_full_state(), UserContext(user_id=9, name="Иван", role_name="Бизнес-заказчик"))
    assert draft.status == "Draft"
    assert draft.completeness_score >= 60
    assert draft.title
    assert draft.intent == "feature"
    assert draft.created_by["user_id"] == 9
    assert draft.quality_profile == "feature"
    assert 0 <= draft.quality_score <= 100


def test_draft_passes_validation():
    draft = build_draft(_full_state(), None)
    assert validate(draft) == []


def test_incomplete_draft_has_assumption():
    s = _state(intent="problem")
    s.set("need_statement", "Что-то сломано в расчётах")
    draft = build_draft(s, None)
    assert draft.completeness_score < 60
    assert any("предположение" in a for a in draft.assumptions)


def test_defect_draft_intent_incident():
    s = _state(intent="incident")
    s.set("need_statement", "Не работает выгрузка")
    draft = build_defect_draft(s, None)
    assert draft.intent == "incident"
    assert draft.priority == "Высокий"
