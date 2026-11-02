"""Content regressions from the 2026-09-08 audit, no model or persistent data."""
import pytest

from business_analyst_experimental.composer.composer import build_draft, build_defect_draft
from business_analyst_experimental.composer.reviewer import has_blocking_findings, review_draft
from business_analyst_experimental.composer.schema import to_markdown
from business_analyst_experimental.composer.scores import completeness_score, confidence_level
from business_analyst_experimental.dialogue.gaps import synchronize_gaps
from business_analyst_experimental.dialogue.quality import acceptance_is_measurable, assess_quality, split_criteria
from business_analyst_experimental.dialogue.state import DialogueState


def full_state(**overrides):
    values = {
        "intent": "change", "need_statement": "Нужна автоматическая сверка расчётов",
        "role": "Оператор", "process": "Сверка расчётов", "product": "Облигации",
        "module": "Расчёты", "as_is": "Оператор вручную сверяет расчёты",
        "to_be": "Система автоматически сверяет расчёты",
        "acceptance_criteria": "Отчёт формируется за 60 секунд",
        "data_integrations": "Получать данные из системы расчётов",
        "dependencies": "Утверждён формат отчёта", "value": "Снижение ручного труда",
        "risks": "Просрочка сверки", "regulatory_flags": "Не применимо",
    }
    values.update(overrides)
    state = DialogueState()
    for key, value in values.items():
        state.set(key, value, confirmed=True)
    return state


@pytest.mark.parametrize("text", [
    "1. Всё должно работать удобно и быстро", "Если возможно, сделать всё хорошо",
    "Отчёт формируется за 60 секунд; Всё остальное работает удобно",
    "1. Отчёт формируется за 60 секунд 2. Всё остальное работает удобно",
    "2. Система должна быть качественной", "Если возможно, всё доступно",
])
def test_numbering_and_good_neighbours_do_not_validate_bad_criteria(text):
    assert not acceptance_is_measurable(text)
    quality = assess_quality(full_state(acceptance_criteria=text))
    assert quality.level != "high"
    assert any(issue.code == "acceptance_not_measurable" for issue in quality.issues)


@pytest.mark.parametrize("text", [
    "При пустой выборке пользователь видит сообщение «Данные отсутствуют»",
    "Отчёт формируется не позднее 60 секунд",
    "Оповещение приходит в течение минуты",
    "Время формирования отчёта не более 60 секунд",
    "Дано: выборка пуста\nКогда пользователь запрашивает отчёт\nТогда отображается сообщение «Данные отсутствуют»",
])
def test_observable_results_do_not_require_a_numeric_target(text):
    assert acceptance_is_measurable(text)


def test_each_criterion_has_its_own_finding_and_round_trip_keeps_boundaries():
    state = full_state(acceptance_criteria="1. Отчёт формируется за 60 секунд\n2. Всё быстро\n3. Всё удобно")
    draft = build_draft(state, None)
    issues = [item for item in draft.quality_issues if item["code"] == "acceptance_not_measurable"]
    assert [issue["criterion_index"] for issue in issues] == [2, 3]
    assert split_criteria(["Когда операция завершена, отчёт сохраняется", "Когда запись пуста, всё удобно"]) == [
        "Когда операция завершена, отчёт сохраняется", "Когда запись пуста, всё удобно",
    ]
    assert [finding.details["criterion_index"] for finding in review_draft(draft)
            if finding.code == "acceptance_not_measurable"] == [2, 3]


def test_missing_critical_content_and_vague_value_never_receive_high_quality():
    for values in ({"acceptance_criteria": "Не знаю"}, {"value": "Для красоты"}):
        draft = build_draft(full_state(**values), None)
        assert draft.quality_level != "high"
        assert draft.quality_score < 80
        assert not draft.review_blocked  # An honest incomplete draft may reach BA.


@pytest.mark.parametrize("need,target,integrations", [
    ("Нужен локальный отчёт без интеграций", "Формировать отчёт локально без интеграций", "Нет интеграций"),
    ("Нужен локальный отчёт", "Интеграции не нужны", "Интеграции не требуются"),
    ("Нужен отчёт", "Получать данные из существующей системы", "Без новых интеграций"),
])
def test_compatible_integration_negations_do_not_block(need, target, integrations):
    draft = build_draft(full_state(need_statement=need, to_be=target, data_integrations=integrations), None)
    assert not draft.review_blocked
    assert not any(item["code"] == "integration_conflict" for item in draft.conflicts)


@pytest.mark.parametrize("target,integrations", [
    ("Получать данные из внешней системы", "Нет интеграций"),
    ("Нужна новая интеграция с внешней системой", "Без новых интеграций"),
])
def test_concrete_integration_contradictions_remain_blocking(target, integrations):
    draft = build_draft(full_state(to_be=target, data_integrations=integrations), None)
    assert draft.review_blocked
    conflict = next(item for item in draft.conflicts if item["code"] == "integration_conflict")
    assert len(conflict["statements"]) == 2


def test_reviewer_recomputes_permission_conflict_from_final_document():
    draft = build_draft(full_state(business_rules="Оператору запрещено формировать отчёт",
                                  acceptance_criteria="Оператору доступно формирование отчёта"), None)
    assert draft.review_blocked and draft.quality_level != "high"
    draft.conflicts = []
    draft.review_findings = []
    before = draft.model_dump()
    findings = review_draft(draft)
    assert has_blocking_findings(findings)
    assert any(finding.code == "permission_conflict" and len(finding.details["statements"]) == 2 for finding in findings)
    assert draft.model_dump() == before


@pytest.mark.parametrize("rule,criterion", [
    ("Оператору запрещено формировать отчёт", "Руководителю доступно формирование отчёта"),
    ("Оператору запрещено формировать отчёт при ошибке", "Оператору доступно формирование отчёта при успехе"),
    ("Оператору запрещено удалять отчёт", "Оператору доступно формирование отчёта"),
])
def test_distinct_roles_actions_and_conditions_do_not_create_permission_conflicts(rule, criterion):
    draft = build_draft(full_state(business_rules=rule, acceptance_criteria=criterion), None)
    assert not any(item["code"] == "permission_conflict" for item in draft.conflicts)


def test_reviewer_replaces_stale_derived_conflicts_after_content_correction():
    draft = build_draft(full_state(as_is="Одинаковый процесс", to_be="Одинаковый процесс"), None)
    assert draft.review_blocked
    draft.target_process = "Система автоматически сверяет расчёты"
    assert not has_blocking_findings(review_draft(draft))
    draft.conflicts = []
    draft.target_process = draft.current_process
    assert has_blocking_findings(review_draft(draft))


def test_applicability_unknown_and_evidence_survive_in_the_document():
    state = full_state(data_integrations="Не применимо", dependencies="Не применимо", risks="Не знаю")
    state.slots["data_integrations"].evidence = "Обмен для этой доработки не применим"
    state.slots["data_integrations"].message_id = "user-7"
    state.slots["data_integrations"].provenance = [{"value": "Не применимо", "evidence": "Интеграции явно исключаем", "message_id": "user-6"}]
    state.set("open_questions", "Нужно ли хранить историю?")
    draft = build_draft(state, None)
    assert draft.data_integrations == ["Не применимо"]
    assert draft.dependencies == ["Не применимо"]
    assert draft.risks == []
    assert draft.field_status["data_integrations"] == "not_applicable"
    assert draft.field_status["risks"] == "unknown"
    provenance = draft.field_provenance["data_integrations"]
    assert provenance["evidence"] == state.slots["data_integrations"].evidence
    assert provenance["message_id"] == "user-7"
    assert provenance["claims"][0]["message_id"] == "user-6"
    assert any(gap["slot"] == "data_integrations" and gap["status"] == "resolved" for gap in draft.gaps)
    assert any(gap["slot"] == "risks" and gap["status"] == "open" for gap in draft.gaps)
    assert set(draft.open_questions) == {gap["question"] for gap in draft.gaps if gap["status"] != "resolved"}
    assert "Нужно ли хранить историю?" in draft.open_questions
    markdown = to_markdown(draft)
    assert "Обмен для этой доработки не применим" in markdown
    assert "Интеграции явно исключаем" in markdown
    assert "явно не применимо" in markdown


def test_durable_assumptions_and_conflicts_are_carried_with_resolution_history():
    state = full_state()
    state.requirement_assumptions = [{"id": "a-1", "text": "Возможно, нужно согласование", "status": "open", "evidence": "", "field": ""}]
    state.requirement_conflicts = [{"id": "c-1", "code": "fact_conflict", "message": "Два срока: 1 час или 1 день",
                                    "question": "Какой срок верен?", "slot": "acceptance_criteria", "severity": "critical",
                                    "status": "open", "old_value": "1 час", "new_value": "1 день", "message_id": "user-8"}]
    draft = build_draft(state, None)
    assert any("Возможно, нужно согласование" in item for item in draft.assumptions)
    assert draft.assumption_details == state.requirement_assumptions
    assert draft.conflict_history == state.requirement_conflicts
    assert draft.review_blocked
    assert next(item for item in draft.conflicts if item.get("id") == "c-1")["message_id"] == "user-8"
    state.requirement_conflicts[0].update(status="resolved", resolution="Подтверждён срок 1 час")
    state.requirement_assumptions[0].update(status="resolved", resolution="Согласование не требуется")
    rebuilt = build_draft(state, None)
    assert not rebuilt.review_blocked
    assert not any(item.get("id") == "c-1" for item in rebuilt.conflicts)
    assert rebuilt.conflict_history[0]["resolution"]
    assert not any("Возможно, нужно согласование" in item for item in rebuilt.assumptions)


def test_derived_gap_reopens_if_its_problem_is_still_present():
    state = full_state(acceptance_criteria="Всё удобно")
    gaps = synchronize_gaps(state, assess_quality(state))
    gap = next(item for item in gaps if item.source == "quality:acceptance_not_measurable")
    gap.status = "resolved"
    gap.resolution = "Помечено решённым без изменения критерия"
    refreshed = synchronize_gaps(state, assess_quality(state))
    assert next(item for item in refreshed if item.id == gap.id).status == "open"


def test_workflow_confirmation_does_not_upgrade_unconfirmed_fields():
    state = full_state()
    for slot in state.slots.values():
        slot.confirmed = False
    before = completeness_score(state)
    state.confirmed = True
    assert completeness_score(state) == before
    assert confidence_level(state, before) != "high"
    assert not build_draft(state, None).field_provenance["target_process"]["confirmed"]


def test_incident_shortcut_preserves_supplied_constraints_without_inventing_priority():
    state = full_state(intent="incident", dependencies="Запуск после поставки АБС",
                       risks="Не проводить расчёт при недоступности лимитов")
    draft = build_defect_draft(state, None)
    assert draft.dependencies == ["Запуск после поставки АБС"]
    assert draft.risks == ["Не проводить расчёт при недоступности лимитов"]
    assert draft.data_integrations
    assert draft.priority == ""
    state.set("priority", "Высокий", confirmed=True)
    assert build_defect_draft(state, None).priority == "Высокий"
    assert "Запуск после поставки АБС" in to_markdown(draft)


def test_product_or_skipped_department_does_not_invent_a_regulatory_obligation():
    state = full_state(product="Структурный продукт", regulatory_flags="Не применимо")
    state.skip("department")
    draft = build_draft(state, None)
    assert draft.regulatory_flags == ["Не применимо"]
    assert not any("Обязательное комплаенс" in text for text in draft.regulatory_flags)


def test_kb_reference_candidate_is_not_rendered_as_confirmation():
    state = full_state()
    state.sources = [{"source": "Справка о расчётах", "uri": "kb://settlement", "usage": "reference_candidate"}]
    draft = build_draft(state, None)
    assert draft.sources[0].usage == "reference_candidate"
    assert "не подтверждение требования" in to_markdown(draft)
