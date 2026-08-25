"""Tests for Phase 3: Multi-mode dialogue, Q&A, and Repair."""
import pytest
from agent.dialogue.state import (
    DialogueState, MODE_GUIDED, MODE_HYBRID, MODE_FREE_FORM, MODE_EXPERT,
)
from agent.dialogue.mode_selector import mode_selector, ModeSelector
from agent.dialogue.qa_handler import qa_handler, QAHandler
from agent.dialogue.repair_handler import repair_handler, RepairHandler
from agent.dialogue.summary_generator import (
    generate_intermediate_summary,
    should_show_intermediate_summary,
    generate_progress_indicator,
)


class TestModeSelector:
    def test_select_mode_default_guided_for_empty_state(self):
        # Empty state has low confidence, so guided mode is selected
        state = DialogueState(session_id="test", user_id=1)
        decision = mode_selector.select_mode(state)
        assert decision.mode == MODE_GUIDED

    def test_select_mode_hybrid_for_some_slots(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("need_statement", "test", confidence=0.7)
        state.set("role", "test", confidence=0.7)
        decision = mode_selector.select_mode(state)
        assert decision.mode == MODE_HYBRID

    def test_select_mode_guided_for_low_confidence(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("need_statement", "test", confidence=0.3)
        decision = mode_selector.select_mode(state)
        assert decision.mode == MODE_GUIDED

    def test_select_mode_free_form_for_high_confidence(self):
        state = DialogueState(session_id="test", user_id=1)
        # Fill many slots with high confidence
        state.set("need_statement", "test", confidence=0.95)
        state.set("role", "test", confidence=0.95)
        state.set("process", "test", confidence=0.95)
        state.set("product", "test", confidence=0.95)
        state.set("to_be", "test", confidence=0.95)
        decision = mode_selector.select_mode(state)
        assert decision.mode == MODE_FREE_FORM


class TestQAHandler:
    def test_is_question_with_question_mark(self):
        assert qa_handler.is_question("Что такое расчёт?")
        assert qa_handler.is_question("Как работает модуль?")

    def test_is_question_with_keywords(self):
        assert qa_handler.is_question("что такое settlement")
        assert qa_handler.is_question("объясни процесс расчётов")
        assert qa_handler.is_question("какие статусы есть у сделки")

    def test_is_not_question_for_statements(self):
        assert not qa_handler.is_question("Нужен реестр сделок")
        assert not qa_handler.is_question("Бэк-офицер")

    def test_handle_question_enters_qa_mode(self):
        state = DialogueState(session_id="test", user_id=1)
        state.last_asked_slot = "process"
        response = qa_handler.handle_question(state, "Что такое расчёт?")
        assert state.in_qa_mode
        assert state.pending_question == "process"
        assert response.answer
        assert response.return_to_slot == "process"

    def test_exit_qa_mode_restores_slot(self):
        state = DialogueState(session_id="test", user_id=1)
        state.enter_qa_mode("process")
        # Get return slot before exiting
        return_slot = qa_handler.get_return_slot(state)
        assert return_slot == "process"
        # Now exit
        qa_handler.exit_qa_mode(state)
        assert not state.in_qa_mode


class TestRepairHandler:
    def test_detect_repair_with_explicit_keywords(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("product", "облигации")
        
        # Use a clearer message that doesn't contain the old value
        decision = repair_handler.detect_repair(state, "Изменить продукт на паи фондов")
        assert decision.should_repair
        assert decision.slot == "product"
        # The new value should be extracted from the message
        assert decision.new_value is not None

    def test_detect_repair_with_slot_name(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("process", "расчёты")
        
        decision = repair_handler.detect_repair(state, "Изменить процесс на отчётность")
        assert decision.should_repair
        assert decision.slot == "process"

    def test_no_repair_for_normal_answer(self):
        state = DialogueState(session_id="test", user_id=1)
        decision = repair_handler.detect_repair(state, "Бэк-офицер")
        assert not decision.should_repair

    def test_apply_repair_updates_slot(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("product", "облигации", confidence=0.9)
        
        repair_handler.apply_repair(state, "product", "фонды", confidence=0.95)
        
        assert state.get("product") == "фонды"
        assert state.get_confidence("product") == 0.95
        assert len(state.get_slot_history("product")) == 1

    def test_repair_records_history(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("product", "облигации")
        
        repair_handler.apply_repair(state, "product", "фонды")
        
        history = state.get_slot_history("product")
        assert len(history) == 1
        assert history[0]["old_value"] == "облигации"
        assert history[0]["new_value"] == "фонды"
        assert history[0]["reason"] == "repair"


class TestSummaryGenerator:
    def test_generate_intermediate_summary_with_filled_slots(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("need_statement", "Нужен реестр")
        state.set("role", "бэк-офицер")
        state.set("process", "расчёты")
        
        summary = generate_intermediate_summary(state)
        assert "Нужен реестр" in summary
        assert "бэк-офицер" in summary
        assert "расчёты" in summary

    def test_generate_intermediate_summary_empty(self):
        state = DialogueState(session_id="test", user_id=1)
        summary = generate_intermediate_summary(state)
        assert "Пока ничего не собрано" in summary

    def test_should_show_summary_after_threshold(self):
        state = DialogueState(session_id="test", user_id=1)
        state.dialogue_mode = MODE_HYBRID
        
        # Not enough questions
        assert not should_show_intermediate_summary(state, 2)
        
        # Enough questions
        assert should_show_intermediate_summary(state, 3)

    def test_generate_progress_indicator(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("need_statement", "test")
        state.set("role", "test")
        
        progress = generate_progress_indicator(state)
        assert "Качество проработки:" in progress
        assert "/" in progress
        assert "%" in progress
