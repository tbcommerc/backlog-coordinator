"""Fatigue detector - monitors user engagement and detects fatigue.

Tracks dialogue patterns to detect when user is:
- Getting tired (short answers, delays)
- Getting frustrated (repeated corrections, complaints)
- Ready to give up (very short responses after many questions)

When fatigue is detected, the orchestrator should:
- Show intermediate summary
- Offer to skip optional questions
- Suggest creating draft with open questions
- Be more concise in responses
"""
from dataclasses import dataclass
from typing import Optional

from .state import DialogueState


@dataclass
class FatigueAssessment:
    level: str = "normal"  # normal | tired | frustrated
    indicators: list = None
    recommendation: str = ""

    def __post_init__(self):
        if self.indicators is None:
            self.indicators = []


class FatigueDetector:
    """Detects user fatigue from dialogue patterns."""

    # Thresholds
    SHORT_ANSWER_THRESHOLD = 3  # words
    CONSECUTIVE_QUESTIONS_TIRED = 3
    CONSECUTIVE_QUESTIONS_FRUSTRATED = 5
    SHORT_ANSWERS_TIRED = 4
    SHORT_ANSWERS_FRUSTRATED = 6

    def assess(self, state: DialogueState) -> FatigueAssessment:
        """Assess user fatigue level based on dialogue state."""
        indicators = []
        level = "normal"
        
        # Check consecutive questions asked
        if state.consecutive_questions >= self.CONSECUTIVE_QUESTIONS_FRUSTRATED:
            level = "frustrated"
            indicators.append(f"too_many_questions ({state.consecutive_questions})")
        elif state.consecutive_questions >= self.CONSECUTIVE_QUESTIONS_TIRED:
            level = "tired"
            indicators.append(f"many_questions ({state.consecutive_questions})")
        
        # Check short answers pattern
        if state.short_answers_count >= self.SHORT_ANSWERS_FRUSTRATED:
            if level != "frustrated":
                level = "frustrated"
            indicators.append(f"many_short_answers ({state.short_answers_count})")
        elif state.short_answers_count >= self.SHORT_ANSWERS_TIRED:
            if level == "normal":
                level = "tired"
            indicators.append(f"some_short_answers ({state.short_answers_count})")
        
        # Check clarification failures
        if state.clarification_failures >= 3:
            level = "frustrated"
            indicators.append(f"clarification_failures ({state.clarification_failures})")
        
        # Check OOD strikes (user might be confused/frustrated)
        if state.ood_strikes >= 2:
            if level == "normal":
                level = "tired"
            indicators.append(f"ood_strikes ({state.ood_strikes})")
        
        # Generate recommendation
        recommendation = self._get_recommendation(level, state)
        
        return FatigueAssessment(
            level=level,
            indicators=indicators,
            recommendation=recommendation
        )

    def _get_recommendation(self, level: str, state: DialogueState) -> str:
        """Get recommendation based on fatigue level."""
        if level == "frustrated":
            return "show_summary_and_offer_draft"
        elif level == "tired":
            return "show_intermediate_summary"
        else:
            return "continue_normal"

    def should_show_summary(self, state: DialogueState) -> bool:
        """Check if we should show summary due to fatigue."""
        assessment = self.assess(state)
        return assessment.level in ("tired", "frustrated")

    def should_offer_draft_with_gaps(self, state: DialogueState) -> bool:
        """Check if we should offer to create draft with open questions."""
        assessment = self.assess(state)
        return assessment.level == "frustrated"

    def should_be_concise(self, state: DialogueState) -> bool:
        """Check if we should be more concise in responses."""
        assessment = self.assess(state)
        return assessment.level != "normal"


fatigue_detector = FatigueDetector()
