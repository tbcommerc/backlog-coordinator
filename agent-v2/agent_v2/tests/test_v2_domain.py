from datetime import datetime, timezone

import pytest

from agent_v2.context import UserContext
from agent_v2.dialogue.state import (
    PRODUCT_MODE_ASSIGNMENT_CAPTURE,
    PRODUCT_MODE_REQUIREMENT_COPILOT,
    DialogueState,
    Gap,
)
from agent_v2.session import SessionStore
from agent_v2.v2.composer import build_assignment_passport, build_business_requirement_v2, record_revision
from agent_v2.v2.document_import import parse_requirement_document
from agent_v2.v2.models import LinkedObjectSnapshot, SourceContext
from agent_v2.v2.orchestrator import V2Orchestrator
from agent_v2.v2.patches import PROTECTED_PATHS, build_proposed_patch, decide_operation
from agent_v2.v2.prompts import load_prompt_set
from agent_v2.v2.readiness import assignment_readiness, requirement_readiness


def _fill(state, key, value=None):
    text = value or f"Подтверждённое значение {key}"
    state.set(
        key,
        text,
        confidence=1.0,
        source="human_decision",
        confirmed=True,
        evidence=text,
        message_id=f"msg-{key}",
        provenance=[{
            "kind": "human_decision",
            "decision_type": "confirmation",
            "evidence": text,
            "confidence": 1.0,
            "confirmed": True,
            "message_id": f"msg-{key}",
        }],
    )


def _assignment_state():
    state = DialogueState(user_id=7, product_mode=PRODUCT_MODE_ASSIGNMENT_CAPTURE)
    state.operator_role = "BA"
    state.artifact_type = "assignment_passport"
    state.source_context = {"source_type": "management", "channel": "meeting"}
    for key in (
        "assignment_statement", "business_goal", "expected_result", "scope_in",
        "originator", "deadline_or_urgency", "owner_next_step",
    ):
        _fill(state, key)
    return state


def _requirement_state():
    state = DialogueState(user_id=7, product_mode=PRODUCT_MODE_REQUIREMENT_COPILOT)
    state.operator_role = "PO"
    state.artifact_type = "business_requirement_v2"
    for key in (
        "need_statement", "business_goal", "as_is", "to_be", "scope_in", "scope_out",
        "role", "process", "scenarios", "acceptance_criteria", "business_rules",
        "dependencies", "risks",
    ):
        _fill(state, key)
    return state


def test_assignment_readiness_is_deterministic_and_requires_confirmation():
    state = _assignment_state()
    assert assignment_readiness(state).blocking_codes == ["final_summary_not_confirmed"]
    state.final_summary_confirmed = True
    assert assignment_readiness(state).ready is True


def test_requirement_readiness_rejects_unproven_fact():
    state = _requirement_state()
    state.final_summary_confirmed = True
    state.slots["business_goal"].evidence = ""
    state.slots["business_goal"].provenance = []
    result = requirement_readiness(state)
    assert result.ready is False
    assert "business_goal_provenance_invalid" in result.blocking_codes


def test_readiness_blocks_open_critical_gap_and_uncheckable_acceptance():
    state = _requirement_state()
    state.final_summary_confirmed = True
    state.set("acceptance_criteria", "ok", evidence="ok", confirmed=True)
    state.gaps.append(Gap(
        id="gap-1",
        category="business",
        criticality="high",
        question="Какой результат считается успешным?",
    ))
    result = requirement_readiness(state)
    assert "acceptance_criteria_not_checkable" in result.blocking_codes
    assert "critical_gap_or_conflict_open" in result.blocking_codes


def test_readiness_rejects_empty_criteria_and_tampered_fingerprint():
    state = _requirement_state()
    state.final_summary_confirmed = True
    state.set("acceptance_criteria", [], evidence="[]", confirmed=True)
    assert "acceptance_criteria_not_checkable" in requirement_readiness(state).blocking_codes

    _fill(state, "acceptance_criteria")
    artifact = build_business_requirement_v2(state, None).model_dump(mode="json")
    artifact["business_goal"] = "Подменённая цель"
    assert "fingerprint_invalid" in requirement_readiness(state, artifact).blocking_codes


def test_handoff_preserves_passport_and_provenance(tmp_path):
    store = SessionStore(str(tmp_path / "handoff.db"))
    orchestrator = V2Orchestrator(store)
    state = _assignment_state()
    state.session_id = "handoff-session"
    state.final_summary_confirmed = True
    state.prompt_set_version = "test-prompts"
    passport = build_assignment_passport(state, UserContext(user_id=7, operator_role="BA"))
    record_revision(state, passport, author_kind="operator")
    store.save(state)

    response = orchestrator.handoff(state.session_id, state.user_id)
    restored = store.get(state.session_id)
    assert response.action == "handoff"
    assert restored.product_mode == PRODUCT_MODE_REQUIREMENT_COPILOT
    assert restored.handoff_context["assignment_passport"]["fingerprint"] == passport.fingerprint
    assert restored.slots["need_statement"].provenance == state.slots["assignment_statement"].provenance


def test_v2_requires_summary_confirmation_before_artifact(tmp_path):
    store = SessionStore(str(tmp_path / "confirmation.db"))
    orchestrator = V2Orchestrator(store)
    state = _assignment_state()
    state.session_id = "confirmation-session"
    store.save(state)
    context = UserContext(user_id=7, operator_role="BA")

    summary = orchestrator.handle_message(state.session_id, "сформировать черновик", context)
    assert summary.action == "summarize"
    assert summary.draft is None
    assert summary.readiness["ready"] is False

    artifact = orchestrator.handle_message(state.session_id, "подтверждаю", context)
    assert artifact.action == "draft_ready"
    assert artifact.assignment_passport["schema"] == "assignment-passport.v1"
    assert artifact.assignment_passport["source_context"]["originator_label"]
    assert artifact.readiness["ready"] is True


def test_restart_preserves_v2_envelope(tmp_path):
    store = SessionStore(str(tmp_path / "restart.db"))
    orchestrator = V2Orchestrator(store)
    state = _assignment_state()
    state.session_id = "restart-session"
    state.linked_object_snapshot = {"object_type": "task", "object_id": "1"}
    state.prompt_set_version = "prompt-hash"
    store.save(state)
    orchestrator.handle_message(
        state.session_id,
        "начать заново",
        UserContext(user_id=7, operator_role="BA"),
    )
    restarted = store.get(state.session_id)
    assert restarted.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE
    assert restarted.operator_role == "BA"
    assert restarted.artifact_type == "assignment_passport"
    assert restarted.linked_object_snapshot["object_id"] == "1"


def test_session_roundtrip_keeps_v2_envelope(tmp_path):
    store = SessionStore(str(tmp_path / "roundtrip.db"))
    state = store.new_session(11)
    state.product_mode = PRODUCT_MODE_ASSIGNMENT_CAPTURE
    state.operator_role = "BA"
    state.source_context = {"source_type": "operator", "channel": "oral"}
    state.handoff_context = {"assignment_passport": {"id": "ap-1"}}
    state.prompt_set_version = "prompt-hash"
    store.save(state)
    restored = store.get(state.session_id)
    assert restored.product_mode == state.product_mode
    assert restored.source_context == state.source_context
    assert restored.handoff_context == state.handoff_context
    assert restored.prompt_set_version == "prompt-hash"


def test_manual_edit_creates_confirmed_revision_with_human_provenance(tmp_path):
    store = SessionStore(str(tmp_path / "edit.db"))
    orchestrator = V2Orchestrator(store)
    state = _requirement_state()
    state.session_id = "edit-session"
    state.final_summary_confirmed = True
    record_revision(state, build_business_requirement_v2(state, None), author_kind="operator")
    state.proposed_patch = {"id": "obsolete-preview"}
    store.save(state)

    response = orchestrator.edit_draft_section(
        state.session_id,
        "business_goal",
        "Сократить ручную сверку до десяти минут",
        state.user_id,
    )
    assert response.action == "draft_ready"
    assert response.readiness["ready"] is True
    assert len(response.artifact_revision_history) == 2
    restored = store.get(state.session_id)
    assert restored.slots["business_goal"].provenance[0]["kind"] == "human_decision"
    assert restored.proposed_patch is None


def test_proposed_patch_is_preview_only_and_protected_paths_are_ignored():
    state = _requirement_state()
    state.final_summary_confirmed = True
    artifact = build_business_requirement_v2(state, UserContext(user_id=7, operator_role="PO"))
    snapshot = LinkedObjectSnapshot(
        object_type="task",
        object_id="42",
        object_version="3",
        fingerprint="sha256:" + "a" * 64,
        title="Старое название",
        summary="Старое описание",
        allowed_fields=["title", "description", "team_id", "owner_id"],
        fields={"title": "Старое название", "description": "Старое описание", "team_id": 10},
        captured_at=datetime.now(timezone.utc),
    )
    patch = build_proposed_patch("session-1", snapshot, artifact)
    assert patch.status == "awaiting_human_decision"
    assert all(operation.path not in PROTECTED_PATHS for operation in patch.operations)
    assert {operation.path for operation in patch.operations} <= {"/title", "/description"}
    assert not hasattr(patch, "apply")

    if patch.operations:
        decided = decide_operation(patch, 0, "accepted")
        assert decided.operations[0].status == "accepted"


def test_stale_patch_cannot_be_decided():
    state = _requirement_state()
    artifact = build_business_requirement_v2(state, None)
    snapshot = LinkedObjectSnapshot(
        object_type="request",
        object_id="8",
        object_version="1",
        fingerprint="sha256:" + "b" * 64,
        allowed_fields=["title"],
        fields={"title": "До"},
        captured_at=datetime.now(timezone.utc),
    )
    patch = build_proposed_patch(
        "session-2", snapshot, artifact,
        current_snapshot_fingerprint="sha256:" + "c" * 64,
    )
    assert patch.status == "stale"
    with pytest.raises(ValueError, match="stale_patch"):
        decide_operation(patch, 0, "accepted")


def test_new_session_rejects_unknown_product_mode(tmp_path):
    orchestrator = V2Orchestrator(SessionStore(str(tmp_path / "mode.db")))
    context = UserContext(user_id=7, operator_role="BA")
    with pytest.raises(ValueError):
        orchestrator.new_session(
            7,
            context,
            "unsupported",
            SourceContext(source_type="operator", channel="oral"),
        )


def test_requirement_prompt_uses_copilot_contract_instead_of_interview_script():
    prompt, version = load_prompt_set(PRODUCT_MODE_REQUIREMENT_COPILOT, "BA")
    assert version
    assert "co-pilot бизнес-аналитика" in prompt
    assert "Не превращай проверку готового документа в повторное" in prompt
    assert '"next_action":"ask|reflect|summarize|draft|answer"' in prompt
    assert "задай не более одного" in prompt
    assert "После одного наиболее ценного вопроса жди ответа" not in prompt


def test_requirement_document_import_maps_sections_without_inventing_facts(tmp_path):
    parsed = parse_requirement_document(
        """# Сократить обработку заявок

## Проблема
Оператор вручную переносит данные.

## Бизнес-цель
Сократить время обработки до 10 минут.

## Критерии приёмки
- 95% заявок обработано не дольше 10 минут

## Заметки автора
Неутверждённая идея интерфейса.
"""
    )
    assert parsed.title == "Сократить обработку заявок"
    assert parsed.fields["need_statement"] == "Оператор вручную переносит данные."
    assert parsed.fields["business_goal"] == "Сократить время обработки до 10 минут."
    assert "95% заявок" in parsed.fields["acceptance_criteria"]
    assert parsed.unmapped_sections == ["Заметки автора"]
    assert all("интерфейса" not in value for value in parsed.fields.values())

    plain = parse_requirement_document(
        "Проблема:\nРучной перенос данных\n\nБизнес-цель:\nИсключить повторный ввод"
    )
    assert plain.fields == {
        "need_statement": "Ручной перенос данных",
        "business_goal": "Исключить повторный ввод",
    }

    no_title = parse_requirement_document(
        "## Бизнес-цель\nСократить срок обработки до одного дня"
    )
    assert no_title.title == ""
    assert no_title.fields == {
        "business_goal": "Сократить срок обработки до одного дня"
    }

    store = SessionStore(str(tmp_path / "document-import.db"))
    orchestrator = V2Orchestrator(store)
    state = store.new_session(7)
    state.product_mode = PRODUCT_MODE_REQUIREMENT_COPILOT
    state.operator_role = "BA"
    state.artifact_type = "business_requirement_v2"
    state.prompt_set_version = "test-prompts"
    store.save(state)

    response = orchestrator.import_requirement_document(
        state.session_id,
        "## Проблема\nРучная сверка занимает два часа.\n\n## Бизнес-цель\nСократить сверку до десяти минут.",
        state.user_id,
    )
    assert response.action == "document_imported"
    assert response.draft["problem_statement"] == "Ручная сверка занимает два часа."
    assert response.draft["business_goal"] == "Сократить сверку до десяти минут."
    assert response.readiness["ready"] is False
    assert "acceptance_criteria_missing" in response.readiness["blocking_codes"]
    assert response.artifact_revision_history[0]["applied_operations"][0]["op"] == "import"


@pytest.mark.parametrize("heading,field", [
    ("Проблема", "need_statement"), ("Бизнес-цель", "business_goal"),
    ("Текущий процесс", "as_is"), ("Целевой процесс", "to_be"),
    ("В объёме", "scope_in"), ("За границами", "scope_out"),
    ("Участники", "actors"), ("Основная роль", "role"), ("Процесс", "process"),
    ("Основной сценарий", "scenarios"), ("Альтернативные сценарии", "alternative_scenarios"),
    ("Исключения", "exception_scenarios"), ("Бизнес-правила", "business_rules"),
    ("Данные и интеграции", "data_integrations"), ("Функциональные требования", "functional_requirements"),
    ("Нефункциональные требования", "non_functional_requirements"),
    ("Критерии приёмки", "acceptance_criteria"), ("Метрики успеха", "success_metrics"),
    ("Ограничения", "constraints"), ("Зависимости", "dependencies"), ("Риски", "risks"),
])
def test_import_accepts_every_editor_heading(heading, field):
    parsed = parse_requirement_document(f"# Название\n\n## {heading}\nПодтверждённый текст.")
    assert parsed.fields == {field: "Подтверждённый текст."}
    assert parsed.unmapped_sections == []


def test_import_title_manual_title_and_import_result_survive_reload(tmp_path):
    store = SessionStore(str(tmp_path / "ux-import.db"))
    orchestrator = V2Orchestrator(store)
    response = orchestrator.new_session(7, UserContext(user_id=7, operator_role="BA"), PRODUCT_MODE_REQUIREMENT_COPILOT)
    sid = response.session_id
    imported = orchestrator.import_requirement_document(sid,
        "# Название из H1\n\n## Проблема\nНет подтверждения.\n\n## За границами\nЗаявки из отделений.\n\n## Заметки автора\nУточнить канал.", 7)
    assert imported.draft["title"] == "Название из H1"
    assert imported.draft["scope_out"] == ["Заявки из отделений."]
    stored = store.get(sid)
    assert stored.document_sources[0]["import_result"]["unmapped_sections"] == ["Заметки автора"]
    assert stored.draft["title"] == "Название из H1"
    edited = orchestrator.edit_draft_section(sid, "title", "Новое название", 7)
    assert edited.draft["title"] == "Новое название"
    assert edited.draft["fingerprint"] != imported.draft["fingerprint"]
    next_edit = orchestrator.edit_draft_section(sid, "business_goal", "Снизить ожидание", 7)
    assert next_edit.draft["title"] == "Новое название"
    assert next_edit.draft["scope_out"] == ["Заявки из отделений."]
    assert store.get(sid).draft["title"] == "Новое название"
    assert store.list_for_user(7)[0]["title"] == "Новое название"


def test_assignment_welcome_acknowledges_existing_summary(tmp_path):
    store = SessionStore(str(tmp_path / "ux-assignment.db"))
    orchestrator = V2Orchestrator(store)
    response = orchestrator.new_session(7, UserContext(user_id=7, operator_role="BA"), PRODUCT_MODE_ASSIGNMENT_CAPTURE,
        SourceContext(source_type="operator", channel="oral", source_summary="Подготовить отчёт к пятнице по просьбе заказчика."))
    assert "Суть поручения сохранена" in response.message
    assert "Сначала опишите суть" not in response.message
    assert store.get(response.session_id).get("assignment_statement") == "Подготовить отчёт к пятнице по просьбе заказчика."
