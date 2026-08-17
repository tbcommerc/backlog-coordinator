"""Tests for Phase 4: User profile, fatigue detection, metrics, escalation."""
import pytest
import time
from agent.dialogue.state import DialogueState
from agent.dialogue.user_profile import profile_detector, UserProfileDetector
from agent.dialogue.fatigue_detector import fatigue_detector, FatigueDetector
from agent.dialogue.metrics import metrics_tracker, MetricsTracker, SessionMetrics
from agent.dialogue.escalation_handler import escalation_handler, EscalationHandler


class TestUserProfile:
    def test_detect_technical_user(self):
        detector = UserProfileDetector()
        detector.analyze_message("Нужен API endpoint для settlement")
        detector.analyze_message("Используем JSON payload")
        profile = detector.infer_profile(DialogueState())
        assert profile.style == "technical"

    def test_detect_novice_user(self):
        detector = UserProfileDetector()
        detector.analyze_message("Не знаю, не понимаю")
        detector.analyze_message("Помогите, подскажите")
        profile = detector.infer_profile(DialogueState())
        assert profile.expertise == "novice"

    def test_detect_expert_user(self):
        detector = UserProfileDetector()
        detector.analyze_message("as-is процесс такой, to-be будет лучше")
        detector.analyze_message("acceptance criteria следующие")
        detector.analyze_message("согласовано с владельцем продукта")
        profile = detector.infer_profile(DialogueState())
        assert profile.expertise == "expert"

    def test_default_medium_expertise(self):
        detector = UserProfileDetector()
        profile = detector.infer_profile(DialogueState())
        assert profile.expertise == "medium"


class TestFatigueDetector:
    def test_normal_fatigue_initially(self):
        state = DialogueState()
        assessment = fatigue_detector.assess(state)
        assert assessment.level == "normal"

    def test_tired_after_many_questions(self):
        state = DialogueState()
        state.consecutive_questions = 3
        assessment = fatigue_detector.assess(state)
        assert assessment.level == "tired"

    def test_frustrated_after_too_many_questions(self):
        state = DialogueState()
        state.consecutive_questions = 5
        assessment = fatigue_detector.assess(state)
        assert assessment.level == "frustrated"

    def test_tired_after_many_short_answers(self):
        state = DialogueState()
        state.short_answers_count = 4
        assessment = fatigue_detector.assess(state)
        assert assessment.level == "tired"

    def test_frustrated_with_clarification_failures(self):
        state = DialogueState()
        state.clarification_failures = 3
        assessment = fatigue_detector.assess(state)
        assert assessment.level == "frustrated"

    def test_should_show_summary_when_tired(self):
        state = DialogueState()
        state.consecutive_questions = 3
        assert fatigue_detector.should_show_summary(state)

    def test_should_offer_draft_when_frustrated(self):
        state = DialogueState()
        state.consecutive_questions = 5
        assert fatigue_detector.should_offer_draft_with_gaps(state)


class TestMetricsTracker:
    def test_start_session(self):
        tracker = MetricsTracker()
        state = DialogueState(session_id="test123", user_id=1)
        tracker.start_session(state)
        metrics = tracker.get_session_metrics("test123")
        assert metrics is not None
        assert metrics.session_id == "test123"
        assert metrics.started_at > 0

    def test_update_from_state(self):
        tracker = MetricsTracker()
        state = DialogueState(session_id="test123", user_id=1)
        state.set("need_statement", "test")
        state.total_user_messages = 5
        state.total_agent_messages = 3
        tracker.start_session(state)
        tracker.update_from_state(state)
        
        metrics = tracker.get_session_metrics("test123")
        assert metrics.total_user_messages == 5
        assert metrics.total_agent_messages == 3
        assert metrics.slots_filled == 1

    def test_aggregate_metrics(self):
        tracker = MetricsTracker()
        
        # Create completed session
        state1 = DialogueState(session_id="s1", user_id=1)
        state1.draft = {"id": "d1"}
        tracker.start_session(state1)
        tracker.update_from_state(state1)
        
        # Create incomplete session
        state2 = DialogueState(session_id="s2", user_id=2)
        tracker.start_session(state2)
        tracker.update_from_state(state2)
        
        agg = tracker.get_aggregate_metrics()
        assert agg.total_sessions == 2
        assert agg.drafts_created == 1
        assert agg.completion_rate == 0.5

    def test_metrics_report(self):
        tracker = MetricsTracker()
        state = DialogueState(session_id="test", user_id=1)
        tracker.start_session(state)
        report = tracker.get_report()
        assert "Dialogue Metrics Report" in report
        assert "Total sessions" in report


class TestEscalationHandler:
    def test_no_escalation_normally(self):
        state = DialogueState()
        decision = escalation_handler.check_escalation(state)
        assert not decision.should_escalate

    def test_escalate_on_human_request(self):
        state = DialogueState()
        decision = escalation_handler.check_escalation(state, "Хочу человека")
        assert decision.should_escalate
        assert decision.reason == "user_requested_human"

    def test_escalate_on_repeated_ood(self):
        state = DialogueState()
        state.ood_strikes = 3
        decision = escalation_handler.check_escalation(state)
        assert decision.should_escalate
        assert decision.reason == "repeated_out_of_domain"

    def test_escalate_on_clarification_failures(self):
        state = DialogueState()
        state.clarification_failures = 3
        decision = escalation_handler.check_escalation(state)
        assert decision.should_escalate
        assert decision.reason == "repeated_clarification_failures"

    def test_escalate_on_frustrated(self):
        state = DialogueState()
        state.fatigue_level = "frustrated"
        decision = escalation_handler.check_escalation(state)
        assert decision.should_escalate
        assert decision.reason == "user_frustrated"

    def test_escalate_on_regulatory_low_confidence(self):
        state = DialogueState()
        state.set("regulatory_flags", "комплаенс", confidence=0.3)
        decision = escalation_handler.check_escalation(state)
        assert decision.should_escalate
        assert decision.reason == "regulatory_low_confidence"

    def test_prepare_escalation_context(self):
        state = DialogueState(session_id="test", user_id=1)
        state.set("need_statement", "тестовая потребность")
        state.total_user_messages = 5
        context = escalation_handler.prepare_escalation_context(state)
        assert "test" in context
        assert "тестовая потребность" in context


class TestDialogueStatePhase4:
    def test_record_user_answer(self):
        state = DialogueState()
        state.record_user_answer("короткий ответ")
        assert state.total_user_messages == 1
        assert state.consecutive_questions == 0

    def test_record_question_asked(self):
        state = DialogueState()
        state.record_question_asked()
        assert state.consecutive_questions == 1
        assert state.total_agent_messages == 1

    def test_fatigue_updates_automatically(self):
        state = DialogueState()
        for _ in range(5):
            state.record_question_asked()
        assert state.fatigue_level == "frustrated"

    def test_short_answers_tracked(self):
        state = DialogueState()
        state.record_user_answer("да")
        state.record_user_answer("нет")
        state.record_user_answer("ок")
        assert state.short_answers_count == 3

    def test_session_duration(self):
        state = DialogueState()
        state.session_started_at = time.time() - 10
        duration = state.get_session_duration()
        assert duration >= 9.0

    def test_should_escalate_method(self):
        state = DialogueState()
        state.ood_strikes = 3
        should, reason = state.should_escalate()
        assert should
        assert reason == "repeated_out_of_domain"
