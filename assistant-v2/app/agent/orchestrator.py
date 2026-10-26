from __future__ import annotations

from app.agent.guards import guard_proposal
from app.agent.schemas import AgentProposal, ProposalClaim


class AgentOrchestrator:
    """Safe manual-mode orchestrator.

    A real provider is intentionally not wired until provider/privacy decisions
    from the technical specification are approved. The deterministic response is
    still a proposal and never mutates domain state by itself.
    """

    def propose(
        self,
        *,
        message: str,
        mode: str,
        fragment_id: str,
        failed_rules: list[str],
    ) -> AgentProposal:
        compact = " ".join(message.split())
        statement = compact[:2000]
        next_question = None
        if failed_rules:
            next_question = {
                "text": "Какое подтверждённое уточнение закроет самый приоритетный пробел?",
                "focus": failed_rules[0],
            }
        proposal = AgentProposal(
            assistant_message=(
                "Ответ сохранён. Я подготовил предложение по факту из сообщения; "
                "его нужно явно принять, исправить или отклонить."
            ),
            proposed_claims=[
                ProposalClaim(
                    temporary_id="claim-proposal-1",
                    statement=statement,
                    claim_type="source_statement",
                    evidence={"source_fragment_id": fragment_id, "quote": statement},
                    confidence=1.0,
                )
            ],
            next_question=next_question,
            readiness_projection={"ready": not failed_rules, "failed_rules": failed_rules},
            degraded=True,
        )
        guarded = guard_proposal(proposal.model_dump(), {fragment_id})
        return AgentProposal.model_validate(guarded)

