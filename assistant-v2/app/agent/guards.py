from __future__ import annotations

from typing import Any

from app.api.errors import DomainError
from app.domain.enums import ClaimType


def guard_proposal(proposal: dict[str, Any], allowed_fragment_ids: set[str]) -> dict[str, Any]:
    questions = [proposal.get("next_question")] if proposal.get("next_question") else []
    if len(questions) > 1:
        raise DomainError("agent_schema_invalid", "Agent turn содержит более одного основного вопроса.", 502)
    for claim in proposal.get("proposed_claims") or []:
        if claim.get("confirmation_level") not in {None, "unconfirmed"}:
            raise DomainError("agent_confirmation_forbidden", "Модель не может подтверждать claim.", 502)
        if claim.get("claim_type") == ClaimType.HUMAN_DECISION:
            raise DomainError("agent_decision_forbidden", "Модель не может создавать human decision.", 502)
        fragment_id = (claim.get("evidence") or {}).get("source_fragment_id")
        if fragment_id and fragment_id not in allowed_fragment_ids:
            raise DomainError("evidence_not_grounded", "Agent proposal ссылается на недоступный fragment.", 502)
    return proposal

