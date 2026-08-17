"""Requirement composer - turns collected slots + dialogue into a structured
draft business requirement (JSON) with sources, open questions, scores and
assumption markers.
"""
import uuid
from datetime import datetime, timezone

from ..context import UserContext
from ..dialogue.state import DialogueState
from ..guardrails.output_harness import validate_draft_schema
from ..kb.requirements_history import history
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
    return history.find_similar(query, limit=3)


def build_draft(state: DialogueState, ctx: UserContext | None) -> RequirementDraft:
    completeness = completeness_score(state)
    confidence = confidence_level(state, completeness)

    open_questions = []
    for key in _OPEN_QUESTION_SLOTS:
        if state.slots[key].status == "skipped":
            open_questions.append(f"Не уточнено: {key}")
    for key in ("dependencies", "risks", "regulatory_flags"):
        if state.slots[key].status != "filled":
            open_questions.append(f"Требуется уточнение: {key}")

    assumptions = []
    if completeness < MIN_COMPLETENESS:
        assumptions.append("[предположение] Драфт неполный: возможны неточности формулировок.")
    if state.slots["product"].status == "skipped":
        assumptions.append("[предположение] Продукт не подтверждён пользователем.")

    regulatory_flags = _list(state.get("regulatory_flags"))
    product = state.get("product") or ""
    if "структурн" in product.lower() and not any("комплаенс" in f.lower() for f in regulatory_flags):
        regulatory_flags.append("Обязательное комплаенс-ревью (структурный продукт)")
    if state.slots["department"].status == "skipped":
        regulatory_flags.append("Требуется проверка комплаенс/риск-менеджмента")

    draft = RequirementDraft(
        id=f"DRAFT-{uuid.uuid4().hex[:8].upper()}",
        title=_make_title(state),
        intent=state.get("intent") or "",
        problem_statement=state.get("need_statement") or "",
        target_process=state.get("to_be") or "",
        business_value=state.get("value") or "",
        user_roles=_list(state.get("role")) + _list(state.get("users")),
        product=product,
        module=state.get("module") or "",
        scenarios=_list(state.get("scenarios")),
        business_rules=_list(state.get("business_rules")),
        data_integrations=_list(state.get("data_integrations")),
        acceptance_criteria=_list(state.get("acceptance_criteria")),
        open_questions=open_questions,
        dependencies=_list(state.get("dependencies")),
        risks=_list(state.get("risks")),
        assumptions=assumptions,
        regulatory_flags=regulatory_flags,
        priority=state.get("priority") or "Средний",
        duplicates=state.duplicates,
        sources=[DraftSource(**s) for s in state.sources],
        completeness_score=completeness,
        confidence=confidence,
        status="Draft",
        created_by={
            "user_id": ctx.user_id if ctx else None,
            "name": ctx.name if ctx else "",
            "role": ctx.role_name if ctx else "",
        },
    )
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
    return RequirementDraft(
        id=f"DRAFT-{uuid.uuid4().hex[:8].upper()}",
        title=(need.split(".")[0].strip()[:180] or "Дефект платформы"),
        intent="incident",
        problem_statement=need,
        target_process="",
        business_value="",
        user_roles=_list(state.get("role")),
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
        status="Draft",
        created_by={
            "user_id": ctx.user_id if ctx else None,
            "name": ctx.name if ctx else "",
            "role": ctx.role_name if ctx else "",
        },
    )
