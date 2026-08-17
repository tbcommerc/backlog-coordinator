"""Repair handler - handles explicit slot corrections from user.

When user says "нет, я имел в виду не X, а Y" or "измени процесс на Y",
the orchestrator:
1. Detects repair intent
2. Identifies which slot to repair
3. Enters repair mode
4. Updates slot with new value
5. Records change in history
6. Confirms change to user
7. Shows updated summary if needed
"""
import re
from dataclasses import dataclass
from typing import Optional

from .state import DialogueState, SLOT_LABELS, MANDATORY_HARD, MANDATORY_SOFT
from .extractor import extractor


@dataclass
class RepairDecision:
    should_repair: bool
    slot: Optional[str] = None
    new_value: Optional[str] = None
    confidence: float = 0.0
    reason: str = ""


class RepairHandler:
    """Handles explicit slot corrections from user."""

    # Keywords that indicate repair/correction
    # Note: "ошибк" removed because it matches incident reports like "ошибка 500"
    REPAIR_KEYWORDS = [
        "нет, не", "не то", "исправить", "изменить", "поменять",
        "я имел в виду", "имелось в виду", "вернее", "точнее",
        "неправильно", "неверно", "не так",
        "заменить на", "поменять на", "изменить на",
    ]

    # Slot name patterns for explicit slot targeting
    SLOT_PATTERNS = {
        "role": [
            r"рол[юи]", r"пользовател", r"кто", r"бэк-офицер", r"фронт-офицер",
            r"риск-менеджер", r"клиентский менеджер", r"комплаенс",
        ],
        "process": [
            r"процесс", r"расчёт", r"расчет", r"отчётност", r"отчетност",
            r"маржировани", r"клиринг", r"пост-трейд",
        ],
        "product": [
            r"продукт", r"облигац", r"акци", r"паи", r"фонд",
            r"структурн", r"дериватив", r"репо", r"пф[ио]",
        ],
        "module": [
            r"модул", r"сделк", r"расчёт", r"расчет", r"депозитар",
            r"лимит", r"отчёт", r"отчет",
        ],
        "value": [
            r"ценност", r"эффект", r"польз", r"выгод",
        ],
        "need_statement": [
            r"потребност", r"суть", r"описани", r"проблем",
        ],
        "to_be": [
            r"целев", r"результат", r"должн", r"хочу",
        ],
    }

    def detect_repair(self, state: DialogueState, message: str) -> RepairDecision:
        """Detect if user wants to repair/correct a slot."""
        low = message.lower()
        
        # Check for repair keywords
        has_repair_keyword = any(kw in low for kw in self.REPAIR_KEYWORDS)
        if not has_repair_keyword:
            return RepairDecision(should_repair=False)

        # Try to identify which slot to repair
        slot = self._identify_slot(message)
        if not slot:
            # Check if we're repairing the last asked slot
            if state.last_asked_slot and state.last_asked_slot in SLOT_LABELS:
                slot = state.last_asked_slot
            else:
                return RepairDecision(
                    should_repair=False,
                    reason="no_slot_identified"
                )

        # Try to extract new value
        new_value, confidence = self._extract_new_value(state, slot, message)
        
        return RepairDecision(
            should_repair=True,
            slot=slot,
            new_value=new_value,
            confidence=confidence,
            reason="repair_detected"
        )

    def _identify_slot(self, message: str) -> Optional[str]:
        """Identify which slot user wants to repair."""
        low = message.lower()
        
        for slot, patterns in self.SLOT_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, low):
                    return slot
        
        return None

    def _extract_new_value(self, state: DialogueState, slot: str, message: str) -> tuple[Optional[str], float]:
        """Extract new value for the slot from message."""
        # Use extractor to get new value
        if slot == "role":
            return extractor.extract_role(message)
        elif slot == "process":
            return extractor.extract_process(message)
        elif slot == "product":
            return extractor.extract_product(message)
        elif slot == "module":
            return extractor.extract_module(message)
        elif slot == "value":
            # Free text
            return self._extract_free_text(message, "ценност"), 0.7
        elif slot == "need_statement":
            # Free text
            return self._extract_free_text(message, "потребност"), 0.7
        elif slot == "to_be":
            # Free text
            return self._extract_free_text(message, "результат"), 0.7
        else:
            # Generic free text extraction
            return self._extract_free_text(message, slot), 0.6

    def _extract_free_text(self, message: str, context: str) -> Optional[str]:
        """Extract free text value from message."""
        # Try to find value after "на" or "это"
        patterns = [
            rf"на\s+(.+?)(?:\.|$)",
            rf"это\s+(.+?)(?:\.|$)",
            rf"{context}.*?[:—]\s*(.+?)(?:\.|$)",
        ]
        
        low = message.lower()
        for pattern in patterns:
            match = re.search(pattern, low, re.IGNORECASE)
            if match:
                value = match.group(1).strip()
                if len(value) > 3:
                    return value[:500]
        
        # Fallback: take the whole message if it's short
        if len(message) < 200:
            return message.strip()
        
        return None

    def apply_repair(self, state: DialogueState, slot: str, new_value: str, confidence: float = 0.8):
        """Apply repair: update slot and record history."""
        old_slot = state.slots.get(slot)
        old_value = old_slot.value if old_slot else None
        
        # Record change in history
        if old_value and old_value != new_value:
            state.record_slot_change(slot, old_value, new_value, reason="repair")
        
        # Update slot
        state.set(slot, new_value, confidence=confidence, source="user_message")
        
        # Exit repair mode
        state.exit_repair_mode()

    def generate_repair_confirmation(self, slot: str, old_value: str, new_value: str) -> str:
        """Generate confirmation message for repair."""
        slot_label = SLOT_LABELS.get(slot, slot)
        
        if old_value:
            return f"Записал: {slot_label} — {new_value}. Ранее было: {old_value}. Продолжим?"
        else:
            return f"Записал: {slot_label} — {new_value}. Продолжим?"


repair_handler = RepairHandler()
