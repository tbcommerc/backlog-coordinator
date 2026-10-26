"""Policy Engine - decides the next action based on dialogue state.

Implements the balance between strict requirements (mandatory fields, guardrails)
and flexible conversation (adaptive questioning, user-led mode).

Actions:
- ASK_QUESTION: ask the next question
- SHOW_SUMMARY: show collected data summary
- REQUEST_CLARIFICATION: ask for clarification on low-confidence slot
- ANSWER_QUESTION: answer user's question about platform
- REFUSE: refuse out-of-domain or prohibited request
- ESCALATE: escalate to human
- CREATE_DRAFT: create draft after confirmation
- CONTINUE: continue dialogue without action
"""
from dataclasses import dataclass
from typing import Optional

from .state import (
    DialogueState, MANDATORY_HARD, MANDATORY_SOFT, OPTIONAL,
    PHASE_SUMMARIZE, PHASE_CONFIRM, PHASE_DRAFT_READY,
)


@dataclass
class PolicyDecision:
    action: str
    slot: Optional[str] = None
    reason: str = ""
    priority: float = 0.0
    metadata: dict = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


# Action constants
ASK_QUESTION = "ask_question"
SHOW_SUMMARY = "show_summary"
REQUEST_CLARIFICATION = "request_clarification"
ANSWER_QUESTION = "answer_question"
REFUSE = "refuse"
ESCALATE = "escalate"
CREATE_DRAFT = "create_draft"
CONTINUE = "continue"

# Reason constants
MANDATORY_MISSING = "mandatory_missing"
LOW_CONFIDENCE = "low_confidence"
REGULATORY_CHECK = "regulatory_check"
CONFIRMATION_NEEDED = "confirmation_needed"
USER_QUESTION = "user_question"
OUT_OF_DOMAIN = "out_of_domain"
ALL_REQUIRED_FILLED = "all_required_filled"


class PolicyEngine:
    """Decides the next action based on dialogue state and context."""

    def __init__(self, confidence_threshold: float = 0.6):
        self.confidence_threshold = confidence_threshold

    def decide(self, state: DialogueState, ctx=None) -> PolicyDecision:
        """Decide the next action based on current state."""
        
        # Check for escalation triggers
        if state.escalation:
            return PolicyDecision(
                action=ESCALATE,
                reason="user_requested_or_repeated_off_topic"
            )

        # Check for out-of-domain
        if state.ood_strikes >= 3:
            return PolicyDecision(
                action=ESCALATE,
                reason="repeated_out_of_domain"
            )

        # Check if we should show summary
        if self._should_show_summary(state):
            return PolicyDecision(
                action=SHOW_SUMMARY,
                reason=ALL_REQUIRED_FILLED,
                priority=10.0
            )

        # Check for low-confidence slots that need clarification
        low_conf_slots = state.get_low_confidence_slots(self.confidence_threshold)
        if low_conf_slots:
            # Prioritize mandatory hard slots
            for slot in MANDATORY_HARD:
                if slot in low_conf_slots:
                    return PolicyDecision(
                        action=REQUEST_CLARIFICATION,
                        slot=slot,
                        reason=LOW_CONFIDENCE,
                        priority=9.0
                    )
            # Then mandatory soft
            for slot in MANDATORY_SOFT:
                if slot in low_conf_slots:
                    return PolicyDecision(
                        action=REQUEST_CLARIFICATION,
                        slot=slot,
                        reason=LOW_CONFIDENCE,
                        priority=7.0
                    )

        # Check for missing mandatory hard slots
        missing_hard = state.get_missing_mandatory_hard()
        if missing_hard:
            return PolicyDecision(
                action=ASK_QUESTION,
                slot=missing_hard[0],
                reason=MANDATORY_MISSING,
                priority=10.0
            )

        # Check for missing mandatory soft slots
        missing_soft = state.get_missing_mandatory_soft()
        if missing_soft:
            return PolicyDecision(
                action=ASK_QUESTION,
                slot=missing_soft[0],
                reason=MANDATORY_MISSING,
                priority=7.0
            )

        # Check for regulatory flags
        if state.get("regulatory_flags") and not state.slots["regulatory_flags"].confirmed:
            return PolicyDecision(
                action=REQUEST_CLARIFICATION,
                slot="regulatory_flags",
                reason=REGULATORY_CHECK,
                priority=8.0
            )

        # Default: continue dialogue
        return PolicyDecision(action=CONTINUE, reason="no_action_needed")

    def _should_show_summary(self, state: DialogueState) -> bool:
        """Check if we should show summary to user."""
        # All mandatory hard slots filled
        if not state.all_mandatory_hard_filled():
            return False

        # No low-confidence mandatory slots
        low_conf = state.get_low_confidence_slots(self.confidence_threshold)
        for slot in MANDATORY_HARD:
            if slot in low_conf:
                return False

        # Check if we've asked enough questions (at least 3-4 main slots)
        filled_count = sum(1 for slot in MANDATORY_HARD + MANDATORY_SOFT 
                          if state.slots.get(slot) and state.slots[slot].status == "filled")
        
        # Show summary if we have at least 4 filled slots (including mandatory hard)
        if filled_count >= 4:
            return True

        # Also show summary if we're in summary/confirm phase
        from .machine import compute_phase
        phase = compute_phase(state)
        if phase in (PHASE_SUMMARIZE, PHASE_CONFIRM, PHASE_DRAFT_READY):
            return True

        return False

    def should_skip_slot(self, state: DialogueState, slot: str) -> bool:
        """Check if a slot can be skipped (optional or user said "don't know")."""
        if slot in OPTIONAL:
            return True
        if slot in MANDATORY_SOFT:
            return True
        return False

    def get_slot_priority(self, slot: str, state: DialogueState) -> float:
        """Calculate priority for asking a slot.
        
        Formula from TZ:
        priority = mandatory_weight * 0.4 + risk_weight * 0.25 + 
                   uncertainty_weight * 0.2 + effort_penalty * 0.1
        """
        # Mandatory weight
        if slot in MANDATORY_HARD:
            mandatory_weight = 10.0
        elif slot in MANDATORY_SOFT:
            mandatory_weight = 7.0
        else:
            mandatory_weight = 3.0

        # Risk weight (regulatory, high-impact)
        risk_weight = 0.0
        if slot == "regulatory_flags":
            risk_weight = 10.0
        elif slot in ("acceptance_criteria", "business_rules"):
            risk_weight = 5.0

        # Uncertainty weight (inverse of confidence)
        confidence = state.get_confidence(slot)
        uncertainty_weight = (1.0 - confidence) * 10.0

        # Effort penalty (how many times we asked)
        ask_count = state.ask_counts.get(slot, 0)
        effort_penalty = min(ask_count * 2.0, 5.0)

        priority = (
            mandatory_weight * 0.4 +
            risk_weight * 0.25 +
            uncertainty_weight * 0.2 +
            effort_penalty * 0.1
        )

        return priority


policy_engine = PolicyEngine()
