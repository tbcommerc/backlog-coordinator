"""Escalation handler - determines when to transfer dialogue to human.

Escalation triggers:
1. Repeated out-of-domain attempts (3+ strikes)
2. User explicitly asks for human
3. Too many clarification failures (3+)
4. User is frustrated (fatigue_level = frustrated)
5. Regulatory risk with low confidence
6. High-impact area with uncertainty
7. Conflict between user answers that can't be resolved

When escalation happens:
- Save collected context
- Prepare draft with "requires SME" marker
- Notify user that human will continue
- Log escalation reason
"""
from dataclasses import dataclass
from typing import Optional

from .state import DialogueState, MANDATORY_HARD


@dataclass
class EscalationDecision:
    should_escalate: bool
    reason: str = ""
    priority: str = "normal"  # low | normal | high | urgent
    message_to_user: str = ""
    context_summary: str = ""


# User phrases that indicate they want human help
HUMAN_REQUEST_PHRASES = [
    "хочу человека", "дайте человека", "позовите аналитика",
    "не могу продолжить", "слишком сложно", "нужна помощь человека",
    "вызовите оператора", "хочу говорить с человеком",
    "let me talk to a human", "i want a human", "too complicated",
]

# High-risk areas that need human attention
HIGH_RISK_SLOTS = ["regulatory_flags", "acceptance_criteria", "business_rules"]


class EscalationHandler:
    """Handles escalation decisions and context preparation."""

    def check_escalation(self, state: DialogueState, message: str = "") -> EscalationDecision:
        """Check if dialogue should be escalated."""
        
        # 1. Check for explicit human request
        if self._user_requests_human(message):
            return EscalationDecision(
                should_escalate=True,
                reason="user_requested_human",
                priority="high",
                message_to_user="Понял, передаю диалог аналитику. Он продолжит работу с вашим запросом.",
            )
        
        # 2. Check state-based escalation triggers
        should, reason = state.should_escalate()
        if should:
            priority = self._get_priority(reason, state)
            message = self._get_escalation_message(reason)
            return EscalationDecision(
                should_escalate=True,
                reason=reason,
                priority=priority,
                message_to_user=message,
            )
        
        # 3. Check for high-risk uncertainty
        risk_decision = self._check_high_risk_uncertainty(state)
        if risk_decision.should_escalate:
            return risk_decision
        
        return EscalationDecision(should_escalate=False)

    def _user_requests_human(self, message: str) -> bool:
        """Check if user explicitly asks for human."""
        if not message:
            return False
        low = message.lower()
        return any(phrase in low for phrase in HUMAN_REQUEST_PHRASES)

    def _get_priority(self, reason: str, state: DialogueState) -> str:
        """Determine escalation priority."""
        if reason == "regulatory_low_confidence":
            return "urgent"
        elif reason == "repeated_out_of_domain":
            return "normal"
        elif reason == "user_frustrated":
            return "high"
        elif reason == "repeated_clarification_failures":
            return "high"
        return "normal"

    def _get_escalation_message(self, reason: str) -> str:
        """Get appropriate message for user based on reason."""
        messages = {
            "repeated_out_of_domain": (
                "Похоже, мы не совсем понимаем друг друга. "
                "Передаю диалог аналитику — он поможет разобраться с вашим запросом."
            ),
            "repeated_clarification_failures": (
                "К сожалению, не удалось точно понять некоторые моменты. "
                "Передаю диалог аналитику для более точной проработки требования."
            ),
            "user_frustrated": (
                "Вижу, что диалог получается сложным. "
                "Передаю его аналитику — он поможет быстрее оформить требование."
            ),
            "regulatory_low_confidence": (
                "В вашем запросе есть регуляторные аспекты, которые требуют экспертной проверки. "
                "Передаю диалог специалисту для уточнения деталей."
            ),
        }
        return messages.get(reason, "Передаю диалог аналитику для продолжения работы.")

    def _check_high_risk_uncertainty(self, state: DialogueState) -> EscalationDecision:
        """Check for high-risk areas with uncertainty."""
        # Check if regulatory flags are filled with low confidence
        reg_slot = state.slots.get("regulatory_flags")
        if reg_slot and reg_slot.status == "filled" and reg_slot.confidence < 0.5:
            return EscalationDecision(
                should_escalate=True,
                reason="regulatory_low_confidence",
                priority="urgent",
                message_to_user=(
                    "В вашем запросе есть регуляторные аспекты, которые требуют экспертной проверки. "
                    "Передаю диалог специалисту для уточнения деталей."
                ),
            )
        
        # Check if multiple high-risk slots have low confidence
        low_conf_risk_slots = [
            slot for slot in HIGH_RISK_SLOTS
            if state.slots.get(slot) and 
               state.slots[slot].status == "filled" and 
               state.slots[slot].confidence < 0.6
        ]
        if len(low_conf_risk_slots) >= 2:
            return EscalationDecision(
                should_escalate=True,
                reason="multiple_high_risk_uncertain",
                priority="high",
                message_to_user=(
                    "В вашем запросе есть несколько сложных аспектов, требующих экспертной оценки. "
                    "Передаю диалог аналитику для детальной проработки."
                ),
            )
        
        return EscalationDecision(should_escalate=False)

    def prepare_escalation_context(self, state: DialogueState) -> str:
        """Prepare context summary for human reviewer."""
        parts = ["=== Контекст диалога ===\n"]
        
        # Basic info
        parts.append(f"Session ID: {state.session_id}")
        parts.append(f"User ID: {state.user_id}")
        parts.append(f"Expertise: {state.user_expertise}")
        parts.append(f"Fatigue level: {state.fatigue_level}")
        parts.append("")
        
        # Collected slots
        parts.append("Собранные данные:")
        for key, slot in state.slots.items():
            if slot.status == "filled" and slot.value:
                conf_marker = f" [conf: {slot.confidence:.2f}]" if slot.confidence < 0.8 else ""
                parts.append(f"  • {key}: {slot.value[:100]}{conf_marker}")
        
        # Open questions
        open_q = state.get_open_questions()
        if open_q:
            parts.append("\nОткрытые вопросы:")
            for q in open_q[:5]:
                parts.append(f"  • {q}")
        
        # Slot history (repairs)
        if state.slot_history:
            parts.append("\nИстория изменений:")
            for slot, history in state.slot_history.items():
                for change in history:
                    parts.append(f"  • {slot}: {change['old_value']} → {change['new_value']}")
        
        # Dialogue summary
        parts.append(f"\nВсего сообщений пользователя: {state.total_user_messages}")
        parts.append(f"Всего вопросов агента: {state.question_count}")
        parts.append(f"Непонятых ответов: {state.clarification_failures}")
        
        return "\n".join(parts)


escalation_handler = EscalationHandler()
