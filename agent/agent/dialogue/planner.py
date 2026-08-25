"""Question planner - picks the next conversational focus.

The user always answers in free form.  UI choices are deliberately not part
of the dialogue contract: the planner returns a question and metadata only.

Now uses Policy Engine to decide the next action and prioritizes slots based
on mandatory status, risk, and confidence.
"""
from ..context import style_for
from ..kb.ontology import ontology
from .state import (
    DialogueState, PHASE_ORDER, MANDATORY_HARD, MANDATORY_SOFT, OPTIONAL,
)
from .machine import compute_phase, next_slot
from .policy import policy_engine, ASK_QUESTION, REQUEST_CLARIFICATION
from .agentic import agentic_ba


class QuestionPlanner:
    CONTEXTUAL_FOLLOW_UPS = {
        "as_is": ("to_be", "Вы описали, как процесс устроен сейчас."),
        "to_be": ("acceptance_criteria", "Целевой результат понятен."),
        "business_rules": ("scenarios", "Ограничение важно — его учёл."),
        "data_integrations": ("acceptance_criteria", "Связь с данными и системами учтена."),
        "value": ("acceptance_criteria", "Понимаю ожидаемый бизнес-эффект."),
    }

    def contextual_slot(self, state: DialogueState) -> tuple[str | None, str]:
        """Prefer a meaningful follow-up to the user's latest point."""
        for understood in reversed(state.last_extracted_slots):
            target, bridge = self.CONTEXTUAL_FOLLOW_UPS.get(understood, (None, ""))
            if target and target in state.slots and not state.slots[target].handled:
                return target, bridge
        return None, ""

    def next_question(self, state: DialogueState, ctx=None, force_slot: str | None = None):
        style = style_for(ctx)

        cached = state.last_agent_decision or {}
        cached_focus = cached.get("focus") or ""
        cached_focus_is_open = not cached_focus or (
            cached_focus in state.slots and not state.slots[cached_focus].handled
        )
        if agentic_ba.enabled() and cached.get("reply") and not force_slot and cached_focus_is_open:
            slot = cached_focus or next_slot(state)
            question = cached["reply"]
            state.last_agent_decision = {}
            state.last_user_signal = ""
            state.last_extracted_slots = []
            return {
                "slot": slot, "question": question, "chips": [],
                "phase": compute_phase(state), "priority": 10.0,
                "reason": "agentic_decision",
            }

        bridge = ""
        contextual_slot, contextual_bridge = self.contextual_slot(state)
        if contextual_slot and force_slot not in ("intent", "need_statement"):
            force_slot = contextual_slot
            bridge = contextual_bridge

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
            # Get priority from policy engine
            priority = policy_engine.get_slot_priority(slot, state)
            
            question = agentic_ba.fallback_question(state, slot)
            if bridge:
                question = f"{bridge} {question}"
            elif state.last_user_signal and len(state.last_user_signal.split()) >= 6:
                signal = state.last_user_signal[:180].rstrip(" ,.;:")
                question = f"Я учёл ваш комментарий: «{signal}». {question}"

            result = {
                "slot": slot,
                "question": question,
                "chips": [],
                "phase": compute_phase(state),
                "priority": priority,
                "reason": f"priority={priority:.2f}",
            }
            state.last_user_signal = ""
            state.last_extracted_slots = []
            return result
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
