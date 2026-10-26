from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: str
    path: str
    rationale: str

    def as_dict(self) -> dict[str, str]:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "path": self.path,
            "rationale": self.rationale,
        }


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def evaluate_need_case(
    *,
    source_count: int,
    passport: dict[str, Any],
    accepted_claim_paths: Iterable[str],
    blocking_gaps: Iterable[dict[str, Any]],
    critical_conflicts: Iterable[dict[str, Any]],
    fidelity_confirmed: bool,
) -> list[Finding]:
    findings: list[Finding] = []
    claim_paths = set(accepted_claim_paths)
    if source_count < 1:
        findings.append(Finding("S1_SOURCE_REQUIRED", "blocking", "/sources", "Нужен неизменяемый источник или пересказ оператора."))
    for field, rule, rationale in (
        ("requested_action", "S1_REQUESTED_ACTION", "Подтвердите требуемое действие."),
        ("expected_outcome", "S1_EXPECTED_OUTCOME", "Подтвердите наблюдаемый ожидаемый результат."),
        ("business_problem", "S1_BUSINESS_PROBLEM", "Зафиксируйте бизнес-проблему или ценность."),
        ("scope_in", "S1_SCOPE_IN", "Определите границы включённого объёма."),
        ("scope_out", "S1_SCOPE_OUT", "Определите исключения либо оформите human decision."),
    ):
        if not _present(passport.get(field)) and f"/{field}" not in claim_paths:
            findings.append(Finding(rule, "blocking", f"/passport/{field}", rationale))
        elif f"/{field}" not in claim_paths:
            findings.append(Finding(f"{rule}_CONFIRMATION", "blocking", f"/passport/{field}", "Значение должно быть связано с принятым claim или human decision."))
    for gap in blocking_gaps:
        if gap.get("status") == "open" and not (gap.get("owner_snapshot") and gap.get("next_step")):
            findings.append(Finding("S1_BLOCKING_GAP", "blocking", gap.get("path") or "/gaps", "Blocking gap должен быть закрыт или иметь владельца и следующий шаг."))
    for conflict in critical_conflicts:
        if conflict.get("status") not in {"resolved", "escalated"}:
            findings.append(Finding("S1_CRITICAL_CONFLICT", "blocking", "/conflicts", "Критический конфликт требует решения или эскалации."))
    if not fidelity_confirmed:
        findings.append(Finding("S1_FIDELITY_CONFIRMATION", "blocking", "/decisions/fidelity", "Нужно подтверждение fidelity для текущего digest."))
    return findings


def validate_business_requirement(content: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    required = {
        "title": "BR_TITLE",
        "purpose": "BR_PURPOSE",
        "target_outcome": "BR_TARGET_OUTCOME",
        "scope_in": "BR_SCOPE_IN",
        "scope_out": "BR_SCOPE_OUT",
        "actors": "BR_ACTORS",
        "primary_scenarios": "BR_PRIMARY_SCENARIO",
        "business_rules": "BR_BUSINESS_RULES",
        "assumptions": "BR_ASSUMPTIONS",
        "acceptance_criteria": "BR_ACCEPTANCE",
        "traceability": "BR_TRACEABILITY",
    }
    for field, rule in required.items():
        if not _present(content.get(field)):
            findings.append(Finding(rule, "blocking", f"/{field}", "Обязательная область бизнес-требования не заполнена."))
    criteria = content.get("acceptance_criteria") or []
    for index, criterion in enumerate(criteria if isinstance(criteria, list) else [criteria]):
        if len(str(criterion).strip()) < 12:
            findings.append(Finding("BR_ACCEPTANCE_MEASURABLE", "blocking", f"/acceptance_criteria/{index}", "Критерий должен описывать наблюдаемый результат."))
    unresolved = content.get("unresolved_items") or []
    for index, item in enumerate(unresolved):
        if isinstance(item, dict) and item.get("severity") in {"blocking", "critical"} and item.get("status", "open") == "open":
            findings.append(Finding("BR_BLOCKING_GAP", "blocking", f"/unresolved_items/{index}", "Blocking item должен быть закрыт до review."))
    return findings
