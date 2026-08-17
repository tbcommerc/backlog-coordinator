"""Agent orchestrator: pure-Python dialogue engine.

Input harness -> state machine -> slot extraction -> planner -> composer.
No LLM calls are made in the control path; the LLM (when configured) only
rephrases the deterministic question/answer texts.
"""
from dataclasses import dataclass, field

from .audit import log_dialogue, log_refusal, log_draft, log_event
from .composer import composer
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
)
from .dialogue.question_bank import OPTIONAL_SLOTS
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
from .guardrails import input_harness
from .guardrails.policies import REFUSAL_SENSITIVE
from .kb.retrieval import retrieval
from .llm import rephrase

YES_WORDS = {"да", "yes", "ага", "угу", "да, верно", "всё верно", "все верно", "да, всё верно", "да все верно", "подтверждаю", "конечно", "оформить", "создать", "да, оформить", "да, создавать", "отправить", "да, отправить"}
NO_WORDS = {"нет", "no", "не", "не нужно", "завершить", "закрыть", "спасибо, не нужно", "отмена"}
GREETINGS = {"привет", "здравствуйте", "добрый день", "добрый вечер", "доброе утро", "hello", "hi", "здравствуй", "ку"}
SKIP_WORDS = {"пропустить", "skip", "__skip__", "не знаю", "затрудняюсь"}


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


class AgentOrchestrator:
    def __init__(self, store):
        self.store = store

    # ------------------------------------------------------------- response
    NO_REPHRASE_ACTIONS = ("welcome", "session")

    def _build_response(self, state, action, message, blocks=None) -> AgentResponse:
        if message and action != "refused" and action not in self.NO_REPHRASE_ACTIONS:
            try:
                message = rephrase.rephrase(message)
            except Exception:
                pass
        if message:
            state.add_message("assistant", message)
        return AgentResponse(
            session_id=state.session_id,
            action=action,
            message=message,
            blocks=blocks or [],
            phase=compute_phase(state),
            slots={k: s.value for k, s in state.slots.items() if s.handled},
            progress=state.progress(),
            draft=state.draft,
            can_generate_draft=state.all_required_handled(),
            history=state.history,
        )

    def _chips(self, options):
        norm = []
        for opt in options or []:
            if isinstance(opt, dict):
                norm.append((opt.get("label", ""), opt.get("value", "")))
            else:
                norm.append(tuple(opt))
        norm = [(label, value) for label, value in norm if label and value]
        if not norm:
            return []
        return [{"type": "chips", "options": [{"label": label, "value": value} for label, value in norm]}]

    # ------------------------------------------------------------- main loop
    def new_session(self, user_id: int, ctx: UserContext | None = None) -> AgentResponse:
        import time
        state = self.store.new_session(user_id)
        state.session_started_at = time.time()
        
        # Initialize metrics tracking
        metrics_tracker.start_session(state)
        
        # Detect user expertise from context
        if ctx:
            profile = profile_detector.infer_profile(state)
            state.user_expertise = profile.expertise
            state.user_preferred_style = profile.style
        
        log_event("session_start", {"session_id": state.session_id, "user_id": user_id})
        return self._build_response(state, "welcome", gen_welcome(ctx))

    def handle_message(self, session_id: str, message: str, ctx: UserContext | None = None) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None:
            state = self.store.new_session(ctx.user_id if ctx else 0)
            return self._build_response(state, "welcome", gen_welcome(ctx))

        message = (message or "").strip()
        if not message:
            return self._build_response(state, "question", "Уточните, пожалуйста, что вы имели в виду.")

        # Phase 4: Track user message metrics
        state.record_user_answer(message)
        
        # Phase 4: Analyze user profile from message
        profile_detector.analyze_message(message)
        
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
            return self._build_response(state, "welcome", gen_welcome(ctx))

        # ---------------- reflection correction (not domain-gated) -----------
        if state.reflect_correction_pending:
            state.reflect_correction_pending = False
            state.add_message("user", message)
            self._apply_opportunistic(state, message, ctx)
            if message.strip() and len(message.strip()) > 2:
                state.edit_notes.append(message.strip()[:1000])
            response = self._advance(state, ctx)
            self.store.save(state)
            return response

        # ---------------- input harness (guardrails) -------------------------
        first_turn = not state.slots["intent"].handled and not state.slots["need_statement"].handled
        verdict = input_harness.classify_domain(message)

        # short answers / affirmations (chips, confirmations) are in-domain
        if verdict in ("out_of_domain", "possibly_in_domain") and self._is_affirmation(message):
            verdict = "in_domain"

        # mid-flow answers / already confirmed domain: user replies to our question
        if verdict in ("out_of_domain", "possibly_in_domain") and (not first_turn or state.domain_confirmed):
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
            text = "Уточните, пожалуйста: ваш запрос относится к платформе сопровождения инвестиционных сделок?"
            blocks = self._chips([("Да", "да"), ("Нет", "нет")])
            self.store.save(state)
            return self._build_response(state, "domain_clarify", text, blocks)

        if state.domain_asked and self._yes_no(message) is False:
            state.domain_asked = False
            resp = self._handle_out_of_domain(state, message)
            self.store.save(state)
            return resp
        if state.domain_asked and self._yes_no(message) is True:
            state.domain_confirmed = True

        state.domain_asked = False
        state.add_message("user", message)

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
        
        if (not state.in_qa_mode and is_clear_question and 
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
                    self.store.save(state)
                    response = self._build_response(state, "reflect_correction", confirmation)
                    # Continue to advance after repair
                    return self._advance(state, ctx)
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
                self.store.save(state)
                response = self._build_response(state, "reflect_correction", confirmation)
                return self._advance(state, ctx)
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
        if not intent:
            state.ask_counts["intent"] = state.ask_counts.get("intent", 0) + 1
            if state.ask_counts["intent"] >= 2 or len(message.strip()) >= 12:
                intent = "problem"
                state.set("intent", intent, confidence=0.70, source="assumption", assumption=True)
                state.set("need_statement", message.strip()[:2000], confidence=0.90)
                self._apply_opportunistic(state, message, ctx)
                return self._advance(state, ctx)
            q = planner.next_question(state, ctx)
            return self._build_response(state, "question", q["question"], self._chips(q["chips"]))
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
            self._apply_opportunistic(state, message, ctx)
            return self._advance(state, ctx)
        self._apply_opportunistic(state, message, ctx)
        return self._ask_need_statement(state, ctx)

    def _ask_need_statement(self, state: DialogueState, ctx) -> AgentResponse:
        q = planner.next_question(state, ctx)
        return self._build_response(state, "question", q["question"], self._chips(q["chips"]))

    def _handle_need_statement(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        state.set("need_statement", message, confidence=0.90, source="user_message")
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

        opp = extractor.opportunistic(state, message, ctx)
        for key, value_conf in opp.items():
            value, confidence = value_conf
            state.set(key, value, confidence=confidence, source="user_message")

        if state.slots[slot].handled:
            return self._advance(state, ctx)

        # user may be answering a previously asked slot via targeted extraction
        value, confidence = extractor.targeted(state, slot, message, ctx)
        if value:
            state.set(slot, value, confidence=confidence, source="user_message")
            return self._advance(state, ctx)

        if message.strip().lower().rstrip("!. ") in SKIP_WORDS:
            state.skip(slot)
            return self._advance(state, ctx)

        # not filled: count attempts, allow one re-ask then skip optional
        state.ask_counts[slot] = state.ask_counts.get(slot, 0) + 1
        if state.ask_counts[slot] >= 2 or slot in OPTIONAL_SLOTS:
            state.skip(slot)
            return self._advance(state, ctx)
        q = planner.next_question(state, ctx)
        return self._build_response(state, "question", q["question"], self._chips(q["chips"]))

    # ------------------------------------------------------------- helpers
    def _apply_opportunistic(self, state: DialogueState, message: str, ctx):
        opp = extractor.opportunistic(state, message, ctx)
        for key, value_conf in opp.items():
            value, confidence = value_conf
            state.set(key, value, confidence=confidence, source="user_message")

    def _prepare_summary(self, state: DialogueState, ctx):
        duplicate_check = composer.check_duplicates(state)
        state.duplicates = duplicate_check
        kb_sources = retrieval.answer_from_kb(state.get("need_statement") or "", k=3)
        state.sources = kb_sources
        notes = list(state.edit_notes)
        state.summary_text = gen_summary(state, notes=notes)

    def _confirm_chips(self):
        return self._chips([("Да, всё верно", "да"), ("Нужны правки", "нет")])

    def _draft_blocks(self, draft):
        return [
            {"type": "draft_preview", "draft": draft.model_dump() if hasattr(draft, "model_dump") else draft},
            {"type": "actions", "buttons": [
                {"label": "Отправить на ревью", "action": "send_review"},
                {"label": "Внести правки", "action": "edit"},
            ]},
        ]

    def _handle_out_of_domain(self, state: DialogueState, message: str) -> AgentResponse:
        state.ood_strikes += 1
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

    def _advance(self, state: DialogueState, ctx) -> AgentResponse:
        """Recompute phase after a slot was filled; keep asking until we hit a
        non-question phase or need user confirmation."""
        
        # Phase 4: Update metrics
        metrics_tracker.update_from_state(state)
        
        # Phase 4: Check fatigue and adjust behavior
        fatigue = fatigue_detector.assess(state)
        state.fatigue_level = fatigue.level
        
        # Phase 4: If user is frustrated, offer to create draft with gaps
        if fatigue_detector.should_offer_draft_with_gaps(state):
            if state.all_mandatory_hard_filled():
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
            state.set_mode(mode_decision.mode)
            log_event("mode_change", {
                "session_id": state.session_id,
                "old_mode": state.dialogue_mode,
                "new_mode": mode_decision.mode,
                "reason": mode_decision.reason,
            })
        
        # Phase 3: Check if we should show intermediate summary
        # Phase 4: Also show if user is tired
        show_summary = should_show_intermediate_summary(state, state.question_count) or fatigue_detector.should_show_summary(state)
        if show_summary:
            state.question_count = 0  # Reset counter
            summary = generate_intermediate_summary(state)
            progress = generate_progress_indicator(state)
            full_message = f"{summary}\n\n{progress}"
            return self._build_response(state, "reflect", full_message)
        
        intent = state.get("intent")
        # early understanding reflection (main intents only)
        if state.slots["need_statement"].handled and not state.need_reflected \
                and intent not in ("incident", "clarification"):
            state.need_reflected = True
            state.last_asked_slot = "__reflect__"
            blocks = self._chips([("Да, всё верно", "да"), ("Нет, уточню", "нет")])
            return self._build_response(state, "reflect", reflect_need(state), blocks)

        phase = compute_phase(state)
        if phase in PHASE_ORDER:
            slot = next_slot(state)
            if slot:
                state.last_asked_slot = slot
                state.question_count += 1  # Phase 3: Track question count
                state.record_question_asked()  # Phase 4: Track for fatigue detection
                q = planner.next_question(state, ctx, force_slot=slot)
                return self._build_response(state, "question", q["question"], self._chips(q["chips"]))
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
            state.last_asked_slot = slot
            q = planner.next_question(state, ctx, force_slot=slot)
            return self._build_response(state, "question", q["question"], self._chips(q["chips"]))
        return self._build_response(state, "ended", "Спасибо за обращение!")

    def confirm_and_send(self, session_id: str, task_id: int, title: str) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        state.review_status = "needs_review"
        state.review_task_id = task_id
        self.store.save(state)
        log_event("sent_for_review", {"session_id": session_id, "task_id": task_id})
        return self._build_response(state, "sent", gen_sent(task_id, title))


_orchestrator_singleton: AgentOrchestrator | None = None


def get_orchestrator(store=None) -> AgentOrchestrator:
    global _orchestrator_singleton
    if _orchestrator_singleton is None:
        if store is None:
            from .session import session_store
            store = session_store
        _orchestrator_singleton = AgentOrchestrator(store)
    return _orchestrator_singleton
