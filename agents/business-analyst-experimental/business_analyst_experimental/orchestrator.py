"""Agent orchestrator: pure-Python dialogue engine.

Input harness -> state machine -> slot extraction -> planner -> composer.
No LLM calls are made in the control path; the LLM (when configured) only
rephrases the deterministic question/answer texts.
"""
from dataclasses import dataclass, field

from .audit import log_dialogue, log_refusal, log_draft, log_event
from .composer import composer
from .composer.schema import RequirementDraft
from .composer.revision import draft_fingerprint
from .config import settings
from .context import UserContext
from .dialogue import confinement
from .dialogue.extractor import extractor
from .dialogue.generator import (
    clarify_answer as gen_clarify,
    confirm_after_edit,
    draft_ready_message,
    edit_prompt,
    incident_triage as gen_incident,
    reflect as reflect_need,
    sent_for_review as gen_sent,
    summarize as gen_summary,
    welcome as gen_welcome,
)
from .dialogue.machine import compute_phase, next_slot
from .dialogue.planner import planner
from .dialogue.state import (
    DialogueState,
    PHASE_ORDER,
    PHASE_CLARIFY_PROCEED,
    PHASE_CLARIFY_ANSWER,
    PHASE_CONFIRM,
    PHASE_DRAFT_READY,
    PHASE_IDENTIFY_INTENT,
    PHASE_INCIDENT_TRIAGE,
    PHASE_NEED_STATEMENT,
    PHASE_SUMMARIZE,
    PHASE_WELCOME,
    SLOT_LABELS,
    OPTIONAL_INTERVIEW_SLOTS,
)
from .dialogue.mode_selector import mode_selector
from .dialogue.qa_handler import qa_handler
from .dialogue.repair_handler import repair_handler
from .dialogue.summary_generator import (
    generate_intermediate_summary,
    should_show_intermediate_summary,
    generate_progress_indicator,
)
from .dialogue.user_profile import profile_detector
from .dialogue.fatigue_detector import fatigue_detector
from .dialogue.metrics import metrics_tracker
from .dialogue.escalation_handler import escalation_handler
from .dialogue.quality import assess_quality
from .dialogue.relevance import assess_answer
from .dialogue.agentic import agentic_ba
from .guardrails import input_harness
from .guardrails.policies import REFUSAL_SENSITIVE
from .kb.retrieval import retrieval
from .llm import rephrase

YES_WORDS = {"да", "yes", "ага", "угу", "да, верно", "всё верно", "все верно", "да, всё верно", "да все верно", "подтверждаю", "конечно", "оформить", "создать", "да, оформить", "да, создавать", "отправить", "да, отправить", "продолжим", "продолжай", "давай", "ок", "понял", "ясно", "всё хорошо", "все хорошо", "норм", "нормально"}
NO_WORDS = {"нет", "no", "не", "не нужно", "завершить", "закрыть", "спасибо, не нужно", "отмена"}
GREETINGS = {"привет", "здравствуйте", "добрый день", "добрый вечер", "доброе утро", "hello", "hi", "здравствуй", "ку"}
SMALL_TALK = {"как дела", "как ты", "что нового", "как настроение"}
RESTART_WORDS = {"начнём заново", "начнем заново", "начать заново", "новый диалог", "сбросить диалог"}
SKIP_WORDS = {"пропустить", "skip", "__skip__", "не знаю", "затрудняюсь"}
CREATE_DRAFT_WORDS = {
    "сформировать черновик", "создать черновик", "подготовить черновик",
    "черновик сейчас", "__create_draft__",
}


@dataclass
class AgentResponse:
    session_id: str
    action: str
    message: str
    blocks: list = field(default_factory=list)
    phase: str = ""
    slots: dict = field(default_factory=dict)
    progress: list = field(default_factory=list)
    draft: dict | None = None
    can_generate_draft: bool = False
    history: list = field(default_factory=list)
    quality: dict = field(default_factory=dict)
    request_id: int | None = None
    expected_slot: str = ""
    dialogue_mode: str = ""
    sources: list = field(default_factory=list)
    draft_revision: str = ""
    product_mode: str = ""
    operator_role: str = ""
    source_context: dict = field(default_factory=dict)
    artifact_type: str = ""
    assignment_passport: dict | None = None
    linked_object: dict | None = None
    proposed_patch: dict | None = None
    readiness: dict = field(default_factory=dict)
    gaps: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)
    schema_version: int = 1
    artifact_revision_history: list = field(default_factory=list)
    storage_version: int = 0
    artifact_id: str = ""
    document_review: dict = field(default_factory=dict)
    document_findings: list = field(default_factory=list)
    document_proposals: list = field(default_factory=list)
    document_sources: list = field(default_factory=list)
    document_generation: dict = field(default_factory=dict)


class AgentOrchestrator:
    def __init__(self, store):
        self.store = store

    # ------------------------------------------------------------- response
    NO_REPHRASE_ACTIONS = (
        "welcome", "session", "summarize", "draft_ready", "sent",
        "reflect", "reflect_correction", "edit", "refused", "escalated",
    )

    def _build_response(self, state, action, message, blocks=None) -> AgentResponse:
        if message and action != "refused" and action not in self.NO_REPHRASE_ACTIONS:
            try:
                message = rephrase.rephrase(message)
            except Exception:
                pass
        if message:
            state.add_message("assistant", message)
            if action != "question":
                state.total_agent_messages += 1
        quality = assess_quality(state).as_dict()
        state.quality_assessment = quality
        phase = compute_phase(state)
        state.phase = phase
        response = AgentResponse(
            session_id=state.session_id,
            action=action,
            message=message,
            blocks=blocks or [],
            phase=phase,
            slots={k: s.value for k, s in state.slots.items() if s.handled},
            progress=state.progress(),
            draft=state.draft,
            can_generate_draft=state.all_required_handled(),
            history=state.history,
            quality=quality,
            request_id=state.review_task_id,
            expected_slot=(state.last_asked_slot or "")
            if not (state.last_asked_slot or "").startswith("__") else "",
            dialogue_mode=state.dialogue_mode,
            sources=state.sources,
            draft_revision=draft_fingerprint(state.draft) if state.draft else "",
        )
        # Response construction mutates history and metrics; persist exactly
        # what the user receives, including early-return branches.
        self.store.save(state)
        return response

    @staticmethod
    def _chips(options=None):
        """Legacy call-site adapter: conversational choice blocks are disabled."""
        return []

    def _question_blocks(self, state: DialogueState, chips) -> list:
        """Dialogue answers are free-form; never emit answer-choice blocks."""
        return []

    # ------------------------------------------------------------- main loop
    def new_session(self, user_id: int, ctx: UserContext | None = None) -> AgentResponse:
        import time
        state = self.store.new_session(user_id)
        state.session_started_at = time.time()

        # Initialize metrics tracking
        metrics_tracker.start_session(state)

        log_event("session_start", {"session_id": state.session_id, "user_id": user_id})
        return self._build_response(state, "welcome", gen_welcome(ctx))

    def handle_message(self, session_id: str, message: str, ctx: UserContext | None = None,
                       message_id: str = "") -> AgentResponse:
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(
                session_id=session_id, action="error",
                message="Сессия не найдена. Начните новый диалог.",
            )

        message = (message or "").strip()
        if not message:
            return self._build_response(state, "question", "Уточните, пожалуйста, что вы имели в виду.")

        normalized = message.lower().strip("!?.,:; ")
        if normalized in RESTART_WORDS:
            import time
            fresh = DialogueState(session_id=state.session_id, user_id=state.user_id)
            fresh.session_started_at = time.time()
            metrics_tracker.start_session(fresh)
            log_event("session_restart", {"session_id": state.session_id, "user_id": state.user_id})
            return self._build_response(
                fresh, "welcome",
                "Начинаем заново. Опишите новую бизнес-проблему или доработку своими словами.",
            )

        # Persist the accepted user turn before any classification, extraction,
        # or LLM work. A browser disconnect or processing failure must not make
        # an already sent message disappear from the restored dialogue.
        already_recorded = bool(message_id) and any(
            item.get("role") == "user" and item.get("message_id") == message_id
            for item in state.history
        )
        if not already_recorded:
            state.add_message("user", message, message_id=message_id)
            self.store.save(state)

        if normalized in SMALL_TALK and not state.slots["need_statement"].handled:
            return self._build_response(
                state, "welcome",
                "Всё хорошо, готов помочь сформировать доработку. Что хотите изменить?",
            )

        # Phase 4: Track user message metrics
        if not already_recorded:
            state.record_user_answer(message)
        
        # Phase 4: Analyze user profile from message
        profile_detector.update_state(state, message)
        
        # Phase 4: Check for escalation before processing
        esc_decision = escalation_handler.check_escalation(state, message)
        if esc_decision.should_escalate:
            state.escalation = True
            state.escalation_reason = esc_decision.reason
            metrics_tracker.update_from_state(state)
            context = escalation_handler.prepare_escalation_context(state)
            log_event("escalation", {
                "session_id": state.session_id,
                "reason": esc_decision.reason,
                "priority": esc_decision.priority,
            })
            self.store.save(state)
            return self._build_response(state, "escalated", esc_decision.message_to_user)

        # greetings at the start of a session are always welcomed
        if message.lower().strip("!. ") in GREETINGS \
                and not state.slots["intent"].handled and not state.slots["need_statement"].handled:
            return self._build_response(
                state,
                "welcome",
                "Привет! Расскажите своими словами, какую проблему или доработку хотите проработать.",
            )

        asks_to_rephrase = any(marker in normalized for marker in (
            "что уточнить", "что именно уточнить", "что вы хотите уточнить",
            "не понял", "не поняла", "переформулируй", "поясни вопрос",
        ))
        if asks_to_rephrase \
                and state.last_asked_slot and not state.last_asked_slot.startswith("__"):
            return self._build_response(
                state, "clarify", self._clarification_for_slot(state.last_asked_slot, state)
            )

        if normalized in {"я отвечал на твой вопрос", "я отвечала на твой вопрос",
                          "я же ответил", "я же ответила", "это был ответ"}:
            return_slot = state.pending_question if state.in_qa_mode else state.last_asked_slot
            if state.in_qa_mode:
                qa_handler.exit_qa_mode(state)
            if return_slot:
                state.last_asked_slot = return_slot
                return self._build_response(
                    state, "clarify",
                    "Да, вы правы — это был ответ на мой вопрос. Я неверно переключился в справочный режим. "
                    + self._clarification_for_slot(return_slot, state),
                )

        # ---------------- reflection correction (not domain-gated) -----------
        if state.reflect_correction_pending:
            state.reflect_correction_pending = False
            self._apply_opportunistic(state, message, ctx)
            if message.strip() and len(message.strip()) > 2:
                state.edit_notes.append(message.strip()[:1000])
            response = self._advance(state, ctx)
            self.store.save(state)
            return response

        # ---------------- input harness (guardrails) -------------------------
        first_turn = not state.slots["intent"].handled and not state.slots["need_statement"].handled
        domain_decision = input_harness.classify_domain_detailed(message)
        verdict = domain_decision.verdict
        if first_turn:
            log_event("domain_decision", {
                "session_id": state.session_id,
                "verdict": verdict,
                "reasons": domain_decision.reasons,
                "strong_count": domain_decision.strong_count,
                "weak_count": domain_decision.weak_count,
                "requirement_shaped": domain_decision.requirement_shaped,
            })

        # UI/user control commands are part of the active requirement flow even
        # though they intentionally contain no domain vocabulary.
        if state.pending_quality_slot or self._wants_draft_now(message) \
                or (state.draft and self._wants_edit(message)):
            verdict = "in_domain"

        # short answers / affirmations (chips, confirmations) are in-domain
        if verdict in ("out_of_domain", "possibly_in_domain") and self._is_affirmation(message):
            verdict = "in_domain"

        if verdict == "out_of_domain" and not first_turn \
                and self._is_plausible_slot_answer(state, message, ctx):
            verdict = "in_domain"

        # Ambiguous mid-flow text is usually an answer to the current question,
        # but clearly out-of-domain text must never be written into a slot.
        if verdict == "possibly_in_domain" and (not first_turn or state.domain_confirmed):
            verdict = "in_domain"

        if verdict == "malicious_or_policy_violation":
            log_refusal(session_id, state.user_id, verdict, message)
            self.store.save(state)
            return self._build_response(state, "refused", REFUSAL_SENSITIVE)

        if verdict == "out_of_domain":
            resp = self._handle_out_of_domain(state, message)
            self.store.save(state)
            return resp

        if verdict == "possibly_in_domain" and not state.domain_asked:
            state.domain_asked = True
            state.pending_domain_message = message
            text = "Уточните, пожалуйста: ваш запрос относится к платформе сопровождения инвестиционных сделок?"
            self.store.save(state)
            return self._build_response(state, "domain_clarify", text)

        if state.domain_asked and self._yes_no(message) is False:
            state.domain_asked = False
            state.pending_domain_message = ""
            resp = self._handle_out_of_domain(state, message)
            self.store.save(state)
            return resp
        if state.domain_asked and self._yes_no(message) is True:
            state.domain_confirmed = True
            state.need_reflected = True
            if state.pending_domain_message:
                message = state.pending_domain_message
            state.pending_domain_message = ""

        state.domain_asked = False

        if self._wants_draft_now(message):
            if not state.all_mandatory_hard_filled():
                missing = ", ".join(SLOT_LABELS.get(k, k) for k in state.get_missing_mandatory_hard())
                return self._build_response(
                    state, "question",
                    f"Для полезного черновика осталось уточнить: {missing}. После этого его можно будет сформировать сразу.",
                )
            for slot in state.slots.values():
                if not slot.handled:
                    slot.status = "skipped"
            state.summary_text = ""
            self._prepare_summary(state, ctx)
            return self._build_response(
                state, "summarize",
                state.summary_text + "\n\nНезаполненные детали будут переданы аналитику как открытые вопросы.",
                self._confirm_chips(),
            )

        if state.fatigue_offer_pending:
            answer = self._yes_no(message)
            state.fatigue_offer_pending = False
            if answer is True:
                for slot in state.slots.values():
                    if not slot.handled:
                        slot.status = "skipped"
                self._prepare_summary(state, ctx)
                state.confirmed = True
                draft = composer.build_draft(state, ctx)
                state.draft = draft.model_dump()
                import time
                state.draft_created_at = time.time()
                log_draft(state.session_id, state.user_id, draft.id, draft.status, draft.completeness_score)
                self.store.save(state)
                return self._build_response(
                    state, "draft_ready",
                    draft_ready_message(draft.completeness_score, draft.confidence),
                    self._draft_blocks(draft),
                )
            if answer is False:
                response = self._advance(state, ctx)
                self.store.save(state)
                return response

        if state.intermediate_summary_pending:
            state.intermediate_summary_pending = False
            if self._yes_no(message) is True:
                response = self._advance(state, ctx)
                self.store.save(state)
                return response

        # ---------------- Phase 3: Q&A mode handling -------------------------
        if state.in_qa_mode:
            # User is answering a question we asked in Q&A mode
            return_slot = qa_handler.exit_qa_mode(state)
            # Continue with normal flow, returning to the pending slot
            if return_slot:
                state.last_asked_slot = return_slot
            # Fall through to normal processing

        # ---------------- Phase 3: Check if user is asking a question --------
        # Only handle Q&A if:
        # 1. Not in first turn (we need to establish intent first)
        # 2. Not in repair mode
        # 3. Message is clearly a question (ends with ? or has question markers)
        # 4. We're not in incident/clarification flow
        intent = state.get("intent")
        is_clear_question = message.strip().endswith("?") or (
            qa_handler.is_question(message) and 
            not any(kw in message.lower() for kw in ["ошибка", "не работает", "баг", "инцидент", "сбой"])
        )
        has_requirement_answer = any(marker in message.lower() for marker in (
            "просто нужен", "просто нужна", "нужно ", "необходимо ",
            "добавить", "изменить", "для удобства", "хотим ", "должен ",
        ))
        
        explicit_knowledge_question = message.lower().lstrip().startswith((
            "что такое", "как работает", "что означает", "где посмотреть", "какие есть"
        ))
        active_interview_answer = bool(state.last_asked_slot and not explicit_knowledge_question)

        if (not state.in_qa_mode and is_clear_question and not has_requirement_answer and
            not active_interview_answer and
            not first_turn and 
            intent not in ("incident", "clarification") and
            not state.incident_only):
            # User is asking a question about the platform
            qa_response = qa_handler.handle_question(state, message)
            self.store.save(state)
            return self._build_response(state, "clarify", qa_response.answer)

        # ---------------- Phase 3: Check for repair intent -------------------
        if not state.repair_mode:
            repair_decision = repair_handler.detect_repair(state, message)
            if repair_decision.should_repair:
                state.enter_repair_mode(repair_decision.slot)
                if repair_decision.new_value:
                    # Apply repair immediately
                    old_value = state.slots[repair_decision.slot].value if state.slots.get(repair_decision.slot) else None
                    repair_handler.apply_repair(state, repair_decision.slot, repair_decision.new_value, repair_decision.confidence)
                    confirmation = repair_handler.generate_repair_confirmation(
                        repair_decision.slot, old_value or "", repair_decision.new_value
                    )
                    response = self._advance(state, ctx)
                    response.message = confirmation + "\n\n" + response.message
                    if response.history:
                        response.history[-1]["content"] = response.message
                    self.store.save(state)
                    return response
                else:
                    # Ask for new value
                    slot_label = SLOT_LABELS.get(repair_decision.slot, repair_decision.slot)
                    self.store.save(state)
                    return self._build_response(
                        state, "edit",
                        f"Что изменить в поле «{slot_label}»? Укажите новое значение."
                    )

        # ---------------- Phase 3: Handle repair mode input ------------------
        if state.repair_mode and state.repair_slot:
            slot = state.repair_slot
            new_value, confidence = extractor.targeted(state, slot, message, ctx)
            if new_value:
                old_value = state.slots[slot].value if state.slots.get(slot) else None
                repair_handler.apply_repair(state, slot, new_value, confidence)
                confirmation = repair_handler.generate_repair_confirmation(slot, old_value or "", new_value)
                response = self._advance(state, ctx)
                response.message = confirmation + "\n\n" + response.message
                if response.history:
                    response.history[-1]["content"] = response.message
                self.store.save(state)
                return response
            else:
                self.store.save(state)
                return self._build_response(state, "question", "Не понял. Уточните, пожалуйста, новое значение.")

        # ---------------- reflection answer (early understanding check) ------
        if state.need_reflected and state.last_asked_slot == "__reflect__":
            state.last_asked_slot = None
            answer = self._yes_no(message)
            if answer is True:
                response = self._advance(state, ctx)
            elif answer is False and len(message.strip().rstrip("!. ")) <= 4:
                state.reflect_correction_pending = True
                response = self._build_response(
                    state, "reflect_correction",
                    "Уточните, пожалуйста, что именно не так — например, не тот процесс или продукт?",
                    [],
                )
            else:
                # the user described the correction right away
                self._apply_opportunistic(state, message, ctx)
                state.edit_notes.append(message.strip()[:1000])
                response = self._advance(state, ctx)
            self.store.save(state)
            return response

        if state.pending_quality_slot:
            slot = state.pending_quality_slot
            value, confidence = extractor.targeted(state, slot, message, ctx)
            if value:
                old_value = state.get(slot)
                if old_value and old_value != value:
                    state.record_slot_change(slot, old_value, value, reason="quality_clarification")
                state.set(slot, value, confidence=confidence, source="user_clarification")
                state.pending_quality_slot = None
                return self._advance(state, ctx)
            return self._build_response(state, "clarify", "Уточните, пожалуйста, формулировку ещё раз.")

        # ---------------- session terminal states ----------------------------
        if state.finished:
            response = self._build_response(state, "ended", gen_sent(state.review_task_id or 0, "запрос"))
            self.store.save(state)
            return response

        phase = compute_phase(state)
        log_dialogue(session_id, state.user_id, ctx.role_name if ctx else "", message, phase)

        # ---------------- branches -------------------------------------------
        if phase == PHASE_WELCOME or phase == PHASE_IDENTIFY_INTENT:
            response = self._handle_intent(state, message, ctx)
        elif phase == PHASE_NEED_STATEMENT:
            response = self._handle_need_statement(state, message, ctx)
        elif phase == PHASE_CLARIFY_ANSWER:
            response = self._handle_clarify_answer(state, message, ctx)
        elif phase == PHASE_CLARIFY_PROCEED:
            response = self._handle_clarify_proceed(state, message, ctx)
        elif phase == PHASE_INCIDENT_TRIAGE:
            response = self._handle_incident_triage(state, message, ctx)
        elif phase == PHASE_SUMMARIZE or phase == PHASE_CONFIRM:
            response = self._handle_confirm(state, message, ctx)
        elif phase in PHASE_ORDER:
            response = self._handle_slot_phase(state, message, ctx)
        elif phase == PHASE_DRAFT_READY:
            response = self._handle_draft_ready(state, message, ctx)
        else:
            # fallback: no recognised phase
            response = self._build_response(state, "question", "Продолжим сбор деталей по текущему вопросу.")

        self.store.save(state)
        return response

    # --------------------------------------------------------- branch handlers
    def _handle_intent(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        intent, confidence = extractor.extract_intent(message)

        # Allow user to correct a previously set intent
        if state.slots["intent"].handled and intent:
            correction_markers = ["не проблема", "не баг", "не ошибка", "а доработка",
                                  "а feature", "а изменение", "это не", "на самом деле",
                                  "не инцидент", "не вопрос"]
            if any(m in message.lower() for m in correction_markers):
                state.set("intent", intent, confidence=confidence, source="user_correction")
                if len(message.strip()) >= 12:
                    state.set("need_statement", message.strip()[:2000], confidence=0.90)
                return self._advance(state, ctx)

        if not intent:
            state.ask_counts["intent"] = state.ask_counts.get("intent", 0) + 1
            if state.ask_counts["intent"] >= 2 or len(message.strip()) >= 12:
                intent = "problem"
                state.set("intent", intent, confidence=0.70, source="assumption", assumption=True)
                state.set("need_statement", message.strip()[:2000], confidence=0.90)
                self._apply_opportunistic(state, message, ctx)
                return self._advance(state, ctx)
            q = planner.next_question(state, ctx)
            state.last_asked_slot = q["slot"]
            return self._build_response(state, "question", q["question"], self._question_blocks(state, q["chips"]))
        state.set("intent", intent, confidence=confidence, source="user_message")

        if intent == "incident":
            state.incident_only = True
            if len(message.strip()) >= 8:
                state.set("need_statement", message.strip()[:2000], confidence=0.90)
                return self._advance(state, ctx)
            return self._ask_need_statement(state, ctx)
        if intent == "clarification":
            return self._handle_clarify_answer(state, message, ctx)
        # main intents: if the first message already describes the need, use it
        if len(message.strip()) >= 12 and not state.slots["need_statement"].handled:
            state.set("need_statement", message.strip()[:2000], confidence=0.90)
            self._capture_requirement_shape(state, message)
            self._apply_opportunistic(state, message, ctx)
            low = message.lower()
            asks_recolor = any(word in low for word in ("перекрас", "изменить цвет", "поменять цвет"))
            has_color = any(word in low for word in (
                "красн", "зелён", "зелен", "син", "жёлт", "желт", "бел", "чёрн", "черн",
                "сер", "фиолет", "оранж", "голуб", "розов", "бирюз", "бордов",
            ))
            if asks_recolor and not has_color and not state.slots["business_rules"].handled:
                state.last_asked_slot = "business_rules"
                return self._build_response(
                    state,
                    "question",
                    "Какой цвет должен использоваться для кнопок?",
                )
            return self._advance(state, ctx)
        self._apply_opportunistic(state, message, ctx)
        return self._ask_need_statement(state, ctx)

    def _ask_need_statement(self, state: DialogueState, ctx) -> AgentResponse:
        q = planner.next_question(state, ctx)
        state.last_asked_slot = q["slot"]
        return self._build_response(state, "question", q["question"], self._question_blocks(state, q["chips"]))

    def _handle_need_statement(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        state.set("need_statement", message, confidence=0.90, source="user_message")
        self._capture_requirement_shape(state, message)
        # opportunistic extraction in case the text already carries role/product
        self._apply_opportunistic(state, message, ctx)
        return self._advance(state, ctx)

    def _handle_clarify_answer(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        evidence = retrieval.answer_from_kb(message)
        state.clarify_answered = True
        text = gen_clarify(message, evidence)
        blocks = self._chips([("Да, оформить запрос", "да"), ("Нет, спасибо", "нет")])
        return self._build_response(state, "clarify", text, blocks)

    def _handle_clarify_proceed(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        low = message.strip().lower().rstrip("!. ")
        if low in YES_WORDS or low in ("оформить", "оформить запрос", "да, оформить"):
            state.clarify_proceed = True
            state.incident_only = False
            return self._ask_need_statement(state, ctx)
        state.finished = True
        return self._build_response(state, "ended", "Спасибо! Если появятся запросы на доработку — возвращайтесь.")

    def _handle_incident_triage(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        need = state.get("need_statement") or ""
        if not state.incident_triage_done:
            state.incident_triage_done = True
            text = gen_incident(need)
            blocks = self._chips([("Создать запись о дефекте", "создать"), ("Завершить", "завершить")])
            return self._build_response(state, "incident_triage", text, blocks)

        low = message.strip().lower().rstrip("!. ")
        if low in YES_WORDS or "создать" in low or "дефект" in low or "оформить" in low:
            state.confirmed = True
            draft = composer.build_defect_draft(state, ctx)
            state.draft = draft.model_dump()
            state.review_status = ""
            log_draft(state.session_id, state.user_id, draft.id, draft.status, draft.completeness_score)
            return self._build_response(
                state, "draft_ready",
                draft_ready_message(draft.completeness_score, draft.confidence),
                self._draft_blocks(draft),
            )
        state.finished = True
        return self._build_response(state, "ended", "Принято. Если по инциденту нужна помощь — обратитесь в поддержку платформы.")

    def _handle_confirm(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        low = message.strip().lower().rstrip("!. ")

        # first time entering summarize: we asked nothing yet -> produce summary
        if not state.summary_text and not state.needs_edit:
            self._prepare_summary(state, ctx)
            return self._build_response(state, "summarize", state.summary_text, self._confirm_chips())

        # user replied to the summary
        if state.needs_edit:
            note = message.strip()
            if note:
                state.edit_notes.append(note)
            state.needs_edit = False
            state.summary_text = ""
            self._prepare_summary(state, ctx)
            text = confirm_after_edit() + "\n\n" + state.summary_text
            return self._build_response(state, "summarize", text, self._confirm_chips())

        if low in YES_WORDS:
            state.confirmed = True
            draft = composer.build_draft(state, ctx)
            state.draft = draft.model_dump()
            state.review_status = ""
            
            # Phase 4: Track draft creation time
            import time
            state.draft_created_at = time.time()
            
            log_draft(state.session_id, state.user_id, draft.id, draft.status, draft.completeness_score)
            
            # Phase 4: Update final metrics
            metrics_tracker.update_from_state(state)
            
            return self._build_response(
                state, "draft_ready",
                draft_ready_message(draft.completeness_score, draft.confidence),
                self._draft_blocks(draft),
            )
        if low in NO_WORDS or "правк" in low or "исправ" in low or "неверн" in low:
            state.needs_edit = True
            return self._build_response(state, "edit", edit_prompt())
        return self._build_response(state, "summarize", state.summary_text, self._confirm_chips())

    def _handle_draft_ready(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        if state.review_status == "needs_review" and state.review_task_id:
            return self._build_response(
                state,
                "sent",
                gen_sent(state.review_task_id, state.draft.get("title", "") if state.draft else ""),
            )
        low = message.strip().lower().rstrip("!. ")
        if low in NO_WORDS or "правк" in low or "исправ" in low or "редакт" in low:
            state.draft = None
            state.confirmed = False
            state.review_status = ""
            state.needs_edit = True
            return self._build_response(state, "edit", edit_prompt())
        if state.draft:
            return self._build_response(
                state, "draft_ready",
                draft_ready_message(state.draft.get("completeness_score", 0), state.draft.get("confidence", "")),
                self._draft_blocks(state.draft),
            )
        return self._handle_confirm(state, message, ctx)

    def _handle_slot_phase(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        slot = state.last_asked_slot or next_slot(state)
        if not slot:
            return self._advance(state, ctx)

        if any(marker in message.lower() for marker in ("не понимаю", "непонятно", "о чем речь", "о чём речь")):
            return self._build_response(state, "clarify", self._clarification_for_slot(slot, state))

        # Check for affirmations / confirmations before slot extraction
        yes_no = self._yes_no(message)
        if yes_no is True:
            return self._advance(state, ctx)
        if yes_no is False:
            return self._build_response(
                state, "question",
                "Уточните, пожалуйста, что именно не так.",
            )

        opp = self._apply_opportunistic(state, message, ctx)

        if state.slots[slot].handled:
            state.intermediate_summary_shown = False
            return self._advance(state, ctx)

        # The user may deliberately add an important detail instead of
        # answering the last checklist question. Preserve that detail and
        # follow its meaning; do not coerce the whole message into the slot.
        if opp:
            state.intermediate_summary_shown = False
            return self._advance(state, ctx)

        if message.strip().lower().rstrip("!. ") in SKIP_WORDS:
            state.skip(slot)
            state.intermediate_summary_shown = False
            return self._advance(state, ctx)

        # user may be answering a previously asked slot via targeted extraction
        relevance = assess_answer(slot, message)
        if not relevance.relevant:
            state.clarification_failures += 1
            q = planner.next_question(state, ctx, force_slot=slot)
            state.last_asked_slot = slot
            return self._build_response(
                state, "clarify",
                "Не вижу в сообщении ответа на текущий вопрос. " + q["question"],
                self._question_blocks(state, q["chips"]),
            )
        value, confidence = extractor.targeted(state, slot, message, ctx)
        if value:
            state.set(slot, value, confidence=confidence, source="user_message")
            state.last_user_signal = message.strip()[:240]
            if slot not in state.last_extracted_slots:
                state.last_extracted_slots.append(slot)
            state.intermediate_summary_shown = False
            return self._advance(state, ctx)

        # not filled: count attempts, allow one re-ask then skip optional
        state.ask_counts[slot] = state.ask_counts.get(slot, 0) + 1
        if state.ask_counts[slot] >= 2 or slot in OPTIONAL_INTERVIEW_SLOTS:
            state.skip(slot)
            state.intermediate_summary_shown = False
            return self._advance(state, ctx)
        q = planner.next_question(state, ctx)
        state.last_asked_slot = q["slot"]
        return self._build_response(state, "question", q["question"], self._question_blocks(state, q["chips"]))

    # ------------------------------------------------------------- helpers
    @staticmethod
    def _clarification_for_slot(slot: str, state: DialogueState) -> str:
        subject = state.get("need_statement") or "изменение"
        explanations = {
            "role": f"Уточняю, кто будет пользоваться изменением «{subject[:160]}». Если оно относится ко всему интерфейсу, достаточно сказать: «все пользователи».",
            "scenarios": "Имею в виду конкретные ситуации: обычное использование, отсутствие данных и возможные ошибки. Можно описать только то, что уже известно.",
            "as_is": "Хочу понять только текущее состояние: нужной возможности сейчас нет или она реализована иначе?",
            "process": "Под процессом понимаю действие пользователя, во время которого потребуется изменение.",
            "acceptance_criteria": "Нужны наблюдаемые признаки результата: что именно изменится и как это можно проверить.",
        }
        return explanations.get(
            slot, f"Уточняю аспект «{SLOT_LABELS.get(slot, slot)}». Расскажите только то, что вам уже известно."
        )

    @staticmethod
    def _capture_requirement_shape(state: DialogueState, message: str):
        low = message.lower()
        is_card_addition = "карточк" in low and "добав" in low
        is_attribute_change = any(word in low for word in ("поле", "атрибут", "реквизит")) and any(
            word in low for word in ("добав", "вывести", "отобраз", "показ")
        )
        if is_card_addition or is_attribute_change:
            state.requirement_shape = "field_change"
            if not state.slots["to_be"].handled:
                state.set("to_be", message.strip()[:2000], confidence=0.9, source="user_message")
        if any(word in low for word in ("дизайн", "цвет", "перекрас", "кнопк")):
            state.requirement_shape = "field_change"
            if not state.slots["to_be"].handled:
                state.set("to_be", message.strip()[:2000], confidence=0.9, source="user_message")
            if any(word in low for word in ("всей систем", "все кноп", "всех кноп")):
                state.set("role", "все пользователи платформы", confidence=0.75,
                          source="assumption", assumption=True)
                state.set("process", "работа пользователей в интерфейсе платформы",
                          confidence=0.7, source="assumption", assumption=True)

    def _apply_opportunistic(self, state: DialogueState, message: str, ctx):
        agentic_updates = []
        if agentic_ba.enabled():
            decision = agentic_ba.decide_strict(state, message)
            agentic_updates = agentic_ba.apply(state, decision)
            state.last_agent_decision = decision.as_dict()
        opp = extractor.opportunistic(state, message, ctx)
        for key, value_conf in opp.items():
            value, confidence = value_conf
            state.set(key, value, confidence=confidence, source="user_message")
        state.last_user_signal = message.strip()[:240]
        state.last_extracted_slots = list(dict.fromkeys(agentic_updates + list(opp)))
        return {key: (state.get(key), state.get_confidence(key))
                for key in state.last_extracted_slots}

    def _prepare_summary(self, state: DialogueState, ctx):
        duplicate_check = composer.check_duplicates(state)
        state.duplicates = duplicate_check
        kb_sources = retrieval.answer_from_kb(state.get("need_statement") or "", k=3)
        # Search matches are reference material, never confirmation of user facts.
        # Preserve previously used references and legacy assumption records.
        sources = list(state.sources)
        known = {(s.get("record_id"), s.get("doc_id"), s.get("text")) for s in sources}
        for item in kb_sources:
            key = (item.get("record_id"), item.get("doc_id"), item.get("text"))
            if key not in known:
                sources.append({**item, "usage": "reference_candidate"})
                known.add(key)
        state.sources = sources
        notes = list(state.edit_notes)
        state.summary_text = gen_summary(state, notes=notes)

    def _confirm_chips(self):
        """Kept as a compatibility hook; confirmations use free-form input."""
        return []

    def _draft_blocks(self, draft):
        return [
            {"type": "draft_preview", "draft": draft.model_dump() if hasattr(draft, "model_dump") else draft},
            {"type": "actions", "buttons": [
                {"label": "Отправить на ревью", "action": "send_review"},
                {"label": "Внести правки", "action": "edit"},
            ]},
        ]

    def _handle_out_of_domain(self, state: DialogueState, message: str) -> AgentResponse:
        log_refusal(state.session_id, state.user_id, "out_of_domain", message)
        resp = confinement.register_off_topic(state)
        if resp["escalate"]:
            state.escalation = True
        return self._build_response(state, "out_of_domain", resp["text"])

    @staticmethod
    def _yes_no(message: str):
        low = message.strip().lower().rstrip("!. ")
        if low in YES_WORDS:
            return True
        if low in NO_WORDS:
            return False
        return None

    @staticmethod
    def _is_affirmation(message: str) -> bool:
        low = message.lower().strip("!. ")
        if low in YES_WORDS or low in NO_WORDS:
            return True
        filler = {"да", "нет", "всё", "верно", "так", "и", "есть", "правильно",
                  "именно", "подтверждаю", "конечно", "ага", "угу", "yes", "no",
                  "оформить", "создать", "отправить", "запрос", "спасибо", "не",
                  "нужно", "уточню", "полностью"}
        tokens = low.split()
        return bool(tokens) and all(t.strip(",.! ") in filler for t in tokens)

    @staticmethod
    def _wants_draft_now(message: str) -> bool:
        low = message.strip().lower().rstrip("!. ")
        return low in CREATE_DRAFT_WORDS or (
            "черновик" in low
            and any(marker in low for marker in ("сформ", "созд", "подготов", "сейчас"))
        )

    @staticmethod
    def _wants_edit(message: str) -> bool:
        low = message.strip().lower().rstrip("!. ")
        return low in NO_WORDS or any(marker in low for marker in ("правк", "исправ", "редакт"))

    @staticmethod
    def _is_plausible_slot_answer(state: DialogueState, message: str, ctx) -> bool:
        """Allow a direct answer to the current slot without disabling OOD checks."""
        slot = state.last_asked_slot
        low = message.lower().strip()
        if not slot or slot.startswith("__") or low.endswith("?"):
            return False
        obvious_off_topic = (
            "анекдот", "погод", "рецепт", "фильм", "музык", "столиц",
            "курс доллар", "новост", "гороскоп", "стих", "расскажи",
        )
        if any(marker in low for marker in obvious_off_topic):
            return False
        value, confidence = extractor.targeted(state, slot, message, ctx)
        relevance = assess_answer(slot, message)
        if not relevance.relevant:
            return False
        if not value:
            return False
        if slot in {"role", "department", "process", "product", "module", "priority"}:
            return confidence >= 0.6
        return relevance.confidence >= 0.6

    def _advance(self, state: DialogueState, ctx) -> AgentResponse:
        """Recompute phase after a slot was filled; keep asking until we hit a
        non-question phase or need user confirmation."""
        
        # Phase 4: Update metrics
        metrics_tracker.update_from_state(state)
        
        # Phase 4: Check fatigue and adjust behavior
        fatigue = fatigue_detector.assess(state)
        state.fatigue_level = fatigue.level
        
        # Phase 4: If user is frustrated, offer to create draft with gaps
        if not state.fatigue_offer_shown and fatigue_detector.should_offer_draft_with_gaps(state):
            if state.all_mandatory_hard_filled():
                state.fatigue_offer_shown = True
                state.fatigue_offer_pending = True
                summary = generate_intermediate_summary(state)
                progress = generate_progress_indicator(state)
                offer_msg = (
                    f"{summary}\n\n{progress}\n\n"
                    "Вижу, что диалог получается длинным. Могу подготовить черновик "
                    "с открытыми вопросами, а аналитик уточнит детали. Продолжить?"
                )
                blocks = self._chips([("Да, подготовить черновик", "да"), ("Продолжим уточнять", "нет")])
                return self._build_response(state, "summarize", offer_msg, blocks)
        
        # Phase 3: Select/update dialogue mode
        mode_decision = mode_selector.select_mode(state, ctx)
        if state.dialogue_mode != mode_decision.mode:
            old_mode = state.dialogue_mode
            state.set_mode(mode_decision.mode)
            log_event("mode_change", {
                "session_id": state.session_id,
                "old_mode": old_mode,
                "new_mode": mode_decision.mode,
                "reason": mode_decision.reason,
            })
        
        # Phase 3: Check if we should show intermediate summary
        # Phase 4: Also show if user is tired
        show_summary = (not state.intermediate_summary_shown) and (
            should_show_intermediate_summary(state, state.question_count)
            or fatigue_detector.should_show_summary(state)
        )
        if show_summary:
            state.question_count = 0  # Reset counter
            state.intermediate_summary_shown = True
            state.intermediate_summary_pending = True
            summary = generate_intermediate_summary(state)
            progress = generate_progress_indicator(state)
            full_message = f"{summary}\n\n{progress}"
            return self._build_response(state, "reflect", full_message)
        
        intent = state.get("intent")
        # early understanding reflection (main intents only)
        if state.slots["need_statement"].handled and not state.need_reflected \
                and intent not in ("incident", "clarification") and not state.requirement_shape:
            state.need_reflected = True
            state.last_asked_slot = "__reflect__"
            blocks = self._chips([("Да, всё верно", "да"), ("Нет, уточню", "нет")])
            return self._build_response(state, "reflect", reflect_need(state), blocks)

        phase = compute_phase(state)
        if phase == PHASE_SUMMARIZE:
            assessment = assess_quality(state)
            candidates = assessment.conflicts + [
                issue for issue in assessment.issues if issue.code == "acceptance_not_measurable"
            ]
            issue = next((item for item in candidates if item.code not in state.quality_asked_codes), None)
            if issue and issue.slot:
                state.quality_asked_codes.append(issue.code)
                state.pending_quality_slot = issue.slot
                return self._build_response(state, "clarify", issue.question)
        if phase in PHASE_ORDER:
            slot = next_slot(state)
            if slot:
                state.question_count += 1  # Phase 3: Track question count
                state.record_question_asked()  # Phase 4: Track for fatigue detection
                q = planner.next_question(state, ctx) if state.requirement_shape else \
                    planner.next_question(state, ctx, force_slot=slot)
                state.last_asked_slot = q["slot"]
                return self._build_response(state, "question", q["question"], self._question_blocks(state, q["chips"]))
        if phase == PHASE_SUMMARIZE:
            if not state.summary_text and not state.needs_edit:
                self._prepare_summary(state, ctx)
            return self._build_response(state, "summarize", state.summary_text, self._confirm_chips())
        if phase == PHASE_INCIDENT_TRIAGE:
            return self._handle_incident_triage(state, state.history[-1]["content"] if state.history else "", ctx)
        if phase == PHASE_CLARIFY_PROCEED:
            return self._build_response(
                state, "clarify",
                "Оформить запрос на доработку по этому вопросу?",
                self._chips([("Да, оформить запрос", "да"), ("Нет, спасибо", "нет")]),
            )
        if phase == PHASE_DRAFT_READY and state.draft:
            return self._handle_draft_ready(state, "", ctx)
        if state.finished:
            return self._build_response(state, "ended", "Спасибо за обращение!")
        # nothing more to ask: fall back to a question for the next missing slot
        slot = next_slot(state)
        if slot:
            q = planner.next_question(state, ctx, force_slot=slot)
            state.last_asked_slot = q["slot"]
            return self._build_response(state, "question", q["question"], self._question_blocks(state, q["chips"]))
        return self._build_response(state, "ended", "Спасибо за обращение!")

    def confirm_and_send(self, session_id: str, task_id: int, title: str,
                         user_id: int | None = None,
                         expected_draft_hash: str = "") -> AgentResponse:
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if user_id is not None and state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Нет доступа к этой сессии.")
        if not state.draft or not state.confirmed:
            return AgentResponse(session_id=session_id, action="error", message="Сначала сформируйте и подтвердите черновик.")
        if expected_draft_hash and expected_draft_hash != draft_fingerprint(state.draft):
            return AgentResponse(
                session_id=session_id, action="revision_conflict",
                message="Черновик изменился после просмотра. Проверьте текущую редакцию перед отправкой.",
                draft=state.draft, draft_revision=draft_fingerprint(state.draft),
            )
        reviewed_draft = self._review_current_draft(state)
        if reviewed_draft.review_blocked:
            self.store.save(state)
            return AgentResponse(
                session_id=session_id,
                action="validation_error",
                message="Черновик не отправлен: " + " ".join(
                    item["message"] for item in reviewed_draft.review_findings if item["severity"] == "error"
                ),
                draft=state.draft,
            )
        if task_id <= 0:
            return AgentResponse(session_id=session_id, action="error", message="Некорректный идентификатор задачи.")
        if state.review_status == "needs_review":
            if state.review_task_id != task_id:
                return AgentResponse(
                    session_id=session_id, action="revision_conflict",
                    message="Эта редакция уже связана с другим запросом на ревью. Проверьте существующий запрос.",
                    draft=state.draft, draft_revision=draft_fingerprint(state.draft),
                    request_id=state.review_task_id,
                )
            return self._build_response(state, "sent", gen_sent(state.review_task_id or task_id, title))
        state.review_status = "needs_review"
        state.review_task_id = task_id
        self.store.save(state)
        log_event("sent_for_review", {"session_id": session_id, "task_id": task_id})
        return self._build_response(state, "sent", gen_sent(task_id, title))

    def reopen_for_revision(self, session_id: str, user_id: int | None = None,
                            comment: str = "") -> AgentResponse:
        """Return a submitted draft to the owner for an explicit revision."""
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if user_id is not None and state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Нет доступа к этой сессии.")
        if not state.draft:
            return AgentResponse(session_id=session_id, action="error", message="Черновик запроса не найден.")
        state.review_status = ""
        state.review_task_id = None
        note = (comment or "").strip()
        if note:
            state.history.append({"role": "assistant", "content": f"Ревьюер попросил уточнить запрос: {note}"})
        state.history.append({"role": "assistant", "content": "Запрос возвращён на уточнение. Измените нужные разделы и отправьте его повторно."})
        self.store.save(state)
        draft = state.draft
        return self._build_response(
            state, "draft_ready", "Запрос открыт для уточнения.",
            self._draft_blocks(RequirementDraft(**draft)),
        )

    def cancel_review_submission(self, session_id: str, task_id: int,
                                 user_id: int | None = None) -> AgentResponse:
        """Undo only the matching review marker after a coordinator rollback."""
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if user_id is not None and state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Нет доступа к этой сессии.")
        if state.review_status != "needs_review" or state.review_task_id != task_id:
            return self._build_response(state, "unchanged", "Отправка уже изменилась; компенсация не требуется.")
        state.review_status = ""
        state.review_task_id = None
        self.store.save(state)
        log_event("review_submission_compensated", {"session_id": session_id, "task_id": task_id})
        return self._build_response(state, "cancelled", "Отправка на ревью отменена.")

    @staticmethod
    def _review_current_draft(state: DialogueState) -> RequirementDraft:
        """Use the same checks when displaying, restoring and submitting a draft."""
        from .composer.reviewer import has_blocking_findings, review_draft
        data = dict(state.draft)
        data.setdefault("id", f"DRAFT-{state.session_id[:8].upper()}")
        data.setdefault("primary_role", state.get("role") or "")
        data.setdefault("affected_users", state.list_values("users"))
        data.setdefault("process", state.get("process") or "")
        draft = RequirementDraft(**data)
        findings = review_draft(draft)
        draft.review_findings = [finding.as_dict() for finding in findings]
        draft.review_blocked = has_blocking_findings(findings)
        state.draft = draft.model_dump()
        return draft

    def edit_draft_section(self, session_id: str, field: str, value: str,
                           user_id: int | None = None) -> AgentResponse:
        """Apply an explicit user edit to one draft section and rebuild scores."""
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if user_id is not None and state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Нет доступа к этой сессии.")
        if state.review_status == "needs_review" and state.review_task_id:
            return AgentResponse(
                session_id=session_id,
                action="sent_locked",
                message="Отправленное требование доступно только для чтения. Дождитесь возврата с ревью, чтобы внести изменения.",
                draft=state.draft,
                request_id=state.review_task_id,
            )
        field_to_slot = {
            "problem_statement": "need_statement", "current_process": "as_is", "target_process": "to_be",
            "business_value": "value", "user_roles": "users", "product": "product",
            "primary_role": "role", "affected_users": "users", "role": "role", "users": "users",
            "process": "process", "priority": "priority",
            "department": "department",
            "module": "module", "scenarios": "scenarios", "business_rules": "business_rules",
            "data_integrations": "data_integrations", "acceptance_criteria": "acceptance_criteria",
            "dependencies": "dependencies", "risks": "risks",
            "regulatory_flags": "regulatory_flags",
        }
        slot = field_to_slot.get(field)
        clean_value = (value or "").strip()
        if not slot or not clean_value:
            return AgentResponse(session_id=session_id, action="error", message="Некорректный раздел или значение.")
        old_value = state.get(slot) or ""
        state.add_message("user", f"Изменён раздел {field}: {clean_value}")
        edit_message_id = state.history[-1].get("message_id", "")
        state.record_slot_change(slot, old_value, clean_value, reason="explicit_draft_edit")
        state.set(slot, clean_value, confidence=1.0, source="user", confirmed=True,
                  evidence=clean_value, message_id=edit_message_id,
                  provenance=[{"value": clean_value, "evidence": clean_value,
                               "message_id": edit_message_id, "assumption": False, "source": "user"}])
        state.resolve_field_conflicts(slot, clean_value, reason="explicit_draft_edit")
        state.edit_notes.append(f"{field}: {clean_value}"[:1000])
        state.confirmed = True
        state.review_status = ""
        self._prepare_summary(state, None)
        draft = composer.build_draft(state, None)
        if state.draft:
            draft.id = state.draft.get("id", draft.id)
            draft.created_by = state.draft.get("created_by", draft.created_by)
        state.draft = draft.model_dump()
        self.store.save(state)
        return self._build_response(
            state, "draft_ready", "Раздел обновлён, показатели черновика пересчитаны.",
            self._draft_blocks(draft),
        )


_orchestrator_singleton: AgentOrchestrator | None = None


def get_orchestrator(store=None) -> AgentOrchestrator:
    global _orchestrator_singleton
    if _orchestrator_singleton is None:
        if store is None:
            from .session import session_store
            store = session_store
        from .agentic_orchestrator import AgenticOrchestrator
        _orchestrator_singleton = AgenticOrchestrator(store)
    return _orchestrator_singleton
