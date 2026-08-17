from agent.dialogue.state import (
    DialogueState,
    PHASE_BUSINESS_CONTEXT,
    PHASE_DRAFT_READY,
    PHASE_NEED_STATEMENT,
    PHASE_SUMMARIZE,
)
from agent.dialogue.machine import compute_phase, next_slot


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
