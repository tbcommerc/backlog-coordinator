"""Independent, read-only review of a composed requirement draft."""
from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field

from .schema import RequirementDraft, FIELD_SLOTS
from ..dialogue.state import value_status
from ..dialogue.quality import content_conflicts, split_criteria, acceptance_is_measurable, business_value_is_effect


@dataclass(frozen=True)
class ReviewFinding:
    code: str
    message: str
    severity: str  # error | warning
    field: str = ""
    details: dict = dataclass_field(default_factory=dict)

    def as_dict(self) -> dict:
        return {**self.details, **{key: value for key, value in self.__dict__.items() if key != "details"}}


def review_draft(draft: RequirementDraft) -> list[ReviewFinding]:
    """Inspect a draft without mutating it or asking an LLM to rewrite it."""
    findings: list[ReviewFinding] = []
    required = {"problem_statement": "Потребность", "target_process": "Целевое поведение",
                "primary_role": "Пользователь", "process": "Процесс"}
    if draft.intent == "incident":
        required = {"problem_statement": "Потребность"}
    for field, label in required.items():
        if value_status(getattr(draft, field)) != "filled":
            findings.append(ReviewFinding(
                f"missing_{field}", f"Уточните поле «{label}».", "error", field,
            ))
    values = {}
    for name, slot in FIELD_SLOTS.items():
        value = getattr(draft, name)
        text = "; ".join(value) if isinstance(value, list) else value
        values[slot] = text if value_status(text) == "filled" else ""
    computed = [issue.as_dict() for issue in content_conflicts(values)]
    derived_codes = {"as_is_equals_to_be", "integration_conflict", "permission_conflict"}
    # Recompute known derived checks; keep durable human/model conflicts with
    # their evidence. A stale cached check must not block a corrected document.
    conflicts = computed + [item for item in draft.conflicts + draft.conflict_history
                            if not item.get("derived") and item.get("code") not in derived_codes]
    seen = set()
    for conflict in conflicts:
        if conflict.get("status", "open") == "resolved":
            continue
        identity = conflict.get("id") or (conflict.get("code"), conflict.get("message"), conflict.get("slot"))
        if identity in seen:
            continue
        seen.add(identity)
        severity = "error" if conflict.get("severity") == "critical" else "warning"
        findings.append(ReviewFinding(
            conflict.get("code", "conflict"),
            conflict.get("message", "Обнаружено противоречие."), severity,
            conflict.get("slot", ""),
            {key: value for key, value in conflict.items() if key not in {"code", "message", "severity", "field"}},
        ))
    criteria = split_criteria(draft.acceptance_criteria)
    if not criteria or draft.field_status.get("acceptance_criteria") in {"unknown", "not_applicable", "skipped"}:
        findings.append(ReviewFinding(
            "acceptance_open", "Критерии приёмки оставлены открытым вопросом.",
            "warning", "acceptance_criteria",
        ))
    else:
        for index, criterion in enumerate(criteria, 1):
            if not acceptance_is_measurable(criterion):
                findings.append(ReviewFinding(
                    "acceptance_not_measurable", f"Критерий {index} требует наблюдаемого результата: «{criterion}».",
                    "warning", "acceptance_criteria", {"criterion_index": index, "criterion": criterion},
                ))
    if values.get("value") and not business_value_is_effect(values["value"]):
        findings.append(ReviewFinding(
            "value_is_driver_not_effect", "Ожидаемый бизнес-эффект требует уточнения.", "warning", "business_value",
        ))
    if not draft.sources:
        findings.append(ReviewFinding(
            "no_external_sources", "Черновик не содержит ссылок на внешние источники.",
            "warning", "sources",
        ))
    return findings


def has_blocking_findings(findings: list[ReviewFinding] | list[dict]) -> bool:
    return any(
        (finding.severity if isinstance(finding, ReviewFinding) else finding.get("severity")) == "error"
        for finding in findings
    )
