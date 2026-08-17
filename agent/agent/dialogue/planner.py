"""Question planner - picks the next question using the deterministic machine.

Adapts the language to the user's style (business vs technical) and attaches
quick-answer chips when available. A "skip" chip is offered for optional
blocks so the dialogue never drags on.

Now uses Policy Engine to decide the next action and prioritizes slots based
on mandatory status, risk, and confidence.
"""
from ..context import style_for
from ..kb.ontology import ontology
from .state import (
    DialogueState, PHASE_ORDER, MANDATORY_HARD, MANDATORY_SOFT, OPTIONAL,
)
from .machine import compute_phase, next_slot
from .question_bank import question_for, chips_for, skip_chip, OPTIONAL_SLOTS
from .policy import policy_engine, ASK_QUESTION, REQUEST_CLARIFICATION


class QuestionPlanner:
    def next_question(self, state: DialogueState, ctx=None, force_slot: str | None = None):
        style = style_for(ctx)
        
        # Use policy engine to decide what to ask
        if not force_slot:
            decision = policy_engine.decide(state, ctx)
            if decision.action in (ASK_QUESTION, REQUEST_CLARIFICATION) and decision.slot:
                slot = decision.slot
            else:
                slot = next_slot(state)
        else:
            slot = force_slot
        
        if slot:
            chips = chips_for(slot)
            if slot in OPTIONAL_SLOTS:
                chips = chips + [skip_chip(slot)]
            
            # Get priority from policy engine
            priority = policy_engine.get_slot_priority(slot, state)
            
            return {
                "slot": slot,
                "question": question_for(slot, style),
                "chips": chips,
                "phase": compute_phase(state),
                "priority": priority,
                "reason": f"priority={priority:.2f}",
            }
        return {"slot": None, "question": "", "chips": [], "phase": compute_phase(state), "priority": 0.0, "reason": ""}
    
    def get_next_slots_by_priority(self, state: DialogueState, limit: int = 3) -> list[dict]:
        """Get the next N slots to ask, sorted by priority."""
        slots_to_ask = []
        
        # Collect all unfilled slots
        for slot_key in MANDATORY_HARD + MANDATORY_SOFT + OPTIONAL:
            slot = state.slots.get(slot_key)
            if slot and not slot.handled:
                priority = policy_engine.get_slot_priority(slot_key, state)
                slots_to_ask.append({
                    "slot": slot_key,
                    "priority": priority,
                    "confidence": slot.confidence,
                })
        
        # Sort by priority (descending)
        slots_to_ask.sort(key=lambda x: x["priority"], reverse=True)
        
        return slots_to_ask[:limit]


planner = QuestionPlanner()
