"""Q&A handler - handles user questions about the platform during dialogue.

When user asks a question (intent=ask_question), the orchestrator:
1. Enters Q&A mode
2. Retrieves answer from knowledge base
3. Returns answer to user
4. Returns to the pending question/slot

This keeps the dialogue flexible while maintaining structure.
"""
from dataclasses import dataclass
from typing import Optional

from .state import DialogueState
from ..kb.retrieval import retrieval


@dataclass
class QAResponse:
    answer: str
    sources: list
    return_to_slot: Optional[str] = None


class QAHandler:
    """Handles user questions about the platform."""

    def __init__(self):
        self.retrieval = retrieval

    def is_question(self, message: str) -> bool:
        """Detect if message is a question about the platform."""
        low = message.lower().strip()
        
        # Question markers
        question_markers = [
            "что такое", "что значит", "как работает", "как понять",
            "объясни", "расскажи", "подскажи", "уточни",
            "какие", "какой", "какая", "какие есть",
            "где", "когда", "почему", "зачем",
            "?", "а что", "а как", "а где",
        ]
        
        return any(marker in low for marker in question_markers)

    def handle_question(self, state: DialogueState, message: str) -> QAResponse:
        """Handle user question and prepare to return to dialogue."""
        
        # Enter Q&A mode, saving the current slot to return to
        slot_to_return = state.last_asked_slot
        state.enter_qa_mode(slot_to_return)
        
        # Retrieve answer from KB
        evidence = self.retrieval.answer_from_kb(message)
        
        # Format answer
        answer = self._format_answer(message, evidence)
        
        return QAResponse(
            answer=answer,
            sources=evidence,
            return_to_slot=slot_to_return
        )

    def _format_answer(self, question: str, evidence: list) -> str:
        """Format answer with sources."""
        if not evidence:
            return (
                "В базе знаний пока нет подтверждённых данных по этому вопросу. "
                "Рекомендую уточнить у PO/BA или в документации платформы."
            )
        
        parts = ["Отвечу по базе знаний платформы:\n"]
        for item in evidence[:2]:
            text = item.get("text", "")
            if text:
                parts.append(f"• {text}")
        
        parts.append("\nВернёмся к вашему требованию.")
        return "\n".join(parts)

    def exit_qa_mode(self, state: DialogueState) -> Optional[str]:
        """Exit Q&A mode and return to pending slot."""
        return_slot = state.pending_question
        state.exit_qa_mode()
        return return_slot
    
    def get_return_slot(self, state: DialogueState) -> Optional[str]:
        """Get the slot to return to without exiting Q&A mode."""
        return state.pending_question


qa_handler = QAHandler()
