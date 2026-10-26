"""Behavioural regressions for editing and submitting without a layout change."""
import pytest

from agent_v2.agentic_orchestrator import AgenticOrchestrator
from agent_v2.composer.composer import build_draft
from agent_v2.dialogue.agentic import Fact, LLMUnavailable, TurnDecision
from agent_v2.dialogue.state import DialogueState
from agent_v2.session import SessionStore


CORE = {
    "need_statement": "Нужна автоматическая сверка расчётов",
    "to_be": "Система сверяет расчёты и показывает расхождения",
    "role": "Оператор",
    "process": "Сверка расчётов",
}


@pytest.fixture
def workflow(tmp_path, monkeypatch):
    orch = AgenticOrchestrator(SessionStore(str(tmp_path / "sessions.db")))
    monkeypatch.setattr(orch, "_prepare_summary", lambda state, ctx: setattr(state, "summary_text", "Резюме"))
    state = orch.store.new_session(101)
    for key, value in CORE.items():
        state.set(key, value)
    state.draft = build_draft(state, None).model_dump()
    state.confirmed = True
    orch.store.save(state)
    return orch, state.session_id


@pytest.mark.parametrize("value", ["Не знаю", "Не знаю, нужно уточнить", "Не применимо", "", "неизвестно"])
def test_placeholder_cannot_satisfy_required_core(value):
    state = DialogueState()
    for key, text in CORE.items():
        state.set(key, text)
    state.set("role", value)
    assert not state.all_mandatory_hard_filled()
    assert state.get_missing_mandatory_hard() == ["role"]
    assert state.get("role") is None
    assert not next(item for item in state.progress() if item["key"] == "role")["filled"]


def test_old_placeholder_is_not_a_fact():
    state = DialogueState()
    state.set("role", "Оператор")
    state.slots["role"].value = "Не знаю"
    assert state.get("role") is None
    assert "role" in state.get_missing_mandatory_hard()


def test_closed_integration_question_then_no_records_absence(tmp_path, monkeypatch):
    orch = AgenticOrchestrator(SessionStore(str(tmp_path / "closed_question.db")))
    decisions = iter([
        TurnDecision(facts=[Fact("need_statement", "Нужен экран истории сделок",
                                evidence="Нужен экран истории сделок")],
                     next_action="ask", focus="data_integrations",
                     reply="Нужны интеграции с другими системами?"),
        TurnDecision(facts=[Fact("data_integrations", "Интеграции не нужны", evidence="Нет")],
                     next_action="ask", focus="role", reply="Кто будет пользоваться экраном?"),
    ])
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda *args: next(decisions))
    sid = orch.new_session(101).session_id
    question = orch.handle_message(sid, "Нужен экран истории сделок", message_id="need")
    assert question.action == "question"
    assert question.expected_slot == "data_integrations"
    answer = orch.handle_message(sid, "Нет", message_id="no-integrations")
    stored = orch.store.get(sid)
    assert answer.action != "edit"
    assert stored.get("data_integrations") == "Интеграции не нужны"
    assert stored.get_slot("data_integrations").evidence == "Нет"
    assert stored.get_slot("data_integrations").message_id == "no-integrations"


def test_optional_gaps_do_not_block_submission(workflow):
    orch, sid = workflow
    display = orch._build_response(orch.store.get(sid), "session", "")
    assert display.draft["review_blocked"] is False
    assert not any(item["blocking"] for item in display.draft["open_question_details"])
    assert orch.confirm_and_send(sid, 8, "Сверка", user_id=101).action == "sent"


def test_explicit_unknown_optional_answers_are_not_asked_again(workflow):
    orch, sid = workflow
    state = orch.store.get(sid)
    state.set("acceptance_criteria", "Не знаю")
    state.set("value", "Не знаю")
    state.set("product", "Не применимо")
    assert orch._pre_summary_gap(state) is None


def test_restoration_and_submission_report_the_same_core_blocker(workflow):
    orch, sid = workflow
    edited = orch.edit_draft_section(sid, "primary_role", "Не знаю", user_id=101)
    assert edited.action == "draft_ready"
    restored = orch._build_response(orch.store.get(sid), "session", "")
    sent = orch.confirm_and_send(sid, 8, "Сверка", user_id=101)
    assert restored.draft["review_blocked"] is True
    assert sent.action == "validation_error"
    assert sent.draft["review_findings"] == restored.draft["review_findings"]
    assert "Пользователь" in sent.message
    assert orch.store.get(sid).review_task_id is None


def test_critical_conflict_blocks_both_restore_and_send(workflow):
    orch, sid = workflow
    state = orch.store.get(sid)
    state.draft["conflicts"] = [{"severity": "critical", "message": "Несовместимые правила", "slot": "business_rules"}]
    orch.store.save(state)
    assert orch._build_response(state, "session", "").draft["review_blocked"]
    assert orch.confirm_and_send(sid, 8, "Сверка").action == "validation_error"


def test_early_draft_does_not_call_model_or_require_summary_confirmation(workflow, monkeypatch):
    orch, sid = workflow
    state = orch.store.get(sid)
    state.draft = None
    state.confirmed = False
    orch.store.save(state)
    def unexpected(*args):
        pytest.fail("Explicit draft creation must not depend on an LLM")
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", unexpected)
    response = orch.handle_message(sid, "Подготовить черновик сейчас")
    assert response.action == "draft_ready"
    assert response.draft["process"] == CORE["process"]
    assert orch.store.get(sid).confirmed


def test_one_chat_turn_updates_the_existing_draft(workflow, monkeypatch):
    orch, sid = workflow
    before = orch.store.get(sid).draft
    decision = TurnDecision(facts=[Fact("priority", "Высокий", correction=True)], reply="Приоритет обновлён")
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda *args: decision)
    response = orch.handle_message(sid, "Исправь приоритет на Высокий", message_id="edit-1")
    assert response.action == "draft_ready"
    assert response.draft["priority"] == "Высокий"
    assert response.draft["id"] == before["id"]
    assert response.draft["created_by"] == before["created_by"]
    assert sum(item.get("message_id") == "edit-1" for item in response.history) == 1


def test_model_failure_keeps_the_draft_and_edit_text(workflow, monkeypatch):
    orch, sid = workflow
    before = orch.store.get(sid).draft
    def fail(*args):
        raise LLMUnavailable("offline")
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", fail)
    response = orch.handle_message(sid, "Приоритет высокий", message_id="retry-1")
    assert response.action == "unavailable"
    assert response.draft == before
    assert any(item.get("message_id") == "retry-1" for item in response.history)


def test_direct_fields_are_independent_and_keep_identity(workflow):
    orch, sid = workflow
    draft_id = orch.store.get(sid).draft["id"]
    for field, value in [("affected_users", "Контролёры"), ("primary_role", "Бэк-офицер"),
                         ("process", "Контроль расчётов"), ("priority", "Высокий")]:
        response = orch.edit_draft_section(sid, field, value, user_id=101)
        assert response.action == "draft_ready"
    assert response.draft["primary_role"] == "Бэк-офицер"
    assert response.draft["affected_users"] == ["Контролёры"]
    assert response.draft["user_roles"] == ["Бэк-офицер", "Контролёры"]
    assert response.draft["process"] == "Контроль расчётов"
    assert response.draft["priority"] == "Высокий"
    assert response.draft["id"] == draft_id
    assert response.history[-2]["role"] == "user"
    assert response.history[-1]["role"] == "assistant"


def test_submitted_session_cannot_be_reset_in_chat(workflow):
    orch, sid = workflow
    orch.confirm_and_send(sid, 8, "Сверка")
    response = orch.handle_message(sid, "Начать заново")
    assert response.action == "sent_locked"
    assert response.request_id == 8
    assert response.draft


def test_message_sources_are_snapshots(workflow):
    orch, sid = workflow
    state = orch.store.get(sid)
    state.sources = [{"title": "Источник A"}]
    orch._build_response(state, "draft_ready", "Черновик готов")
    state.sources[0]["title"] = "Источник B"
    assert state.history[-1]["context"]["sources"][0]["title"] == "Источник A"
    response = orch._build_response(state, "question", "Какой срок?")
    assert response.sources == []
