"""Primary model-driven BA orchestrator.

Unlike the legacy orchestrator, this class has no phase machine, slot-order
planner, answer relevance gate, or heuristic Q&A router.  One structured model
decision owns each conversational turn. Python only enforces safety, validates
and persists facts, and executes explicit draft/review operations.
"""
from __future__ import annotations

from copy import deepcopy
import time
import re

from .audit import log_draft, log_event, log_refusal
from .composer import composer
from .composer.revision import draft_fingerprint
from .context import UserContext, style_for
from .dialogue import confinement
from .dialogue.agentic import LLMUnavailable, agentic_ba
from .dialogue.escalation_handler import escalation_handler
from .dialogue.generator import draft_ready_message, welcome as gen_welcome
from .dialogue.mode_selector import mode_selector
from .dialogue.metrics import metrics_tracker
from .dialogue.user_profile import profile_detector
from .dialogue.quality import assess_quality, profile_for
from .dialogue.state import DialogueState, SLOT_LABELS
from .guardrails import input_harness
from .guardrails.policies import REFUSAL_SENSITIVE
from .kb.retrieval import retrieval
from .orchestrator import (
    AgentOrchestrator, AgentResponse, CREATE_DRAFT_WORDS, GREETINGS,
    NO_WORDS, RESTART_WORDS, YES_WORDS,
)


class AgenticOrchestrator(AgentOrchestrator):
    """Conversation-first runtime; legacy methods are reused only for workflow."""

    def _build_response(self, state, action, message, blocks=None) -> AgentResponse:
        if state.draft:
            self._review_current_draft(state)
        answer_sources = state.sources if action in {"draft_ready", "summarize"} or (
            action == "clarify" and state.last_agent_decision.get("use_knowledge_base")
        ) else []
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
            state.history[-1]["context"] = {
                "sources": deepcopy(answer_sources), "mode": state.dialogue_mode,
                "action": action, "focus": state.last_asked_slot or "",
            }
            state.total_agent_messages += 1
        quality = assess_quality(state).as_dict()
        state.quality_assessment = quality
        phase = "agentic_dialogue"
        if state.review_status:
            phase = "sent_for_review"
        elif state.finished:
            phase = "done"
        elif state.draft:
            phase = "draft_ready"
        elif state.summary_text:
            phase = "confirm"
        state.phase = phase
        response = AgentResponse(
            session_id=state.session_id, action=action, message=message,
            blocks=blocks or [], phase=phase,
            slots={k: s.value for k, s in state.slots.items() if s.handled},
            progress=state.progress(), draft=state.draft,
            can_generate_draft=state.all_mandatory_hard_filled(),
            history=state.history, quality=quality,
            request_id=state.review_task_id,
            expected_slot=state.last_asked_slot or "",
            dialogue_mode=state.dialogue_mode,
            sources=answer_sources,
            draft_revision=draft_fingerprint(state.draft) if state.draft else "",
        )
        metrics_tracker.update_from_state(state)
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
            slot = state.get_slot(issue.slot)
            if slot and slot.status in {"skipped", "unknown", "not_applicable"}:
                continue
            if issue.slot in {"acceptance_criteria", "value"} and issue.question:
                return issue.slot, issue.question
        required = profile_for(state)["required"]
        if "acceptance_criteria" in required and state.get_slot("acceptance_criteria").status == "empty":
            return (
                "acceptance_criteria",
                "Какой измеримый или наблюдаемый результат подтвердит, что доработка выполнена?",
            )
        if state.get_slot("product").status == "empty":
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
    def _question_matches_focus(question: str, focus: str) -> bool:
        markers = {
            "role": r"кто|пользоват|роль", "users": r"кто|пользоват|групп",
            "acceptance_criteria": r"провер|критери|результат|срок|врем|секунд|минут",
            "value": r"ценност|эффект|выгод|сэконом|улучш|сниз",
            "process": r"процесс|этап|операци", "product": r"продукт|сделк|инструмент",
            "data_integrations": r"данн|интеграц|источник|поступ|систем",
            "business_rules": r"правил|услов|огранич|разреш|запре",
            "scenarios": r"сценари|действ|происход|узна|делает",
            "need_statement": r"потребност|проблем|измен|задач",
            "to_be": r"долж|целев|после|результат", "as_is": r"сейчас|текущ|сегодня",
            "regulatory_flags": r"регулятор|норм|закон|комплаенс",
            "dependencies": r"завис|потребу|внешн", "risks": r"риск|опас|сбой",
        }
        return bool(focus in markers and re.search(markers[focus], question, re.I))

    @staticmethod
    def _one_question(reply: str, focus: str) -> str:
        """Keep one independent question in a conversational turn."""
        text = (reply or "").strip()
        if text.count("?") > 1:
            questions = [part.strip() + "?" for part in text.split("?")[:-1] if part.strip()]
            # A reflection preceding the actual question must not steal its focus.
            if len(questions) > 1 and re.search(r"правильно.*понима|верно ли|всё верно", questions[0], re.I):
                questions = questions[1:]
            return next((q for q in questions if AgenticOrchestrator._question_matches_focus(q, focus)), questions[0])
        # Nested interrogatives can express one meaningful question. Keep its context.
        return text

    @staticmethod
    def _summary_is_pending(state: DialogueState) -> bool:
        if not state.summary_text or state.needs_edit:
            return False
        last = next((item for item in reversed(state.history) if item.get("role") == "assistant"), {})
        return last.get("context", {}).get("action") == "summarize" or last.get("content") == state.summary_text

    @staticmethod
    def _application_feedback(decision) -> str:
        results = getattr(decision, "application_results", [])
        failures = [item for item in results if item.get("status") in {"rejected", "conflict"}]
        if not failures:
            if not any(item.get("status") == "applied" for item in results) and re.search(
                r"\b(?:записал[аи]?|зафиксировал[аи]?|добавил[аи]?|добавлен[аоы]?|внес[её]н[аоы]?|сохран[её]н[аоы]?)\b",
                decision.reply, re.I,
            ):
                if results and all(item.get("status") == "unchanged" for item in results):
                    return "Эти сведения уже есть в требовании; новых изменений не внесено."
                return "Новые сведения в требование не внесены. Уточните формулировку изменения."
            return ""
        labels = lambda items: ", ".join(dict.fromkeys(SLOT_LABELS.get(i.get("field"), i.get("field", "поле")) for i in items))
        applied = [item for item in results if item.get("status") == "applied"]
        parts = [f"Обновлены разделы: {labels(applied)}."] if applied else []
        conflicts = [item for item in failures if item.get("status") == "conflict"]
        rejected = [item for item in failures if item.get("status") == "rejected"]
        if conflicts:
            parts.append(f"Найдены противоречия в разделах: {labels(conflicts)}. Обе формулировки сохранены для уточнения.")
        if rejected:
            parts.append(f"Не удалось надёжно связать с вашим ответом сведения для разделов: {labels(rejected)}. Эти поля не изменены.")
        return " ".join(parts)

    @staticmethod
    def _feedback_question(state, decision) -> tuple[str, str]:
        conflicts = [item for item in state.requirement_conflicts if item.get("status") == "open" and item.get("question")]
        critical = next((item for item in conflicts if item.get("severity") == "critical"), None)
        if critical:
            return critical.get("field") or critical.get("slot") or "", critical["question"]
        rejected = [item.get("field") for item in getattr(decision, "application_results", []) if item.get("status") == "rejected"]
        missing = state.get_missing_mandatory_hard()
        focus = next((key for key in missing if key in rejected), "")
        if focus:
            return focus, agentic_ba.fallback_question(state, focus)
        if conflicts:
            return conflicts[0].get("field") or conflicts[0].get("slot") or "", conflicts[0]["question"]
        focus = next((key for key in rejected if key in state.slots), "") or decision.focus or ""
        return focus, agentic_ba.fallback_question(state, focus) if focus else ""

    def _finish_collection(self, state, ctx, *, stop_requested=False, prefix=""):
        """One readiness gate for all model signals, with a bounded interview."""
        if not state.all_mandatory_hard_filled():
            focus = state.get_missing_mandatory_hard()[0]
            state.last_asked_slot = focus
            return self._build_response(state, "question", agentic_ba.fallback_question(state, focus))
        exhausted = state.question_count >= mode_selector.get_max_questions_before_summary(state) or state.fatigue_level in {"tired", "frustrated"}
        gap = self._pre_summary_gap(state)
        if gap and not (stop_requested or exhausted):
            already_asked = any(
                item.get("role") == "assistant" and item.get("content") == gap[1]
                for item in state.history
            )
            if not already_asked:
                state.last_asked_slot = gap[0]
                return self._build_response(state, "question", gap[1])
        self._prepare_summary(state, ctx)
        state.last_asked_slot = ""
        if prefix:
            state.summary_text = prefix + "\n\n" + state.summary_text
        return self._build_response(state, "summarize", state.summary_text)

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
        metrics_tracker.start_session(state)
        log_event("agentic_session_start", {"session_id": state.session_id, "user_id": user_id})
        return self._build_response(state, "welcome", gen_welcome(ctx))

    def _compose_current_draft(self, state, ctx, message="Черновик готов. Проверьте поля и отправьте его на ревью.", *, focus=""):
        previous = state.draft or {}
        self._prepare_summary(state, ctx)
        draft = composer.build_draft(state, ctx)
        draft.id = previous.get("id", draft.id)
        draft.created_by = previous.get("created_by", draft.created_by)
        state.draft = draft.model_dump()
        state.confirmed = True
        state.needs_edit = False
        state.last_asked_slot = focus
        state.draft_created_at = state.draft_created_at or time.time()
        return self._build_response(state, "draft_ready", message, self._draft_blocks(draft))

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

        if state.review_status and state.review_task_id:
            return self._build_response(state, "sent_locked",
                "Требование отправлено и доступно только для чтения. Изменения возможны после возврата с ревью.")

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
        editing_draft = bool(state.draft)

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
        summary_pending = not editing_draft and self._summary_is_pending(state)
        confirmation_words = {"да", "yes", "да, верно", "всё верно", "все верно", "да, всё верно", "да все верно", "подтверждаю", "подтверждаю резюме"}
        if summary_pending and normalized in confirmation_words:
            return self._handle_confirm(state, "да", ctx)
        if normalized in {"завершить", "закрыть", "отмена"}:
            state.finished = True
            response = self._build_response(state, "ended", "Диалог завершён. Собранные сведения сохранены; к ним можно вернуться позже.")
            metrics_tracker.end_session(state)
            return response
        state.finished = False
        if (summary_pending and normalized in NO_WORDS) or normalized in {"внести правки", "исправить", "редактировать"}:
            state.needs_edit = True
            return self._build_response(state, "edit", "Опишите правку своими словами.")

        security = input_harness.classify_domain_detailed(text)
        if security.verdict == "malicious_or_policy_violation":
            log_refusal(session_id, state.user_id, security.verdict, text)
            return self._build_response(state, "refused", REFUSAL_SENSITIVE)

        if escalation_handler._user_requests_human(text):
            state.escalation = True
            state.escalation_reason = "user_requested_human"
            return self._build_response(state, "escalated",
                "Для этого вопроса нужна помощь аналитика. Автоматическая передача диалога не выполнена. "
                "Можно продолжить уточнения здесь или подготовить черновик и отправить его на ревью.")

        if security.verdict == "out_of_domain" and self._is_explicitly_off_topic(text):
            log_refusal(session_id, state.user_id, security.verdict, text)
            result = confinement.register_off_topic(state)
            action = "escalated" if result["escalate"] else "out_of_domain"
            return self._build_response(state, action, result["text"])
        state.ood_strikes = 0

        if normalized in CREATE_DRAFT_WORDS | {"подготовить черновик сейчас"}:
            if not state.all_mandatory_hard_filled():
                missing = ", ".join(self._remaining_core_labels(state))
                return self._build_response(state, "question", f"Для черновика осталось уточнить: {missing}.")
            return self._compose_current_draft(state, ctx)

        try:
            decision = agentic_ba.decide_strict(state, text)
        except LLMUnavailable as exc:
            log_event("agentic_llm_unavailable", {
                "session_id": state.session_id,
                "error_type": type(exc.__cause__ or exc).__name__,
                "reason": str(exc)[:300],
            })
            return self._build_response(
                state,
                "unavailable",
                "ИИ-модель сейчас недоступна, поэтому я не могу корректно продолжить сбор требований. "
                "Попробуйте ещё раз позже или обратитесь к администратору сервиса.",
            )
        previous_metadata = deepcopy((state.requirement_conflicts, state.requirement_assumptions))
        agentic_ba.guard_facts(state, text, decision)
        updated = agentic_ba.apply(state, decision)
        metadata_changed = previous_metadata != (state.requirement_conflicts, state.requirement_assumptions)

        profile_detector.update_state(state, text)
        mode = mode_selector.select_mode(state, ctx)
        state.set_mode(mode.mode)

        state.last_agent_decision = decision.as_dict()
        state.last_extracted_slots = updated
        state.last_asked_slot = decision.focus or ""
        feedback = self._application_feedback(decision)
        escalation = escalation_handler.check_escalation(state)
        state.escalation = escalation.should_escalate
        state.escalation_reason = escalation.reason

        if editing_draft and (updated or metadata_changed):
            focus, question = self._feedback_question(state, decision) if feedback else ("", "")
            notice = feedback or ("Правки внесены в черновик. Проверьте обновлённые поля перед отправкой." if updated else "В черновик добавлены предположения и вопросы для проверки.")
            return self._compose_current_draft(state, ctx, notice + ("\n\n" + question if question else ""), focus=focus)
        if not editing_draft and updated:
            state.summary_text = ""
            state.needs_edit = False

        if decision.use_knowledge_base:
            query = decision.knowledge_query.strip() or text
            evidence = retrieval.answer_from_kb(query, k=4)
            state.sources = evidence
            if evidence:
                excerpts = [item.get("text", "").strip() for item in evidence[:2]]
                excerpts = [item for item in excerpts if item]
                if excerpts:
                    answer = "Найдены справочные фрагменты по теме. Они могут не содержать ответа на ваш конкретный вопрос:\n\n" + "\n\n".join(
                        f"• {item}" for item in excerpts
                    )
                else:
                    answer = "В базе знаний найдены источники, но в них нет текстового ответа."
            else:
                answer = (
                    "В базе знаний пока нет подтверждённых данных по этому вопросу. "
                    "Уточните ответ у PO/BA или владельца соответствующего процесса."
                )
            return self._build_response(state, "clarify", (feedback + "\n\n" if feedback else "") + answer)

        if feedback:
            if not editing_draft and state.all_mandatory_hard_filled() and (
                self._asks_about_progress(text)
                or state.question_count >= mode_selector.get_max_questions_before_summary(state)
                or state.fatigue_level in {"tired", "frustrated"}
            ):
                return self._finish_collection(state, ctx, stop_requested=True, prefix=feedback)
            focus, question = self._feedback_question(state, decision)
            state.last_asked_slot = focus
            return self._build_response(state, "question" if question else "clarify", feedback + ("\n\n" + question if question else ""))

        if editing_draft:
            state.last_asked_slot = ""
            return self._build_response(state, "clarify", "В черновике нет новых изменений. Уточните, какой раздел и как нужно изменить.")

        if decision.next_action == "ask":
            multiple_questions = decision.reply.count("?") > 1
            decision.reply = self._one_question(decision.reply, decision.focus)
            if multiple_questions and not self._question_matches_focus(decision.reply, decision.focus):
                decision.focus = ""
                state.last_asked_slot = ""

        wants_draft = normalized in CREATE_DRAFT_WORDS or (
            "черновик" in normalized and any(x in normalized for x in ("сформ", "созд", "подготов"))
        )
        asks_about_progress = self._asks_about_progress(text)
        if asks_about_progress:
            remaining = self._remaining_core_labels(state)
            if not remaining:
                return self._finish_collection(state, ctx, stop_requested=True, prefix=(
                    "Основное уже собрано — обязательных вопросов больше нет. "
                    "Неуточнённые детали можно передать аналитику как открытые вопросы.\n\n"
                ).strip())
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
                return self._finish_collection(state, ctx)
            missing = state.get_missing_mandatory_hard()
            focus = missing[0] if missing else "need_statement"
            decision.focus = focus
            decision.reply = agentic_ba.fallback_question(state, focus)

        if decision.next_action in {"summarize", "draft"} or decision.ready_for_draft or wants_draft:
            if not state.get("need_statement"):
                return self._build_response(
                    state, "question", "Сначала опишите саму потребность — после этого подготовлю черновик."
                )
            if wants_draft and state.all_mandatory_hard_filled():
                return self._compose_current_draft(state, ctx)
            return self._finish_collection(state, ctx)

        # The model signals semantic readiness, while Python guarantees that a
        # sufficiently complete interview does not turn into an optional
        # questionnaire. Expert/free-form sessions also have a short path.
        max_questions = mode_selector.get_max_questions_before_summary(state)
        if state.all_mandatory_hard_filled() and (
            decision.ready_for_draft
            or state.question_count >= max_questions
            or state.fatigue_level in {"tired", "frustrated"}
        ):
            return self._finish_collection(state, ctx)

        reply = decision.reply.strip()
        if not reply:
            return self._build_response(
                state, "unavailable",
                "ИИ-модель не сформировала корректный ответ. Попробуйте отправить сообщение ещё раз.",
            )
        action = "question" if decision.next_action == "ask" else decision.next_action
        if action == "question" and state.all_mandatory_hard_filled():
            reply += "\n\nОсновное уже собрано; при желании можно подготовить черновик сейчас, а этот вопрос оставить бизнес-аналитику."
        return self._build_response(state, action, reply)
