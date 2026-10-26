"""Requirement composer - turns collected slots + dialogue into a structured
draft business requirement (JSON) with sources, open questions, scores and
assumption markers.
"""
import uuid
from copy import deepcopy
from datetime import datetime, timezone

from ..context import UserContext
from ..dialogue.state import DialogueState, SLOT_LABELS
from ..dialogue.quality import assess_quality, split_criteria
from ..guardrails.output_harness import validate_draft_schema
from ..kb.sources import requirements_history_source
from ..dialogue.gaps import synchronize_gaps
from .reviewer import has_blocking_findings, review_draft
from .schema import RequirementDraft, DraftSource, FIELD_SLOTS, to_markdown
from .scores import completeness_score, confidence_level

MIN_COMPLETENESS = 60

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


def _artifact_value(state: DialogueState, key: str):
    slot = state.slots.get(key)
    if slot and slot.status == "not_applicable":
        return slot.value or "Не применимо"
    return state.get(key)


def build_draft(state: DialogueState, ctx: UserContext | None) -> RequirementDraft:
    completeness = completeness_score(state)
    confidence = confidence_level(state, completeness)
    quality = assess_quality(state)
    state.quality_assessment = quality.as_dict()
    gaps = synchronize_gaps(state, quality)

    active_gaps = [gap for gap in gaps if gap.status != "resolved"]
    open_questions = list(dict.fromkeys(gap.question for gap in active_gaps))

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

    assumption_details = [dict(item) for item in getattr(state, "requirement_assumptions", [])]
    for item in assumption_details:
        if item.get("status", "open") == "resolved" or not item.get("text"):
            continue
        text = f"[предположение] {item['text']}"
        if text not in assumptions:
            assumptions.append(text)

    regulatory_flags = _list(_artifact_value(state, "regulatory_flags"))
    product = _artifact_value(state, "product") or ""
    # An inferred product category or a skipped department does not establish
    # a regulatory obligation. Missing applicability is already a registry gap.

    field_provenance = {}
    field_confidence = {}
    field_status = {}
    for field, slot_key in FIELD_SLOTS.items():
        slot = state.slots.get(slot_key)
        if slot:
            field_status[field] = slot.status
        if slot and slot.status != "empty":
            field_provenance[field] = {
                "source": slot.source or "unknown", "assumption": slot.assumption,
                "confirmed": slot.confirmed,
                "status": slot.status, "raw_value": slot.value,
                "evidence": getattr(slot, "evidence", ""), "message_id": getattr(slot, "message_id", ""),
                "claims": deepcopy(getattr(slot, "provenance", [])),
            }
            field_confidence[field] = round(float(slot.confidence), 2)

    blocking_slots = set(state.get_missing_mandatory_hard())
    open_question_details = []
    for question in open_questions:
        matching = [gap for gap in active_gaps if gap.question == question]
        open_question_details.append({
            "text": question,
            "blocking": any(gap.slot in blocking_slots for gap in matching) or any(
                issue.question == question and issue.severity == "critical" for issue in quality.conflicts
            ),
            "slot": matching[0].slot if matching else "",
            "gap_id": matching[0].id if matching else "",
        })

    draft = RequirementDraft(
        id=f"DRAFT-{uuid.uuid4().hex[:8].upper()}",
        title=_make_title(state),
        intent=state.get("intent") or "",
        problem_statement=state.get("need_statement") or "",
        current_process=_artifact_value(state, "as_is") or "",
        target_process=state.get("to_be") or "",
        business_value=_artifact_value(state, "value") or "",
        user_roles=list(dict.fromkeys(_list(state.get("role")) + _list(state.get("users")))),
        primary_role=state.get("role") or "",
        affected_users=_list(_artifact_value(state, "users")),
        process=state.get("process") or "",
        department=_artifact_value(state, "department") or "",
        product=product,
        module=_artifact_value(state, "module") or "",
        scenarios=_list(_artifact_value(state, "scenarios")),
        business_rules=_list(_artifact_value(state, "business_rules")),
        data_integrations=_list(_artifact_value(state, "data_integrations")),
        acceptance_criteria=split_criteria(_artifact_value(state, "acceptance_criteria")),
        open_questions=open_questions,
        open_question_details=open_question_details,
        dependencies=_list(_artifact_value(state, "dependencies")),
        risks=_list(_artifact_value(state, "risks")),
        assumptions=assumptions,
        assumption_details=assumption_details,
        conflict_history=[dict(item) for item in getattr(state, "requirement_conflicts", [])],
        regulatory_flags=regulatory_flags,
        priority=state.get("priority") or "",
        duplicates=state.duplicates,
        sources=[DraftSource(**s) for s in state.sources if s.get("type") != "assumption"],
        field_provenance=field_provenance,
        field_confidence=field_confidence,
        field_status=field_status,
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
    """A short incident interview must still preserve all already supplied facts."""
    incident = deepcopy(state)
    incident.set("intent", "incident", source="system")
    questions = _list(incident.get("open_questions"))
    questions.append("Необходима диагностика инцидента владельцем модуля")
    incident.set("open_questions", "; ".join(dict.fromkeys(questions)), source="system")
    draft = build_draft(incident, ctx)
    draft.completeness_score = min(draft.completeness_score, 45)
    draft.confidence = "low"
    state.quality_assessment = incident.quality_assessment
    state.gaps = incident.gaps
    return draft
