from __future__ import annotations

from enum import StrEnum


class NeedCaseStatus(StrEnum):
    DRAFT = "draft"
    CAPTURED = "captured"
    CLARIFYING = "clarifying"
    READY_FOR_ANALYSIS = "ready_for_analysis"
    HANDED_OFF = "handed_off"
    DUPLICATE = "duplicate"
    DEFERRED = "deferred"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class ArtifactStatus(StrEnum):
    DRAFTING = "drafting"
    VALIDATING = "validating"
    READY_FOR_REVIEW = "ready_for_review"
    IN_REVIEW = "in_review"
    RETURNED = "returned"
    APPROVED_BASELINE = "approved_baseline"
    SUPERSEDED = "superseded"


class ClaimType(StrEnum):
    SOURCE_STATEMENT = "source_statement"
    SOURCE_INTENT = "source_intent"
    OPERATOR_INTERPRETATION = "operator_interpretation"
    AGENT_HYPOTHESIS = "agent_hypothesis"
    HUMAN_DECISION = "human_decision"


class DiffStatus(StrEnum):
    PROPOSED = "proposed"
    PARTIALLY_ACCEPTED = "partially_accepted"
    ACCEPTED = "accepted"
    APPLIED = "applied"
    REJECTED = "rejected"
    STALE = "stale"
    CANCELLED = "cancelled"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    BLOCKING = "blocking"
    CRITICAL = "critical"

