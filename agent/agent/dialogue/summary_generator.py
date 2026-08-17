"""Intermediate summary generator - shows collected data during dialogue.

After 3-4 questions or when significant progress is made, the orchestrator
shows an intermediate summary to:
1. Confirm understanding
2. Let user correct mistakes early
3. Reduce feeling of "endless questionnaire"
4. Build trust in the system
"""
from .state import DialogueState, SLOT_LABELS, MANDATORY_HARD, MANDATORY_SOFT


def generate_intermediate_summary(state: DialogueState) -> str:
    """Generate intermediate summary of collected data."""
    parts = ["Что я понял:\n"]
    
    # Show filled slots in logical order
    slot_order = [
        "intent", "need_statement", "role", "process", "product",
        "module", "to_be", "value",
    ]
    
    filled_count = 0
    for slot_key in slot_order:
        slot = state.slots.get(slot_key)
        if slot and slot.status == "filled" and slot.value:
            label = SLOT_LABELS.get(slot_key, slot_key)
            value = slot.value[:200]  # Limit length
            
            # Add confidence indicator if low
            confidence_marker = ""
            if slot.confidence < 0.7:
                confidence_marker = " (уточните, если неверно)"
            
            parts.append(f"• {label}: {value}{confidence_marker}")
            filled_count += 1
    
    if filled_count == 0:
        return "Пока ничего не собрано. Давайте начнём."
    
    # Add prompt to continue or correct
    parts.append("")
    parts.append("Продолжим? Если что-то неверно — скажите, я исправлю.")
    
    return "\n".join(parts)


def should_show_intermediate_summary(state: DialogueState, question_count: int) -> bool:
    """Check if we should show intermediate summary.
    
    Show summary after:
    - 3-4 questions in guided mode
    - 5-6 questions in hybrid mode
    - When significant progress made (many slots filled)
    - When user seems confused (low confidence)
    """
    # Don't show if already in summary phase
    from .machine import compute_phase, PHASE_SUMMARIZE, PHASE_CONFIRM
    phase = compute_phase(state)
    if phase in (PHASE_SUMMARIZE, PHASE_CONFIRM):
        return False
    
    # Show after N questions based on mode
    from .state import MODE_GUIDED, MODE_HYBRID, MODE_FREE_FORM, MODE_EXPERT
    
    if state.dialogue_mode == MODE_GUIDED:
        threshold = 4
    elif state.dialogue_mode == MODE_EXPERT:
        threshold = 2
    elif state.dialogue_mode == MODE_FREE_FORM:
        threshold = 3
    else:  # hybrid
        threshold = 3
    
    if question_count >= threshold:
        return True
    
    # Show if we have many slots filled
    filled_count = sum(1 for slot in state.slots.values() 
                       if slot.status == "filled")
    if filled_count >= 5:
        return True
    
    # Show if average confidence is low
    confidences = [slot.confidence for slot in state.slots.values() 
                   if slot.status == "filled" and slot.confidence > 0]
    if confidences:
        avg_conf = sum(confidences) / len(confidences)
        if avg_conf < 0.6 and filled_count >= 3:
            return True
    
    return False


def generate_progress_indicator(state: DialogueState) -> str:
    """Generate progress indicator showing completion."""
    total_mandatory = len(MANDATORY_HARD) + len(MANDATORY_SOFT)
    filled_mandatory = sum(
        1 for slot in MANDATORY_HARD + MANDATORY_SOFT
        if state.slots.get(slot) and state.slots[slot].status == "filled"
    )
    
    percentage = int((filled_mandatory / total_mandatory) * 100) if total_mandatory > 0 else 0
    
    return f"Собрано: {filled_mandatory}/{total_mandatory} обязательных полей ({percentage}%)"
