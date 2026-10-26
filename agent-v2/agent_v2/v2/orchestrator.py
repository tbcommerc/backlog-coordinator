"""Product-mode orchestration layered on the isolated V1 runtime."""
from __future__ import annotations

import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from ..agentic_orchestrator import AgenticOrchestrator
from ..audit import log_event
from ..context import UserContext
from ..dialogue.agentic import agentic_ba
from ..dialogue.metrics import metrics_tracker
from ..dialogue.state import (
    PRODUCT_MODE_ASSIGNMENT_CAPTURE,
    PRODUCT_MODE_REQUIREMENT_COPILOT,
    SLOT_LABELS,
    DialogueState,
)
from ..orchestrator import AgentResponse
from .composer import (
    build_assignment_passport,
    build_business_requirement_v2,
    record_revision,
)
from .document_import import parse_requirement_document
from .fingerprint import canonical_fingerprint
from .models import (
    AssignmentPassport,
    BusinessRequirementDraftV2,
    LinkedObjectSnapshot,
    ProductMode,
    ProposedPatch,
    SourceContext,
)
from .patches import build_proposed_patch, decide_operation
from .prompts import load_prompt_set
from .readiness import assignment_readiness, requirement_readiness
from .document_workspace import add_source, execute, response_metadata


class V2Orchestrator(AgenticOrchestrator):
    """Keep V1 safety/storage behavior while adding the two V2 product modes."""

    def _mode_readiness(self, state: DialogueState):
        if state.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            return assignment_readiness(state)
        return requirement_readiness(state, state.draft)

    @staticmethod
    def _mode_progress(state: DialogueState) -> list[dict[str, Any]]:
        if state.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            keys = [
                "assignment_statement", "business_goal", "expected_result", "scope_in",
                "originator", "deadline_or_urgency", "owner_next_step",
            ]
        else:
            keys = [
                "need_statement", "business_goal", "as_is", "to_be", "scope_in",
                "scope_out", "role", "process", "scenarios", "business_rules",
                "acceptance_criteria", "dependencies", "risks",
            ]
        result = []
        for key in keys:
            slot = state.slots[key]
            result.append({
                "key": key,
                "label": SLOT_LABELS.get(key, key),
                "filled": slot.status == "filled",
                "status": slot.status,
                "needs_review": slot.needs_review,
            })
        return result

    def _build_response(self, state, action, message, blocks=None) -> AgentResponse:
        document_metadata = response_metadata(state)
        if action == "question":
            state.question_count += 1
            state.consecutive_questions += 1
            state._update_fatigue()
        if message:
            state.add_message("assistant", message)
            state.history[-1]["context"] = {
                "assistant_version": "v2",
                "product_mode": state.product_mode,
                "action": action,
                "focus": state.last_asked_slot or "",
                "prompt_set_version": state.prompt_set_version,
            }
            state.total_agent_messages += 1
        if state.review_status:
            state.phase = "sent_for_review"
        elif state.draft:
            state.phase = "draft_ready"
        elif state.summary_text:
            state.phase = "confirm"
        else:
            state.phase = "agentic_dialogue"
        readiness = self._mode_readiness(state)
        state.quality_assessment = readiness.model_dump()
        metrics_tracker.update_from_state(state)
        self.store.save(state)
        draft = deepcopy(state.draft)
        is_passport = state.artifact_type == "assignment_passport"
        return AgentResponse(
            session_id=state.session_id,
            action=action,
            message=message,
            blocks=blocks or [],
            phase=state.phase,
            slots={key: slot.value for key, slot in state.slots.items() if slot.handled},
            progress=self._mode_progress(state),
            draft=draft,
            can_generate_draft=state.all_mandatory_hard_filled(),
            history=deepcopy(state.history),
            quality=readiness.model_dump(),
            request_id=state.review_task_id,
            expected_slot=state.last_asked_slot or "",
            dialogue_mode=state.dialogue_mode,
            sources=deepcopy(state.sources),
            draft_revision=(draft or {}).get("fingerprint", ""),
            product_mode=state.product_mode,
            operator_role=state.operator_role,
            source_context=deepcopy(state.source_context),
            artifact_type=state.artifact_type,
            assignment_passport=draft if is_passport else None,
            linked_object=deepcopy(state.linked_object_snapshot),
            proposed_patch=deepcopy(state.proposed_patch),
            readiness=readiness.model_dump(),
            gaps=[gap.__dict__.copy() for gap in state.gaps],
            conflicts=deepcopy(state.requirement_conflicts),
            schema_version=state.schema_version,
            artifact_revision_history=deepcopy(state.artifact_revision_history),
            storage_version=int(getattr(state, "_storage_version", 0)),
            **document_metadata,
        )

    @staticmethod
    def _remaining_core_labels(state) -> list[str]:
        return [SLOT_LABELS.get(key, key) for key in state.get_missing_mandatory_hard()]

    @staticmethod
    def _pre_summary_gap(state: DialogueState) -> tuple[str, str] | None:
        missing = state.get_missing_mandatory_hard()
        if not missing:
            return None
        focus = missing[0]
        return focus, AgenticOrchestrator._one_question(
            agentic_ba.fallback_question(state, focus), focus
        )

    def _prepare_summary(self, state: DialogueState, ctx):
        if state.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            values = [
                ("Поручение", state.get("assignment_statement")),
                ("Бизнес-цель", state.get("business_goal")),
                ("Ожидаемый результат", state.get("expected_result")),
                ("В объёме", state.get("scope_in")),
                ("За границами", state.get("scope_out")),
                ("Инициатор", state.get("originator")),
                ("Срок", state.get("deadline_or_urgency")),
                ("Следующий шаг", state.get("owner_next_step")),
            ]
            body = "\n".join(f"- {label}: {value}" for label, value in values if value)
            state.summary_text = (
                "Проверьте итоговую сводку поручения:\n" + body
                + "\n\nПодтвердите сводку, чтобы создать паспорт поручения."
            )
            return
        super()._prepare_summary(state, ctx)
        additions = [
            ("Бизнес-цель", state.get("business_goal")),
            ("Scope in", state.get("scope_in")),
            ("Scope out", state.get("scope_out")),
        ]
        extra = "\n".join(f"- {label}: {value}" for label, value in additions if value)
        if extra:
            state.summary_text += "\n\nДополнительные разделы V2:\n" + extra

    def new_session(
        self,
        user_id: int,
        ctx: UserContext,
        product_mode: str,
        source_context: SourceContext | None = None,
        linked_object: LinkedObjectSnapshot | None = None,
    ) -> AgentResponse:
        mode = ProductMode(product_mode)
        role = (ctx.operator_role or "").upper()
        if role not in {"BA", "PO"}:
            raise ValueError("trusted_operator_role_required")
        state = self.store.new_session(user_id)
        state.session_started_at = time.time()
        state.operator_role = role
        state.product_mode = mode.value
        state.artifact_type = (
            "assignment_passport"
            if mode is ProductMode.ASSIGNMENT_CAPTURE
            else "business_requirement_v2"
        )
        if source_context:
            state.source_context = source_context.model_dump(mode="json")
            if source_context.originator and source_context.originator.display_name:
                state.set(
                    "originator", source_context.originator.display_name,
                    source="originator_statement", confidence=1.0,
                    evidence=source_context.originator.display_name,
                    provenance=[{
                        "kind": "originator_statement",
                        "evidence": source_context.originator.display_name,
                        "confidence": 1.0,
                        "confirmed": True,
                    }],
                )
            if source_context.source_summary:
                add_source(state, {"title": "Исходный запрос", "content": source_context.source_summary})
                key = "assignment_statement" if mode is ProductMode.ASSIGNMENT_CAPTURE else "need_statement"
                state.set(
                    key, source_context.source_summary,
                    source="originator_statement", confidence=1.0,
                    evidence=source_context.source_summary,
                    provenance=[{
                        "kind": "originator_statement",
                        "evidence": source_context.source_summary,
                        "confidence": 1.0,
                        "confirmed": True,
                    }],
                )
        if linked_object:
            state.linked_object_snapshot = linked_object.model_dump(mode="json")
        _, state.prompt_set_version = load_prompt_set(mode.value, role)
        metrics_tracker.start_session(state)
        log_event("v2_session_started", {
            "session_id": state.session_id,
            "user_id": user_id,
            "product_mode": mode.value,
            "operator_role": role,
        })
        if source_context:
            log_event("v2_source_captured", {
                "session_id": state.session_id,
                "source_type": source_context.source_type,
                "channel": source_context.channel,
                "has_originator": bool(source_context.originator),
                "has_attachments": bool(source_context.attachments),
            })
        welcome = (
            ("Суть поручения сохранена в исходном тексте. Автоматический разбор результата, инициатора и срока ещё не выполнен. "
             "Заполните поле «Ожидаемый результат» в документе или попросите помощника разобрать исходный текст."
             if state.get("assignment_statement") else
             "Зафиксируем поручение и подготовим паспорт. Сначала опишите суть поручения.")
            if mode is ProductMode.ASSIGNMENT_CAPTURE
            else "Проработаем бизнес-требование. Опишите проблему, цель или исходный черновик."
        )
        return self._build_response(state, "welcome", welcome)

    def handle_message(self, session_id: str, message: str, ctx=None, message_id: str = "") -> AgentResponse:
        state = self.store.get(session_id)
        if state is not None and ctx is not None and state.user_id != ctx.user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state is not None and state.product_mode == PRODUCT_MODE_REQUIREMENT_COPILOT:
            import re
            text = (message or "").strip()
            normalized_command = text.lower().lstrip("/")
            command = None
            if re.match(r"^(review\b|проверь(?:те)?\b|проверить\b|сделай(?:те)? ревью\b|ревью\b)", normalized_command):
                command = "review"
            elif re.match(r"^(предложи(?:те)?\b|предложить\b|propose_change\b|перепиши(?:те)?\b|улучши(?:те)?\b|дополни(?:те)?\b|сформулируй(?:те)?\b)", normalized_command):
                command = "propose_change" if state.draft else "draft"
            elif re.match(r"^(напиши(?:те)?\b|написать\b|draft\b|составь(?:те)?\b|подготовь(?:те)? (?:бт|бизнес-требования)\b)", normalized_command):
                command = "draft"
            if command:
                state.add_message("user", text, message_id=message_id)
                self.store.save(state)
                return self.document_action(session_id, state.user_id, {
                    "action": command, "instruction": text,
                    "expected_draft_hash": (state.draft or {}).get("fingerprint", ""),
                })
        if state is not None:
            normalized = (message or "").lower().strip("!?.,:; ")
            confirmations = {
                "да", "yes", "да, верно", "всё верно", "все верно",
                "подтверждаю", "подтверждаю резюме",
            }
            if self._summary_is_pending(state) and normalized in confirmations:
                state.final_summary_confirmed = True
                self.store.save(state)
        response = super().handle_message(session_id, message, ctx, message_id)
        if response.action == "refused":
            log_event("v2_security_refusal", {
                "session_id": session_id,
                "user_id": state.user_id if state else 0,
            })
        return response

    def _compose_current_draft(
        self,
        state,
        ctx,
        message="Артефакт готов. Проверьте его перед следующим действием.",
        *,
        focus="",
    ):
        revising_confirmed_artifact = bool(state.draft)
        # A patch is bound to one immutable artifact revision. Any new
        # revision invalidates that preview and requires rebuilding it.
        state.proposed_patch = None
        if state.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            artifact = build_assignment_passport(state, ctx)
        else:
            artifact = build_business_requirement_v2(state, ctx)
        if revising_confirmed_artifact:
            state.final_summary_confirmed = True
            readiness = self._mode_readiness(state)
            if isinstance(artifact, BusinessRequirementDraftV2):
                artifact.quality = readiness
            else:
                artifact.readiness = readiness
            from .fingerprint import canonical_fingerprint
            artifact.fingerprint = canonical_fingerprint(artifact)
        record_revision(state, artifact, author_kind="operator")
        state.confirmed = True
        state.needs_edit = False
        state.last_asked_slot = focus
        state.draft_created_at = state.draft_created_at or time.time()
        log_event("v2_artifact_revision_created", {
            "session_id": state.session_id,
            "artifact_type": state.artifact_type,
            "revision": artifact.revision,
            "fingerprint": artifact.fingerprint,
        })
        return self._build_response(state, "draft_ready", message, self._draft_blocks(artifact))

    def _handle_confirm(self, state: DialogueState, message: str, ctx) -> AgentResponse:
        """Route a confirmed V2 summary through the V2 artifact composer."""
        normalized = (message or "").lower().strip("!?.,:; ")
        confirmations = {
            "да", "yes", "да, верно", "всё верно", "все верно",
            "да, всё верно", "да все верно", "подтверждаю", "подтверждаю резюме",
        }
        if state.summary_text and not state.needs_edit and normalized in confirmations:
            state.final_summary_confirmed = True
            return self._compose_current_draft(state, ctx)
        return super()._handle_confirm(state, message, ctx)

    def handoff(self, session_id: str, user_id: int) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.product_mode != PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            return AgentResponse(session_id=session_id, action="error", message="Handoff доступен только для паспорта поручения.")
        readiness = assignment_readiness(state)
        if not readiness.ready:
            return self._build_response(state, "validation_error", "Паспорт пока не готов к передаче.")
        passport = AssignmentPassport(**state.draft) if state.draft else build_assignment_passport(state, None)
        if not state.draft:
            record_revision(state, passport, author_kind="operator")
        state.handoff_context = {
            "assignment_passport": passport.model_dump(mode="json"),
            "handoff_at": datetime.now(timezone.utc).isoformat(),
        }
        mapping = {
            "assignment_statement": "need_statement",
            "expected_result": "to_be",
            "initial_risks": "risks",
        }
        for source_key, target_key in mapping.items():
            source = state.slots[source_key]
            if source.handled:
                state.slots[target_key] = deepcopy(source)
                state.slots[target_key].key = target_key
        state.product_mode = PRODUCT_MODE_REQUIREMENT_COPILOT
        state.artifact_type = "business_requirement_v2"
        state.draft = None
        state.proposed_patch = None
        state.final_summary_confirmed = False
        state.summary_text = ""
        state.review_status = ""
        state.review_task_id = None
        _, state.prompt_set_version = load_prompt_set(state.product_mode, state.operator_role)
        log_event("v2_mode_selected", {
            "session_id": state.session_id,
            "product_mode": state.product_mode,
            "from_artifact_fingerprint": passport.fingerprint,
        })
        return self._build_response(
            state,
            "handoff",
            "Паспорт сохранён. Подтверждённые сведения перенесены в глубокую проработку требования.",
        )

    def link_object(self, session_id: str, user_id: int, snapshot: LinkedObjectSnapshot) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        state.linked_object_snapshot = snapshot.model_dump(mode="json")
        state.proposed_patch = None
        state.sources.append({
            "kind": "linked_object_snapshot",
            "object_type": snapshot.object_type,
            "object_id": snapshot.object_id,
            "fingerprint": snapshot.fingerprint,
            "version": snapshot.object_version,
        })
        log_event("v2_object_linked", {
            "session_id": session_id,
            "object_type": snapshot.object_type,
            "object_id": snapshot.object_id,
            "fingerprint": snapshot.fingerprint,
        })
        return self._build_response(state, "object_linked", "Связанный объект добавлен как read-only snapshot.")

    def proposed_patch(self, session_id: str, user_id: int, current_fingerprint: str = "") -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.product_mode != PRODUCT_MODE_REQUIREMENT_COPILOT or not state.draft:
            return self._build_response(state, "validation_error", "Сначала подготовьте BusinessRequirementDraftV2.")
        if not state.linked_object_snapshot:
            return self._build_response(state, "validation_error", "Связанный объект не выбран.")
        patch = build_proposed_patch(
            session_id,
            LinkedObjectSnapshot(**state.linked_object_snapshot),
            BusinessRequirementDraftV2(**state.draft),
            current_snapshot_fingerprint=current_fingerprint,
        )
        state.proposed_patch = patch.model_dump(mode="json")
        log_event("v2_patch_proposed", {
            "session_id": session_id,
            "patch_id": patch.id,
            "operation_count": len(patch.operations),
            "status": patch.status,
        })
        if patch.status == "stale":
            log_event("v2_linked_snapshot_stale", {
                "session_id": session_id,
                "patch_id": patch.id,
                "object_type": patch.target.object_type,
                "object_id": patch.target.object_id,
            })
        return self._build_response(state, "patch_preview", "Предложения подготовлены только для preview.")

    def decide_patch_operation(
        self,
        session_id: str,
        user_id: int,
        operation_index: int,
        decision: str,
    ) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if not state.proposed_patch:
            return self._build_response(state, "validation_error", "ProposedPatch не найден.")
        patch = decide_operation(ProposedPatch(**state.proposed_patch), operation_index, decision)
        state.proposed_patch = patch.model_dump(mode="json")
        state.sources.append({
            "kind": "human_decision",
            "decision_type": "patch_accept" if decision == "accepted" else "patch_reject",
            "patch_id": patch.id,
            "operation_index": operation_index,
        })
        log_event("v2_patch_operation_decided", {
            "session_id": session_id,
            "patch_id": patch.id,
            "operation_index": operation_index,
            "decision": decision,
        })
        return self._build_response(state, "patch_decided", "Решение сохранено только в сессии V2.")

    def confirm_and_send(
        self,
        session_id: str,
        task_id: int,
        title: str,
        user_id: int | None = None,
        expected_draft_hash: str = "",
    ) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or (user_id is not None and state.user_id != user_id):
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.product_mode != PRODUCT_MODE_REQUIREMENT_COPILOT or not state.draft:
            return self._build_response(state, "validation_error", "На review можно отправить только BusinessRequirementDraftV2.")
        readiness = requirement_readiness(state, state.draft)
        if not readiness.ready:
            return self._build_response(state, "validation_error", "Черновик не готов: " + ", ".join(readiness.blocking_codes))
        current = state.draft.get("fingerprint", "")
        if expected_draft_hash != current:
            return self._build_response(state, "revision_conflict", "Черновик изменился после просмотра.")
        if task_id <= 0:
            return self._build_response(state, "validation_error", "Некорректный идентификатор review request.")
        if state.review_status == "needs_review":
            if state.review_task_id != task_id:
                return self._build_response(state, "revision_conflict", "Редакция уже связана с другим review request.")
            return self._build_response(state, "sent", "Эта редакция уже отправлена на ревью.")
        state.review_status = "needs_review"
        state.review_task_id = task_id
        log_event("v2_review_submitted", {
            "session_id": session_id,
            "request_id": task_id,
            "fingerprint": current,
        })
        return self._build_response(state, "sent", f"Требование «{title}» отправлено в существующую очередь review.")

    def reopen_for_revision(self, session_id: str, user_id: int | None = None, comment: str = "") -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or (user_id is not None and state.user_id != user_id):
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if not state.draft:
            return AgentResponse(session_id=session_id, action="error", message="Артефакт не найден.")
        state.review_status = ""
        state.review_task_id = None
        state.final_summary_confirmed = False
        state.sources.append({
            "kind": "human_decision",
            "decision_type": "review_feedback",
            "evidence": (comment or "")[:5000],
        })
        log_event("v2_review_reopened", {"session_id": session_id})
        return self._build_response(state, "draft_ready", "Требование открыто для новой ревизии.")

    def cancel_review_submission(self, session_id: str, task_id: int, user_id: int | None = None) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or (user_id is not None and state.user_id != user_id):
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.review_status != "needs_review" or state.review_task_id != task_id:
            return self._build_response(state, "unchanged", "Компенсация не требуется.")
        state.review_status = ""
        state.review_task_id = None
        return self._build_response(state, "cancelled", "Привязка к review отменена.")

    def edit_draft_section(self, session_id: str, field: str, value: str, user_id: int | None = None) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or (user_id is not None and state.user_id != user_id):
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.review_status == "needs_review":
            return self._build_response(state, "sent_locked", "Отправленная редакция доступна только для чтения.")
        field_to_slot = {
            "title": "title",
            "assignment_statement": "assignment_statement", "business_goal": "business_goal",
            "expected_result": "expected_result", "scope_in": "scope_in", "scope_out": "scope_out",
            "originator": "originator", "deadline_or_urgency": "deadline_or_urgency",
            "owner_next_step": "owner_next_step", "stakeholders": "stakeholders",
            "constraints": "constraints", "problem_statement": "need_statement",
            "current_process": "as_is", "target_process": "to_be", "actors": "actors",
            "scenarios": "scenarios", "alternative_scenarios": "alternative_scenarios",
            "exception_scenarios": "exception_scenarios", "business_rules": "business_rules",
            "data_integrations": "data_integrations", "functional_requirements": "functional_requirements",
            "non_functional_requirements": "non_functional_requirements",
            "acceptance_criteria": "acceptance_criteria", "success_metrics": "success_metrics",
            "dependencies": "dependencies", "risks": "risks", "role": "role", "process": "process",
        }
        slot_key = field_to_slot.get(field)
        clean = (value or "").strip()
        if not slot_key or not clean:
            return self._build_response(state, "validation_error", "Некорректный раздел или значение.")
        old = (state.draft or {}).get("title", "") if field == "title" else state.get(slot_key) or ""
        message_id = f"edit-{len(state.artifact_revision_history) + 1}"
        state.record_slot_change(slot_key, old, clean, reason="manual_edit")
        state.set(
            slot_key, clean, confidence=1.0, source="human_decision", confirmed=True,
            evidence=clean, message_id=message_id,
            provenance=[{
                "kind": "human_decision", "decision_type": "manual_edit",
                "evidence": clean, "message_id": message_id,
                "confidence": 1.0, "confirmed": True,
            }],
        )
        state.proposed_patch = None
        # The operator edits an already confirmed artifact explicitly; retained
        # fields come from that confirmed revision and the changed field gets a
        # human_decision provenance record above.
        state.final_summary_confirmed = True
        artifact = (
            build_assignment_passport(state, None)
            if state.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE
            else build_business_requirement_v2(state, None)
        )
        if field == "title":
            artifact.title = clean
            artifact.fingerprint = canonical_fingerprint(artifact)
        record_revision(
            state,
            artifact,
            author_kind="operator",
            applied_operations=[{"op": "replace", "field": field, "before": old, "after": clean}],
        )
        return self._build_response(state, "draft_ready", "Раздел обновлён; создана новая ревизия.")

    def import_requirement_document(
        self,
        session_id: str,
        content: str,
        user_id: int | None = None,
    ) -> AgentResponse:
        """Create a reviewable workspace revision from an existing document."""
        state = self.store.get(session_id)
        if state is None or (user_id is not None and state.user_id != user_id):
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.product_mode != PRODUCT_MODE_REQUIREMENT_COPILOT:
            return self._build_response(
                state, "validation_error",
                "Импорт документа доступен только в режиме проработки требования.",
            )
        if state.review_status == "needs_review":
            return self._build_response(
                state, "sent_locked",
                "Отправленная редакция доступна только для чтения.",
            )
        imported = parse_requirement_document(content)
        if not imported.fields:
            return self._build_response(
                state, "validation_error", "В документе не найден текст требования."
            )
        message_id = f"import-{len(state.artifact_revision_history) + 1}"
        source = add_source(state, {"title": imported.title or "Импортированный документ", "content": content})
        source["import_result"] = {
            "recognized_fields": list(imported.fields),
            "unmapped_sections": imported.unmapped_sections,
        }
        for key, value in imported.fields.items():
            old = state.get(key) or ""
            state.record_slot_change(key, old, value, reason="document_import")
            state.set(
                key,
                value,
                confidence=1.0,
                source="attachment_excerpt",
                confirmed=False,
                evidence=value[:1000],
                message_id=message_id,
                provenance=[{
                    "kind": "attachment_excerpt",
                    "evidence": value[:1000],
                    "message_id": message_id,
                    "confidence": 1.0,
                    "confirmed": False,
                    "source_ref": f"{source['id']}@{source['version']}",
                }],
            )
        state.source_context = {
            **(state.source_context or {}),
            "source_type": "document",
            "channel": "document",
            "source_summary": imported.title or "Импортированный документ",
        }
        state.sources.append({
            "kind": "attachment_excerpt",
            "title": imported.title or "Импортированный документ",
            "message_id": message_id,
            "unmapped_sections": imported.unmapped_sections,
        })
        state.final_summary_confirmed = False
        state.summary_text = ""
        state.proposed_patch = None
        artifact = build_business_requirement_v2(state, None)
        if imported.title:
            artifact.title = imported.title
            artifact.fingerprint = canonical_fingerprint(artifact)
        record_revision(
            state,
            artifact,
            author_kind="operator",
            applied_operations=[{
                "op": "import",
                "field": key,
                "after": value,
            } for key, value in imported.fields.items()],
        )
        log_event("v2_requirement_document_imported", {
            "session_id": session_id,
            "field_count": len(imported.fields),
            "unmapped_section_count": len(imported.unmapped_sections),
        })
        return self._build_response(
            state,
            "document_imported",
            "Документ разобран по разделам. Проверьте замечания и отредактируйте формулировки.",
        )

    def document_action(self, session_id: str, user_id: int, request: dict) -> AgentResponse:
        state = self.store.get(session_id)
        if state is None or state.user_id != user_id:
            return AgentResponse(session_id=session_id, action="error", message="Сессия не найдена.")
        if state.product_mode != PRODUCT_MODE_REQUIREMENT_COPILOT:
            return self._build_response(state, "validation_error", "Действие доступно для документа БТ.")
        if state.review_status == "needs_review" and request.get("action") not in {"review", "add_source", "resolve_finding", "next_revision"}:
            return self._build_response(state, "sent_locked", "Старая отправленная редакция доступна для чтения. Создайте новую редакцию.")
        try:
            action, message = execute(state, request)
        except ValueError as exc:
            action, message = "validation_error", str(exc)
        return self._build_response(state, action, message)


_v2_orchestrator: V2Orchestrator | None = None


def get_v2_orchestrator(store=None) -> V2Orchestrator:
    global _v2_orchestrator
    if _v2_orchestrator is None:
        if store is None:
            from ..session import session_store
            store = session_store
        _v2_orchestrator = V2Orchestrator(store)
    return _v2_orchestrator
