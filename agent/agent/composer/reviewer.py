"""Independent, read-only review of a composed requirement draft."""
from __future__ import annotations

from dataclasses import dataclass

from .schema import RequirementDraft


@dataclass(frozen=True)
class ReviewFinding:
    code: str
    message: str
    severity: str  # error | warning
    field: str = ""

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def review_draft(draft: RequirementDraft) -> list[ReviewFinding]:
    """Inspect a draft without mutating it or asking an LLM to rewrite it."""
    findings: list[ReviewFinding] = []
    for field in ("title", "problem_statement", "target_process"):
        if not getattr(draft, field):
            findings.append(ReviewFinding(
                f"missing_{field}", f"Не заполнено поле: {field}.", "warning", field,
            ))
    for conflict in draft.conflicts:
        severity = "error" if conflict.get("severity") == "critical" else "warning"
        findings.append(ReviewFinding(
            conflict.get("code", "conflict"),
            conflict.get("message", "Обнаружено противоречие."), severity,
            conflict.get("slot", ""),
        ))
    if not draft.acceptance_criteria:
        findings.append(ReviewFinding(
            "acceptance_open", "Критерии приёмки оставлены открытым вопросом.",
            "warning", "acceptance_criteria",
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
