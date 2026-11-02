"""Dialogue mode selector - chooses the appropriate dialogue mode based on
user context, confidence, and dialogue state.

Modes:
- guided: Strict step-by-step for novices, low confidence, or critical processes
- hybrid: Main mode - balance of structure and flexibility
- free_form: Experienced users with high confidence, lots of data at once
- expert: BA/PO users - fewer questions, faster to draft
"""
from dataclasses import dataclass
from typing import Optional

from .state import (
    DialogueState, MODE_GUIDED, MODE_HYBRID, MODE_FREE_FORM, MODE_EXPERT,
    MANDATORY_HARD,
)


@dataclass
class ModeDecision:
    mode: str
    reason: str
    confidence: float = 0.0


class ModeSelector:
    """Selects the appropriate dialogue mode based on context."""

    def __init__(self):
        self.default_mode = MODE_HYBRID

    def select_mode(self, state: DialogueState, ctx=None) -> ModeDecision:
        """Select the best dialogue mode for current state and context."""
        if state.requirement_shape == "field_change":
            return ModeDecision(MODE_FREE_FORM, "focused_field_change", 0.9)
        
        # Check for explicit user role (BA/PO -> expert mode)
        if ctx and self._is_expert_user(ctx):
            return ModeDecision(
                mode=MODE_EXPERT,
                reason="expert_user_role",
                confidence=0.9
            )

        if state.user_expertise == "expert":
            return ModeDecision(MODE_EXPERT, "detected_expert_profile", 0.8)
        if state.user_expertise == "novice":
            return ModeDecision(MODE_GUIDED, "detected_novice_profile", 0.7)

        # Check dialogue state
        filled_count = self._count_filled_slots(state)
        avg_confidence = self._calculate_avg_confidence(state)
        
        # Low confidence or many missing slots -> guided mode
        if avg_confidence < 0.6 or filled_count < 2:
            return ModeDecision(
                mode=MODE_GUIDED,
                reason="low_confidence_or_few_slots",
                confidence=avg_confidence
            )
        
        # High confidence and many slots filled -> free_form mode
        if avg_confidence > 0.85 and filled_count >= 5:
            return ModeDecision(
                mode=MODE_FREE_FORM,
                reason="high_confidence_many_slots",
                confidence=avg_confidence
            )
        
        # Default: hybrid mode
        return ModeDecision(
            mode=MODE_HYBRID,
            reason="default_balanced_mode",
            confidence=avg_confidence
        )

    def _is_expert_user(self, ctx) -> bool:
        """Check if user is an expert (BA, PO, analyst)."""
        if not ctx:
            return False
        role = (ctx.role_name or "").lower()
        expert_roles = ["ba", "po", "business analyst", "product owner", "аналитик", "владелец продукта"]
        return any(expert in role for expert in expert_roles)

    def _count_filled_slots(self, state: DialogueState) -> int:
        """Count how many slots are filled."""
        return sum(1 for slot in state.slots.values() 
                   if slot.status == "filled")

    def _calculate_avg_confidence(self, state: DialogueState) -> float:
        """Calculate average confidence across filled slots."""
        confidences = [slot.confidence for slot in state.slots.values() 
                       if slot.status == "filled" and slot.confidence > 0]
        if not confidences:
            return 0.5
        return sum(confidences) / len(confidences)

    def should_skip_optional_questions(self, state: DialogueState) -> bool:
        """Check if we should skip optional questions (expert/free_form mode)."""
        return state.dialogue_mode in (MODE_EXPERT, MODE_FREE_FORM)

    def get_max_questions_before_summary(self, state: DialogueState) -> int:
        """Get max questions to ask before showing summary."""
        if state.dialogue_mode == MODE_GUIDED:
            return 10  # Ask all slots
        elif state.dialogue_mode == MODE_EXPERT:
            return 3   # Quick path
        elif state.dialogue_mode == MODE_FREE_FORM:
            return 5   # Medium path
        else:  # hybrid
            return 7   # Balanced


mode_selector = ModeSelector()
