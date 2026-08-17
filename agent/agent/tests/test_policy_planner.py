"""Tests for Policy Engine and enhanced Question Planner."""
import pytest
from agent.dialogue.state import DialogueState, MANDATORY_HARD, MANDATORY_SOFT
from agent.dialogue.policy import (
    policy_engine, PolicyEngine, ASK_QUESTION, SHOW_SUMMARY,
    REQUEST_CLARIFICATION, CONTINUE, MANDATORY_MISSING, LOW_CONFIDENCE,
)
from agent.dialogue.planner import planner


class TestPolicyEngine:
    def test_decide_ask_question_when_mandatory_missing(self):
        state = DialogueState(session_id="test", user_id=1)
        # need_statement is mandatory hard and empty
        decision = policy_engine.decide(state)
        assert decision.action == ASK_QUESTION
        assert decision.slot in MANDATORY_HARD
        assert decision.reason == MANDATORY_MISSING

    def test_decide_request_clarification_when_low_confidence(self):
        state = DialogueState(session_id="test", user_id=1)
        # Fill mandatory slots with low confidence
        state.set("need_statement", "test need", confidence=0.5)
        state.set("role", "test role", confidence=0.9)
        state.set("process", "test process", confidence=0.9)
        state.set("to_be", "test target", confidence=0.9)
        
        decision = policy_engine.decide(state)
        assert decision.action == REQUEST_CLARIFICATION
        assert decision.slot == "need_statement"
        assert decision.reason == LOW_CONFIDENCE

    def test_decide_show_summary_when_all_mandatory_filled(self):
        state = DialogueState(session_id="test", user_id=1)
        # Fill all mandatory hard slots with high confidence
        state.set("need_statement", "test need", confidence=0.9)
        state.set("role", "test role", confidence=0.9)
        state.set("process", "test process", confidence=0.9)
        state.set("to_be", "test target", confidence=0.9)
        
        decision = policy_engine.decide(state)
        assert decision.action == SHOW_SUMMARY
        assert decision.reason == "all_required_filled"

    def test_slot_priority_mandatory_hard_higher_than_optional(self):
        state = DialogueState(session_id="test", user_id=1)
        
        priority_hard = policy_engine.get_slot_priority("need_statement", state)
        priority_optional = policy_engine.get_slot_priority("department", state)
        
        assert priority_hard > priority_optional

    def test_slot_priority_increases_with_uncertainty(self):
        state = DialogueState(session_id="test", user_id=1)
        
        # High confidence
        state.set("role", "test", confidence=0.9)
        priority_high = policy_engine.get_slot_priority("role", state)
        
        # Low confidence
        state.set("role", "test", confidence=0.3)
        priority_low = policy_engine.get_slot_priority("role", state)
        
        # Lower confidence should have higher priority (more urgent to clarify)
        assert priority_low > priority_high


class TestQuestionPlanner:
    def test_next_question_returns_slot_with_priority(self):
        state = DialogueState(session_id="test", user_id=1)
        result = planner.next_question(state)
        
        assert "slot" in result
        assert "priority" in result
        assert "reason" in result
        assert result["priority"] > 0

    def test_get_next_slots_by_priority(self):
        state = DialogueState(session_id="test", user_id=1)
        slots = planner.get_next_slots_by_priority(state, limit=3)
        
        assert len(slots) <= 3
        assert all("slot" in s for s in slots)
        assert all("priority" in s for s in slots)
        
        # Check sorted by priority (descending)
        priorities = [s["priority"] for s in slots]
        assert priorities == sorted(priorities, reverse=True)

    def test_planner_respects_policy_engine(self):
        state = DialogueState(session_id="test", user_id=1)
        # Fill some slots
        state.set("need_statement", "test", confidence=0.9)
        state.set("role", "test", confidence=0.9)
        
        result = planner.next_question(state)
        # Should ask for next mandatory slot
        assert result["slot"] in MANDATORY_HARD or result["slot"] is None
