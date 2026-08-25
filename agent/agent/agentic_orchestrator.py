"""Primary model-driven BA orchestrator.

Unlike the legacy orchestrator, this class has no phase machine, slot-order
planner, answer relevance gate, or heuristic Q&A router.  One structured model
decision owns each conversational turn. Python only enforces safety, validates
and persists facts, and executes explicit draft/review operations.
"""
from __future__ import annotations

from dataclasses import replace
import time

from .audit import log_draft, log_event, log_refusal
from .composer import composer
from .context import UserContext
from .dialogue.agentic import LLMUnavailable, agentic_ba
from .dialogue.generator import draft_ready_message, welcome as gen_welcome
from .dialogue.quality import assess_quality
from .dialogue.state import DialogueState
from .guardrails import input_harness
from .guardrails.policies import REFUSAL_SENSITIVE
from .orchestrator import (
    AgentOrchestrator, AgentResponse, CREATE_DRAFT_WORDS, GREETINGS,
    NO_WORDS, RESTART_WORDS, YES_WORDS,
)


class AgenticOrchestrator(AgentOrchestrator):
    """Conversation-first runtime; legacy methods are reused only for workflow."""

    def _build_response(self, state, action, message, blocks=None) -> AgentResponse:
        if message:
            state.add_message("assistant", message)
            state.total_agent_messages += 1
        quality = assess_quality(state).as_dict()
        state.quality_assessment = quality
        phase = "agentic_dialogue"
        if state.draft:
            phase = "draft_ready"
        elif state.summary_text:
            phase = "confirm"
        elif state.finished:
            phase = "done"
        response = AgentResponse(
            session_id=state.session_id, action=action, message=message,
            blocks=blocks or [], phase=phase,
            slots={k: s.value for k, s in state.slots.items() if s.handled},
            progress=state.progress(), draft=state.draft,
            can_generate_draft=state.all_mandatory_hard_filled(),
            history=state.history, quality=quality,
            request_id=state.review_task_id,
            expected_slot=state.last_asked_slot or "",
        )
        self.store.save(state)
        return response

    def new_session(self, user_id: int, ctx: UserContext | None = None) -> AgentResponse:
        state = self.store.new_session(user_id)
        state.session_started_at = time.time()
        log_event("agentic_session_start", {"session_id": state.session_id, "user_id": user_id})
        return self._build_response(state, "welcome", gen_welcome(ctx))

    def handle_message(self, session_id: str, message: str,
                       ctx: UserContext | None = None) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        text = (message or "").strip()
        if not text:
            return self._build_response(state, "question", "Напишите, пожалуйста, что хотите изменить.")
        normalized = text.lower().strip("!?.,:; ")

        if normalized in RESTART_WORDS:
            fresh = DialogueState(session_id=state.session_id, user_id=state.user_id)
            fresh.session_started_at = time.time()
            return self._build_response(
                fresh, "welcome", "Начинаем заново. Опишите задачу своими словами."
            )
        if normalized in GREETINGS and not state.get("need_statement"):
            return self._build_response(
                state, "welcome", "Привет! Расскажите своими словами, что хотите изменить."
            )
        if state.draft:
            return self._handle_draft_ready(state, text, ctx)

        # Summary confirmation is an explicit workflow operation, not dialogue planning.
        if state.summary_text and normalized in YES_WORDS:
            return self._handle_confirm(state, text, ctx)
        if state.summary_text and (normalized in NO_WORDS or any(x in normalized for x in ("правк", "исправ"))):
            state.needs_edit = True
            return self._build_response(state, "edit", "Опишите правку своими словами.")

        security = input_harness.classify_domain_detailed(text)
        if security.verdict == "malicious_or_policy_violation":
            log_refusal(session_id, state.user_id, security.verdict, text)
            return self._build_response(state, "refused", REFUSAL_SENSITIVE)

        state.record_user_answer(text)
        state.add_message("user", text)
        try:
            decision = agentic_ba.decide_strict(state, text)
        except LLMUnavailable:
            log_event("agentic_llm_unavailable", {"session_id": state.session_id})
            state.last_asked_slot = ""
            return self._build_response(
                state,
                "unavailable",
                "ИИ-модель сейчас недоступна, поэтому я не могу корректно продолжить сбор требований. "
                "Попробуйте ещё раз позже или обратитесь к администратору сервиса.",
            )
        updated = agentic_ba.apply(state, decision)

        state.last_agent_decision = decision.as_dict()
        state.last_extracted_slots = updated
        state.last_asked_slot = decision.focus or ""

        wants_draft = normalized in CREATE_DRAFT_WORDS or (
            "черновик" in normalized and any(x in normalized for x in ("сформ", "созд", "подготов"))
        )
        if decision.next_action in {"summarize", "draft"} or wants_draft:
            if not state.get("need_statement"):
                return self._build_response(
                    state, "question", "Сначала опишите саму потребность — после этого подготовлю черновик."
                )
            self._prepare_summary(state, ctx)
            return self._build_response(state, "summarize", state.summary_text)

        reply = decision.reply.strip()
        if not reply:
            return self._build_response(
                state, "unavailable",
                "ИИ-модель не сформировала корректный ответ. Попробуйте отправить сообщение ещё раз.",
            )
        action = "question" if decision.next_action == "ask" else decision.next_action
        return self._build_response(state, action, reply)
