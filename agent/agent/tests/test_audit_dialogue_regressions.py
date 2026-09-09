"""Behavioural regression cases from the 2026-09-08 audit, without live providers."""
import pytest

from agent.agentic_orchestrator import AgenticOrchestrator
from agent.composer.composer import build_draft
from agent.composer.revision import draft_fingerprint
from agent.dialogue.agentic import Fact, LLMUnavailable, TurnDecision
from agent.dialogue.metrics import metrics_tracker
from agent.dialogue.mode_selector import mode_selector
from agent.session import SessionStore


@pytest.fixture()
def orch(tmp_path):
    return AgenticOrchestrator(SessionStore(str(tmp_path / "regressions.db")))


def core(orch):
    state = orch.store.new_session(1)
    for key, value in {
        "need_statement": "Добавить выгрузку реестра",
        "to_be": "Оператор выгружает реестр в CSV",
        "role": "Оператор", "process": "Подготовка реестра",
    }.items():
        state.set(key, value, confidence=0.9, source="user", evidence=value)
    orch.store.save(state)
    return state


def stub(monkeypatch, decision):
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)


def test_no_answers_current_question_instead_of_entering_edit(orch, monkeypatch):
    state = core(orch)
    state.last_asked_slot = "data_integrations"
    state.add_message("assistant", "Нужны интеграции?")
    orch.store.save(state)
    seen = []
    def answer(state, text):
        seen.append((state.last_asked_slot, text))
        return TurnDecision(next_action="answer", reply="Отмечу отсутствие интеграций после уточнения границ.")
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", answer)
    response = orch.handle_message(state.session_id, "нет")
    assert seen == [("data_integrations", "нет")]
    assert response.action != "edit"
    assert not orch.store.get(state.session_id).needs_edit


@pytest.mark.parametrize("text", ["понял", "продолжай", "ясно"])
def test_acknowledgement_is_not_summary_approval(orch, monkeypatch, text):
    state = core(orch)
    orch._prepare_summary(state, None)
    orch._build_response(state, "summarize", state.summary_text)
    stub(monkeypatch, TurnDecision(next_action="answer", reply="Резюме ожидает подтверждения."))
    response = orch.handle_message(state.session_id, text)
    assert response.draft is None
    assert not orch.store.get(state.session_id).confirmed


def test_old_summary_does_not_capture_answer_to_later_question(orch, monkeypatch):
    state = core(orch)
    orch._prepare_summary(state, None)
    orch._build_response(state, "summarize", state.summary_text)
    state.last_asked_slot = "regulatory_flags"
    orch._build_response(state, "question", "Есть регуляторные ограничения?")
    stub(monkeypatch, TurnDecision(next_action="answer", reply="Уточним содержание ограничений."))
    response = orch.handle_message(state.session_id, "да")
    assert response.draft is None


def test_correction_reaches_model_after_low_confidence_escalation(orch, monkeypatch):
    state = core(orch)
    state.set("regulatory_flags", "Сомнительная норма", confidence=0.3)
    state.ood_strikes = 3
    orch.store.save(state)
    stub(monkeypatch, TurnDecision(facts=[Fact("regulatory_flags", "Ограничений нет", 0.95,
        evidence="Ограничений нет", operation="replace")], next_action="answer", reply="Исправлено."))
    response = orch.handle_message(state.session_id, "Исправление: Ограничений нет")
    restored = orch.store.get(state.session_id)
    assert restored.get("regulatory_flags") == "Ограничений нет"
    assert restored.ood_strikes == 0
    assert response.action != "escalated"


def test_malformed_output_does_not_resurrect_negated_history(orch, monkeypatch):
    state = orch.store.new_session(1)
    state.last_asked_slot = "to_be"
    state.add_message("user", "Не нужно менять дизайн. Нужен только экспорт.")
    orch.store.save(state)
    def fail(*args):
        raise LLMUnavailable("invalid JSON") from ValueError("invalid JSON")
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", fail)
    response = orch.handle_message(state.session_id, "Повторите обработку")
    assert response.action == "unavailable"
    assert response.expected_slot == "to_be"
    assert orch.store.get(state.session_id).get("need_statement") is None


def test_question_limit_stops_summary_gap_loop(orch, monkeypatch):
    state = core(orch)
    state.question_count = 100
    orch.store.save(state)
    stub(monkeypatch, TurnDecision(next_action="summarize"))
    response = orch.handle_message(state.session_id, "Продолжим")
    assert response.action == "summarize"
    assert "уточнен" in response.message.lower() or "уточнен" in response.message.lower().replace("ё", "е")


def test_same_quality_question_is_not_repeated_indefinitely(orch, monkeypatch):
    state = core(orch)
    stub(monkeypatch, TurnDecision(next_action="summarize"))
    first = orch.handle_message(state.session_id, "Соберём резюме")
    second = orch.handle_message(state.session_id, "Ответа пока нет")
    assert first.action == "question"
    assert second.action == "summarize"


def test_conflicting_fact_gets_truthful_reply_and_survives_summary(orch, monkeypatch):
    state = core(orch)
    stub(monkeypatch, TurnDecision(facts=[Fact("role", "Контролёр", 0.9, evidence="Контролёр")],
        next_action="answer", reply="Записал новую роль."))
    response = orch.handle_message(state.session_id, "Контролёр")
    restored = orch.store.get(state.session_id)
    assert restored.get("role") == "Оператор"
    assert "Записал" not in response.message
    assert "противореч" in response.message.lower()
    orch._prepare_summary(restored, None)
    assert "Оператор" in restored.summary_text and "Контролёр" in restored.summary_text


def test_summary_preserves_assumptions_and_applicability(orch):
    state = core(orch)
    state.set("as_is", "Реестр собирают вручную")
    state.set("regulatory_flags", "Архивирование семь лет")
    state.set("data_integrations", "Не применимо")
    state.requirement_assumptions.append({"id": "a1", "text": "CSV будет достаточно", "status": "open"})
    state.sources.append({"type": "assumption", "text": "Проверить кодировку"})
    orch._prepare_summary(state, None)
    assert "собирают вручную" in state.summary_text
    assert "Архивирование семь лет" in state.summary_text
    assert "не применимо" in state.summary_text
    assert "CSV будет достаточно" in state.summary_text
    assert any(item.get("text") == "Проверить кодировку" for item in state.sources)


def test_nested_interrogatives_keep_semantic_context():
    text = "Как оператор узнает, какие сделки требуют повторной отправки?"
    assert AgenticOrchestrator._one_question(text, "scenarios") == text
    assert AgenticOrchestrator._one_question("Правильно понимаю задачу? Как оператор узнает об ошибке?", "scenarios") == "Как оператор узнает об ошибке?"


def test_stale_draft_hash_rejects_send_before_review_mutates_snapshot(orch):
    state = core(orch)
    orch._compose_current_draft(state, None)
    old_hash = draft_fingerprint(state.draft)
    state.draft["business_value"] = "Снижение ручной работы"
    orch.store.save(state)
    before = dict(state.draft)
    response = orch.confirm_and_send(state.session_id, 123, "Реестр", user_id=1, expected_draft_hash=old_hash)
    assert response.action == "revision_conflict"
    assert orch.store.get(state.session_id).draft == before
    assert not orch.store.get(state.session_id).review_status
    assert response.draft_revision == draft_fingerprint(before)


def test_active_runtime_records_direct_draft_metrics(orch):
    state = core(orch)
    response = orch.handle_message(state.session_id, "Подготовить черновик сейчас")
    assert response.draft_revision == draft_fingerprint(response.draft)
    metrics = metrics_tracker.get_session_metrics(state.session_id)
    assert metrics.draft_created
    assert metrics.total_user_messages == 1


def test_conflict_during_draft_edit_changes_snapshot_and_blocks_send(orch, monkeypatch):
    state = core(orch)
    original = orch._compose_current_draft(state, None)
    stub(monkeypatch, TurnDecision(facts=[Fact("process", "Согласование расчётов", 0.9,
        evidence="Согласование расчётов")], next_action="ask", focus="acceptance_criteria",
        reply="Записал. Как проверить результат?"))
    response = orch.handle_message(state.session_id, "Согласование расчётов")
    assert response.draft_revision != original.draft_revision
    assert response.draft["review_blocked"]
    assert any(item.get("code") == "fact_conflict" for item in response.draft["conflicts"])
    assert response.expected_slot == "process"
    assert orch.confirm_and_send(state.session_id, 123, "Реестр", 1).action == "validation_error"


def test_new_unverified_candidate_in_draft_is_visible_without_becoming_fact(orch, monkeypatch):
    state = core(orch)
    original = orch._compose_current_draft(state, None)
    stub(monkeypatch, TurnDecision(facts=[Fact("role", "Администратор", 0.99,
        evidence="не относится к реплике")], next_action="answer", reply="Роль изменена."))
    response = orch.handle_message(state.session_id, "Уточним пользователей")
    assert response.draft_revision != original.draft_revision
    assert response.draft["primary_role"] == "Оператор"
    assert "Администратор" in str(response.draft["assumptions"])
    assert "Роль изменена" not in response.message


def test_model_cannot_claim_draft_edit_without_an_operation(orch, monkeypatch):
    state = core(orch)
    original = orch._compose_current_draft(state, None)
    stub(monkeypatch, TurnDecision(next_action="answer", reply="Лимит 10 млн добавлен в бизнес-правила."))
    response = orch.handle_message(state.session_id, "Добавьте лимит 10 млн в бизнес-правила")
    assert "Лимит 10 млн добавлен" not in response.message
    assert response.draft_revision == original.draft_revision
    assert "не внесены" in response.message or "нет новых изменений" in response.message


def test_rejected_core_candidate_keeps_question_on_missing_fact(orch, monkeypatch):
    state = orch.store.new_session(1)
    stub(monkeypatch, TurnDecision(facts=[Fact("role", "Все сотрудники банка", 0.9, evidence="карточке сделки")],
        next_action="ask", focus="acceptance_criteria", reply="Как проверим результат?"))
    response = orch.handle_message(state.session_id, "В карточке сделки")
    assert response.expected_slot == "role"


def test_compound_question_selects_question_matching_focus():
    assert AgenticOrchestrator._one_question("Кто будет утверждать отчёт? Какой срок его подготовки?", "acceptance_criteria") == "Какой срок его подготовки?"


def test_repeat_send_cannot_silently_bind_to_another_request(orch):
    state = core(orch)
    orch._compose_current_draft(state, None)
    assert orch.confirm_and_send(state.session_id, 123, "Реестр", 1).action == "sent"
    response = orch.confirm_and_send(state.session_id, 456, "Реестр", 1)
    assert response.action == "revision_conflict"
    assert orch.store.get(state.session_id).review_task_id == 123
