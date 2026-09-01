"""Requirement composer - turns collected slots + dialogue into a structured
draft business requirement (JSON) with sources, open questions, scores and
assumption markers.
"""
import uuid
from datetime import datetime, timezone

from ..context import UserContext
from ..dialogue.state import DialogueState, SLOT_LABELS, QUALITY_PROGRESS_SLOTS
from ..dialogue.quality import assess_quality
from ..guardrails.output_harness import validate_draft_schema
from ..kb.sources import requirements_history_source
from ..dialogue.gaps import synchronize_gaps
from .reviewer import has_blocking_findings, review_draft
from .schema import RequirementDraft, DraftSource, to_markdown
from .scores import completeness_score, confidence_level

MIN_COMPLETENESS = 60

_OPEN_QUESTION_SLOTS = [
    "department", "module", "scenarios", "business_rules", "data_integrations",
    "dependencies", "risks", "regulatory_flags",
]


def _list(value) -> list:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [p.strip() for p in str(value).replace("\n", ";").split(";") if p.strip()]


def _make_title(state: DialogueState) -> str:
    to_be = state.get("to_be")
    if to_be:
        title = to_be.split(".")[0].split("\n")[0].strip()
        if title:
            return title[:180]
    need = state.get("need_statement") or ""
    lines = [l for l in need.splitlines() if l.strip()]
    if lines:
        return lines[0][:180]
    return "Доработка платформы"


def check_duplicates(state: DialogueState) -> list[dict]:
    """Find similar requirements in the history for the duplicate check."""
    query = " ".join([state.get("need_statement") or "", state.get("to_be") or ""])
    return requirements_history_source.find_similar(query, limit=3)


def build_draft(state: DialogueState, ctx: UserContext | None) -> RequirementDraft:
    completeness = completeness_score(state)
    confidence = confidence_level(state, completeness)
    quality = assess_quality(state)
    state.quality_assessment = quality.as_dict()
    gaps = synchronize_gaps(state, quality)

    open_questions = []
    # Preserve concrete questions explicitly supplied by the user/model. They
    # are more useful to reviewers than generic messages about missing slots.
    for question in _list(state.get("open_questions")):
        if question not in open_questions:
            open_questions.append(question)
    open_question_slots = list(dict.fromkeys(_OPEN_QUESTION_SLOTS + QUALITY_PROGRESS_SLOTS))
    for key in open_question_slots:
        if state.slots[key].status == "skipped":
            open_questions.append(f"Не уточнено: {SLOT_LABELS.get(key, key)}")
    for key in ("dependencies", "risks", "regulatory_flags"):
        if state.slots[key].status != "filled":
            question = f"Требуется уточнение: {SLOT_LABELS.get(key, key)}"
            if question not in open_questions:
                open_questions.append(question)
    for issue in quality.issues:
        if issue.question and issue.question not in open_questions:
            open_questions.append(issue.question)

    assumptions = []
    if completeness < MIN_COMPLETENESS:
        assumptions.append("[предположение] Драфт неполный: возможны неточности формулировок.")
    if state.slots["product"].status == "skipped":
        assumptions.append("[предположение] Продукт не подтверждён пользователем.")
    for key, slot in state.slots.items():
        if slot.status == "filled" and slot.assumption:
            text = f"[предположение] {SLOT_LABELS.get(key, key)}: {slot.value}"
            if text not in assumptions:
                assumptions.append(text)
    for source in state.sources:
        if source.get("type") == "assumption" and source.get("text"):
            text = f"[предположение] {source['text']}"
            if text not in assumptions:
                assumptions.append(text)

    regulatory_flags = _list(state.get("regulatory_flags"))
    product = state.get("product") or ""
    if "структурн" in product.lower() and not any("комплаенс" in f.lower() for f in regulatory_flags):
        regulatory_flags.append("Обязательное комплаенс-ревью (структурный продукт)")
    if state.slots["department"].status == "skipped":
        regulatory_flags.append("Требуется проверка комплаенс/риск-менеджмента")

    field_slots = {
        "problem_statement": "need_statement", "current_process": "as_is", "target_process": "to_be",
        "business_value": "value", "user_roles": "users", "product": "product",
        "department": "department",
        "module": "module", "scenarios": "scenarios", "business_rules": "business_rules",
        "data_integrations": "data_integrations", "acceptance_criteria": "acceptance_criteria",
        "dependencies": "dependencies", "risks": "risks", "regulatory_flags": "regulatory_flags",
    }
    field_provenance = {}
    field_confidence = {}
    for field, slot_key in field_slots.items():
        slot = state.slots.get(slot_key)
        if slot and slot.status == "filled":
            field_provenance[field] = {
                "source": slot.source or "unknown", "assumption": slot.assumption,
                "confirmed": slot.confirmed,
            }
            field_confidence[field] = round(float(slot.confidence), 2)

    blocking_slots = set(profile_for_slot for profile_for_slot in (
        "need_statement", "to_be", "role", "process", "acceptance_criteria"
    ))
    open_question_details = []
    for question in open_questions:
        matching_slot = next((key for key in QUALITY_PROGRESS_SLOTS
                              if SLOT_LABELS.get(key, key) in question), "")
        open_question_details.append({
            "text": question,
            "blocking": matching_slot in blocking_slots or question.startswith("Уточните:"),
            "slot": matching_slot,
        })

    draft = RequirementDraft(
        id=f"DRAFT-{uuid.uuid4().hex[:8].upper()}",
        title=_make_title(state),
        intent=state.get("intent") or "",
        problem_statement=state.get("need_statement") or "",
        current_process=state.get("as_is") or "",
        target_process=state.get("to_be") or "",
        business_value=state.get("value") or "",
        user_roles=_list(state.get("role")) + _list(state.get("users")),
        department=state.get("department") or "",
        product=product,
        module=state.get("module") or "",
        scenarios=_list(state.get("scenarios")),
        business_rules=_list(state.get("business_rules")),
        data_integrations=_list(state.get("data_integrations")),
        acceptance_criteria=_list(state.get("acceptance_criteria")),
        open_questions=open_questions,
        open_question_details=open_question_details,
        dependencies=_list(state.get("dependencies")),
        risks=_list(state.get("risks")),
        assumptions=assumptions,
        regulatory_flags=regulatory_flags,
        priority=state.get("priority") or "",
        duplicates=state.duplicates,
        sources=[DraftSource(**s) for s in state.sources],
        field_provenance=field_provenance,
        field_confidence=field_confidence,
        completeness_score=completeness,
        confidence=confidence,
        quality_score=quality.score,
        quality_level=quality.level,
        quality_profile=quality.profile,
        quality_issues=[issue.as_dict() for issue in quality.issues],
        conflicts=[issue.as_dict() for issue in quality.conflicts],
        gaps=[gap.__dict__.copy() for gap in gaps],
        status="Draft",
        created_by={
            "user_id": ctx.user_id if ctx else None,
            "name": ctx.name if ctx else "",
            "role": ctx.role_name if ctx else "",
        },
    )
    findings = review_draft(draft)
    draft.review_findings = [finding.as_dict() for finding in findings]
    draft.review_blocked = has_blocking_findings(findings)
    return draft


def validate(draft: RequirementDraft) -> list[str]:
    return validate_draft_schema(draft.model_dump())


def render(draft: RequirementDraft) -> str:
    return to_markdown(draft)


def draft_mtime() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_defect_draft(state: DialogueState, ctx: UserContext | None) -> RequirementDraft:
    """Short defect draft for the incident path (intentionally minimal)."""
    completeness = min(completeness_score(state), 45)
    need = state.get("need_statement") or ""
    quality = assess_quality(state)
    state.quality_assessment = quality.as_dict()
    return RequirementDraft(
        id=f"DRAFT-{uuid.uuid4().hex[:8].upper()}",
        title=(need.split(".")[0].strip()[:180] or "Дефект платформы"),
        intent="incident",
        problem_statement=need,
        current_process="",
        target_process="",
        business_value="",
        user_roles=_list(state.get("role")),
        department=state.get("department") or "",
        product=state.get("product") or "",
        module=state.get("module") or "",
        scenarios=[],
        business_rules=[],
        data_integrations=[],
        acceptance_criteria=[],
        open_questions=["Необходима диагностика инцидента владельцем модуля"],
        dependencies=[],
        risks=["Дефект может блокировать операционную деятельность"],
        assumptions=["[предположение] Требуется верификация инцидента поддержкой платформы."],
        regulatory_flags=[],
        priority="Высокий",
        duplicates=state.duplicates,
        sources=[DraftSource(**s) for s in state.sources],
        completeness_score=completeness,
        confidence="low",
        quality_score=quality.score,
        quality_level=quality.level,
        quality_profile=quality.profile,
        quality_issues=[issue.as_dict() for issue in quality.issues],
        conflicts=[issue.as_dict() for issue in quality.conflicts],
        status="Draft",
        created_by={
            "user_id": ctx.user_id if ctx else None,
            "name": ctx.name if ctx else "",
            "role": ctx.role_name if ctx else "",
        },
    )
