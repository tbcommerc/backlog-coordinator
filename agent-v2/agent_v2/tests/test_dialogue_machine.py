from agent_v2.dialogue.state import (
    DialogueState,
    MODE_EXPERT,
    PHASE_BUSINESS_CONTEXT,
    PHASE_DRAFT_READY,
    PHASE_NEED_STATEMENT,
    PHASE_SUMMARIZE,
)
from agent_v2.dialogue.machine import compute_phase, next_slot


def _st(**kw):
    state = DialogueState(**{k: v for k, v in kw.items() if k != "intent"})
    if kw.get("intent"):
        state.set("intent", kw["intent"])
    return state


def test_phase_progresses_through_need_statement():
    s = _st(intent="feature")
    assert compute_phase(s) == PHASE_NEED_STATEMENT
    s.set("need_statement", "Нужна новая функция")
    assert compute_phase(s) == PHASE_BUSINESS_CONTEXT


def test_next_slot_returns_required_first():
    s = _st(intent="problem")
    s.set("need_statement", "Проблема в процессе")
    assert next_slot(s) == "role"


def test_incident_path_is_short():
    s = _st(intent="incident")
    assert compute_phase(s) == PHASE_NEED_STATEMENT
    s.set("need_statement", "Не работает выгрузка")
    assert compute_phase(s) == "incident_triage"


def test_all_required_handled_reaches_summarize():
    s = _st(intent="feature")
    for key, val in {
        "need_statement": "Нужна новая функция",
        "role": "Бэк-офис",
        "process": "Расчёты",
        "product": "Облигации",
        "as_is": "Ручной контроль",
        "to_be": "Автоматический контроль",
        "users": "Бэк-офицеры",
        "scenarios": "Повторная отправка после неуспешного расчёта",
        "acceptance_criteria": "Оповещение при сбое",
        "data_integrations": "API расчётной системы",
        "value": "Экономия времени",
    }.items():
        s.set(key, val)
    assert compute_phase(s) == PHASE_SUMMARIZE


def test_draft_then_confirm_then_draft_ready():
    s = _st(intent="feature", draft={"id": "DRAFT-1"})
    assert compute_phase(s) == "confirm"
    s.confirmed = True
    assert compute_phase(s) == PHASE_DRAFT_READY


def test_expert_mode_uses_short_outcome_oriented_path():
    s = _st(intent="change")
    s.set_mode(MODE_EXPERT)
    for key, value in {
        "need_statement": "Ручная сверка занимает много времени",
        "role": "Бэк-офис",
        "process": "Расчёты",
        "to_be": "Автоматическая сверка",
        "acceptance_criteria": "Сверка завершается без ручных операций",
    }.items():
        s.set(key, value)

    assert compute_phase(s) == PHASE_SUMMARIZE
    assert not s.slots["product"].handled
    assert not s.slots["data_integrations"].handled
