from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProposalClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temporary_id: str
    statement: str
    path: str | None = None
    claim_type: str
    evidence: dict[str, Any]
    confidence: float = Field(ge=0, le=1)
    confirmation_level: str = "unconfirmed"


class AgentProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assistant_message: str
    proposed_claims: list[ProposalClaim] = Field(default_factory=list)
    proposed_patch: list[dict[str, Any]] = Field(default_factory=list)
    gaps: list[dict[str, Any]] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    next_question: dict[str, Any] | None = None
    readiness_projection: dict[str, Any]
    degraded: bool = False

