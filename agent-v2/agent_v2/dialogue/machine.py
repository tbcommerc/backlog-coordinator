"""Deterministic dialogue state machine.

Computes the current phase purely from which slots are handled, so behaviour
is predictable and fully testable without an LLM. The LLM only phrases the
questions selected here.
"""
from .state import (
    DialogueState, PHASE_ORDER, PHASE_REQUIRED_SLOTS,
    PHASE_IDENTIFY_INTENT, PHASE_NEED_STATEMENT, PHASE_BUSINESS_CONTEXT,
    PHASE_AS_IS_TO_BE, PHASE_ROLES_SCENARIOS, PHASE_BUSINESS_RULES,
    PHASE_DATA_INTEGRATIONS, PHASE_VALUE_PRIORITY, PHASE_SUMMARIZE,
    PHASE_CONFIRM, PHASE_DRAFT_READY, PHASE_SENT_FOR_REVIEW,
    PHASE_CLARIFY_ANSWER, PHASE_CLARIFY_PROCEED, PHASE_INCIDENT_TRIAGE,
    PHASE_ESCALATED, PHASE_DONE,
    MODE_EXPERT, MODE_FREE_FORM, MODE_GUIDED,
)
from .quality import required_slots_for_phase as profile_required_slots

# Optional (preferred) slots asked once per phase after the required ones.
OPTIONAL_SLOTS_BY_PHASE = {
    PHASE_BUSINESS_CONTEXT: ["department", "module"],
    PHASE_AS_IS_TO_BE: ["scenarios"],
    PHASE_ROLES_SCENARIOS: [],
    PHASE_BUSINESS_RULES: ["business_rules"],
    PHASE_DATA_INTEGRATIONS: [],
    PHASE_VALUE_PRIORITY: ["priority", "regulatory_flags"],
}


def required_slots_for_phase(state: DialogueState, phase: str) -> list[str]:
    """Return the depth appropriate for the current dialogue mode.

    Expert/free-form users get a short, outcome-oriented path. Guided mode
    additionally verifies regulatory impact; hybrid keeps the standard path.
    """
    required = profile_required_slots(state, phase)
    if state.dialogue_mode in (MODE_EXPERT, MODE_FREE_FORM):
        short_path = {
            PHASE_IDENTIFY_INTENT: ["intent"],
            PHASE_NEED_STATEMENT: ["need_statement"],
            PHASE_BUSINESS_CONTEXT: ["role", "process"],
            PHASE_AS_IS_TO_BE: ["to_be"],
            PHASE_ROLES_SCENARIOS: [],
            PHASE_BUSINESS_RULES: ["acceptance_criteria"],
            PHASE_DATA_INTEGRATIONS: [],
            PHASE_VALUE_PRIORITY: [],
        }
        return short_path.get(phase, required)
    if state.dialogue_mode == MODE_GUIDED and phase == PHASE_VALUE_PRIORITY \
            and "regulatory_flags" not in required:
        return required + ["regulatory_flags"]
    return required


def compute_phase(state: DialogueState) -> str:
    if state.escalation:
        return PHASE_ESCALATED
    if state.finished:
        return PHASE_DONE
    if state.review_status:
        return PHASE_SENT_FOR_REVIEW
    if state.draft:
        return PHASE_CONFIRM if not state.confirmed else PHASE_DRAFT_READY

    intent = state.get("intent")

    if intent == "incident":
        if not state.slots["need_statement"].handled:
            return PHASE_NEED_STATEMENT
        return PHASE_INCIDENT_TRIAGE

    if intent == "clarification":
        if not state.clarify_answered:
            return PHASE_CLARIFY_ANSWER
        if state.clarify_proceed is None:
            return PHASE_CLARIFY_PROCEED
        if not state.slots["need_statement"].handled:
            return PHASE_NEED_STATEMENT
        return _next_main_phase(state)

    return _next_main_phase(state)


def _next_main_phase(state: DialogueState) -> str:
    for phase in PHASE_ORDER:
        required = required_slots_for_phase(state, phase)
        if any(not state.slots[k].handled for k in required):
            return phase
    if not state.summary_text:
        return PHASE_SUMMARIZE
    if not state.confirmed:
        return PHASE_CONFIRM
    return PHASE_DRAFT_READY


def next_slot(state: DialogueState) -> str | None:
    """The next slot to ask about, or None if the phase asks nothing."""
    phase = compute_phase(state)
    for k in required_slots_for_phase(state, phase):
        if not state.slots[k].handled:
            return k
    # Expert/free-form users are not walked through optional checklist fields.
    if state.dialogue_mode in (MODE_EXPERT, MODE_FREE_FORM):
        return None
    for k in OPTIONAL_SLOTS_BY_PHASE.get(phase, []):
        if not state.slots[k].handled:
            return k
    return None
