"""Primary model-driven BA orchestrator.

Unlike the legacy orchestrator, this class has no phase machine, slot-order
planner, answer relevance gate, or heuristic Q&A router.  One structured model
decision owns each conversational turn. Python only enforces safety, validates
and persists facts, and executes explicit draft/review operations.
"""
from __future__ import annotations

from dataclasses import replace
import time
import re

from .audit import log_draft, log_event, log_refusal
from .composer import composer
from .context import UserContext, style_for
from .dialogue import confinement
from .dialogue.agentic import LLMUnavailable, agentic_ba
from .dialogue.escalation_handler import escalation_handler
from .dialogue.generator import draft_ready_message, welcome as gen_welcome
from .dialogue.mode_selector import mode_selector
from .dialogue.user_profile import profile_detector
from .dialogue.quality import assess_quality, profile_for
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
        if action == "question":
            state.question_count += 1
            state.consecutive_questions += 1
            state._update_fatigue()
        last_assistant_message = next(
            (
                item.get("content")
                for item in reversed(state.history)
                if item.get("role") == "assistant"
            ),
            None,
        )
        duplicate_technical_message = bool(
            message
            and action in {"unavailable", "error"}
            and last_assistant_message == message
        )
        if message and not duplicate_technical_message:
            state.add_message("assistant", message)
            state.total_agent_messages += 1
        quality = assess_quality(state).as_dict()
        state.quality_assessment = quality
        phase = "agentic_dialogue"
        if state.review_status:
            phase = "sent_for_review"
        elif state.draft:
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

    @staticmethod
    def _asks_about_progress(text: str) -> bool:
        low = text.lower()
        markers = (
            "много еще вопрос", "много ещё вопрос", "сколько еще вопрос",
            "сколько ещё вопрос", "что еще осталось", "что ещё осталось",
            "долго еще", "долго ещё", "можно заканчивать",
        )
        return any(marker in low for marker in markers)

    @staticmethod
    def _remaining_core_labels(state) -> list[str]:
        labels = {
            "need_statement": "потребность", "to_be": "целевое поведение",
            "role": "пользователь", "process": "процесс",
        }
        return [labels[key] for key in state.get_missing_mandatory_hard()]

    @staticmethod
    def _is_solution_design_question(reply: str) -> bool:
        low = reply.lower()
        markers = (
            "синхронн", "асинхронн", "через очередь", "какая очередь",
            "callback", "endpoint", "payload", "протокол интеграции",
            "способ хранения", "топик kafka", "message broker",
        )
        return "?" in reply and any(marker in low for marker in markers)

    @staticmethod
    def _technical_depth_requested(text: str, ctx: UserContext | None) -> bool:
        if style_for(ctx) == "technical":
            return True
        low = text.lower()
        return any(marker in low for marker in (
            "проработать техническ", "технические требования",
            "системные требования", "архитектурное решение",
        ))

    @staticmethod
    def _pre_summary_gap(state: DialogueState) -> tuple[str, str] | None:
        """Return one high-value gap before a model-initiated summary."""
        missing_core = state.get_missing_mandatory_hard()
        if missing_core:
            focus = missing_core[0]
            return focus, agentic_ba.fallback_question(state, focus)
        assessment = assess_quality(state)
        for issue in assessment.issues:
            if issue.slot in {"acceptance_criteria", "value"} and issue.question:
                return issue.slot, issue.question
        required = profile_for(state)["required"]
        if "acceptance_criteria" in required and not state.get("acceptance_criteria"):
            return (
                "acceptance_criteria",
                "Какой измеримый или наблюдаемый результат подтвердит, что доработка выполнена?",
            )
        if not state.get("product"):
            requirement_text = " ".join((
                state.get("need_statement") or "", state.get("to_be") or "",
            )).lower()
            product_markers = (
                "облигац", "еврооблигац", "акци", "репо", "валют", "fx",
                "дериватив", "фонд", "инвестиционн", "сделк",
            )
            if any(marker in requirement_text for marker in product_markers):
                return (
                    "product",
                    "Какой продукт или вид сделок относится к этой доработке?",
                )
        return None

    @staticmethod
    def _one_question(reply: str, focus: str) -> str:
        """Keep one independent question in a conversational turn."""
        text = (reply or "").strip()
        if text.count("?") > 1:
            return text.split("?", 1)[0].strip() + "?"
        interrogatives = re.findall(
            r"\b(?:кто|как|какой|какая|какие|где|когда|почему|зачем|есть ли)\b",
            text.lower(), flags=re.I,
        )
        if "?" in text and len(interrogatives) > 1 and focus:
            return agentic_ba.fallback_question(DialogueState(), focus)
        return text

    @staticmethod
    def _is_explicitly_off_topic(text: str) -> bool:
        low = text.lower()
        markers = (
            "погод", "матч", "спорт", "пицц", "стих", "анекдот", "шутк",
            "биткоин", "курс крип", "переговорк", "забронируй", "переведи",
            "перевод слова", "спой", "песн",
        )
        return any(marker in low for marker in markers)

    def new_session(self, user_id: int, ctx: UserContext | None = None) -> AgentResponse:
        state = self.store.new_session(user_id)
        state.session_started_at = time.time()
        log_event("agentic_session_start", {"session_id": state.session_id, "user_id": user_id})
        return self._build_response(state, "welcome", gen_welcome(ctx))

    def handle_message(self, session_id: str, message: str,
                       ctx: UserContext | None = None,
                       message_id: str = "") -> AgentResponse:
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

        # Accept and persist the user turn before calling the model. This is the
        # runtime orchestrator used by the API, so persistence must happen here
        # (not only in the legacy base implementation).
        already_recorded = bool(message_id) and any(
            item.get("role") == "user" and item.get("message_id") == message_id
            for item in state.history
        )
        if not already_recorded:
            state.record_user_answer(text)
            state.add_message("user", text, message_id=message_id)
            self.store.save(state)

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

        escalation = escalation_handler.check_escalation(state, text)
        if escalation.should_escalate:
            state.escalation = True
            state.escalation_reason = escalation.reason
            log_event("escalation", {
                "session_id": state.session_id,
                "reason": escalation.reason,
                "priority": escalation.priority,
            })
            return self._build_response(state, "escalated", escalation.message_to_user)

        if security.verdict == "out_of_domain" and self._is_explicitly_off_topic(text):
            log_refusal(session_id, state.user_id, security.verdict, text)
            result = confinement.register_off_topic(state)
            action = "escalated" if result["escalate"] else "out_of_domain"
            return self._build_response(state, action, result["text"])
        state.ood_strikes = 0

        try:
            decision = agentic_ba.decide_strict(state, text)
        except LLMUnavailable as exc:
            log_event("agentic_llm_unavailable", {
                "session_id": state.session_id,
                "error_type": type(exc.__cause__ or exc).__name__,
                "reason": str(exc)[:300],
            })
            cause = exc.__cause__ or exc
            if isinstance(cause, (ValueError, TypeError)):
                recovered = agentic_ba.recover_need_statement(state)
                if recovered:
                    log_event("agentic_context_recovered", {
                        "session_id": state.session_id,
                        "slot": "need_statement",
                        "source": state.get_slot("need_statement").source,
                    })
                focus = (state.get_missing_mandatory_hard() or ["need_statement"])[0]
                state.last_asked_slot = focus
                return self._build_response(
                    state,
                    "question",
                    agentic_ba.fallback_question(state, focus),
                )
            state.last_asked_slot = ""
            return self._build_response(
                state,
                "unavailable",
                "ИИ-модель сейчас недоступна, поэтому я не могу корректно продолжить сбор требований. "
                "Попробуйте ещё раз позже или обратитесь к администратору сервиса.",
            )
        agentic_ba.guard_facts(state, text, decision)
        updated = agentic_ba.apply(state, decision)

        profile_detector.update_state(state, text)
        mode = mode_selector.select_mode(state, ctx)
        state.set_mode(mode.mode)

        state.last_agent_decision = decision.as_dict()
        state.last_extracted_slots = updated
        state.last_asked_slot = decision.focus or ""

        if decision.next_action == "ask":
            decision.reply = self._one_question(decision.reply, decision.focus)

        wants_draft = normalized in CREATE_DRAFT_WORDS or (
            "черновик" in normalized and any(x in normalized for x in ("сформ", "созд", "подготов"))
        )
        asks_about_progress = self._asks_about_progress(text)
        if asks_about_progress:
            remaining = self._remaining_core_labels(state)
            if not remaining:
                self._prepare_summary(state, ctx)
                state.summary_text = (
                    "Основное уже собрано — обязательных вопросов больше нет. "
                    "Неуточнённые детали можно передать аналитику как открытые вопросы.\n\n"
                    + state.summary_text
                )
                return self._build_response(state, "summarize", state.summary_text)
            decision.reply = (
                "Осталось уточнить обязательные части: " + ", ".join(remaining) + ". "
                "После этого сразу подготовлю резюме."
            )

        if decision.next_action == "ask" \
                and self._is_solution_design_question(decision.reply) \
                and not self._technical_depth_requested(text, ctx):
            if state.all_mandatory_hard_filled():
                if not state.get("open_questions"):
                    state.set(
                        "open_questions",
                        "Технический способ реализации требуется уточнить системному аналитику или архитектору",
                        confidence=1.0,
                        source="system",
                    )
                self._prepare_summary(state, ctx)
                return self._build_response(state, "summarize", state.summary_text)
            missing = state.get_missing_mandatory_hard()
            focus = missing[0] if missing else "need_statement"
            decision.focus = focus
            decision.reply = agentic_ba.fallback_question(state, focus)

        if decision.next_action in {"summarize", "draft"} or wants_draft:
            if not state.get("need_statement"):
                return self._build_response(
                    state, "question", "Сначала опишите саму потребность — после этого подготовлю черновик."
                )
            if not wants_draft:
                gap = self._pre_summary_gap(state)
                if gap:
                    state.last_asked_slot = gap[0]
                    return self._build_response(state, "question", gap[1])
            self._prepare_summary(state, ctx)
            return self._build_response(state, "summarize", state.summary_text)

        # The model signals semantic readiness, while Python guarantees that a
        # sufficiently complete interview does not turn into an optional
        # questionnaire. Expert/free-form sessions also have a short path.
        max_questions = mode_selector.get_max_questions_before_summary(state)
        if state.all_mandatory_hard_filled() and (
            decision.ready_for_draft
            or state.question_count >= max_questions
            or state.fatigue_level in {"tired", "frustrated"}
        ):
            self._prepare_summary(state, ctx)
            return self._build_response(state, "summarize", state.summary_text)

        reply = decision.reply.strip()
        if not reply:
            return self._build_response(
                state, "unavailable",
                "ИИ-модель не сформировала корректный ответ. Попробуйте отправить сообщение ещё раз.",
            )
        action = "question" if decision.next_action == "ask" else decision.next_action
        if action == "question" and state.all_mandatory_hard_filled():
            reply += "\n\nОсновное уже собрано; при желании можно подготовить драфт сейчас, а этот вопрос оставить аналитику."
        return self._build_response(state, action, reply)
