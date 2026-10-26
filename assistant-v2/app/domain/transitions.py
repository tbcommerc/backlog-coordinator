from __future__ import annotations

from dataclasses import dataclass

from .enums import ArtifactStatus, NeedCaseStatus


@dataclass(frozen=True)
class TransitionRule:
    allowed: bool
    requires_readiness: bool = False
    terminal: bool = False


NEED_CASE_TRANSITIONS: dict[tuple[str, str], TransitionRule] = {
    (NeedCaseStatus.DRAFT, NeedCaseStatus.CAPTURED): TransitionRule(True),
    (NeedCaseStatus.CAPTURED, NeedCaseStatus.CLARIFYING): TransitionRule(True),
    (NeedCaseStatus.CLARIFYING, NeedCaseStatus.READY_FOR_ANALYSIS): TransitionRule(True, True),
    (NeedCaseStatus.READY_FOR_ANALYSIS, NeedCaseStatus.HANDED_OFF): TransitionRule(True),
}
for source in (
    NeedCaseStatus.DRAFT,
    NeedCaseStatus.CAPTURED,
    NeedCaseStatus.CLARIFYING,
    NeedCaseStatus.READY_FOR_ANALYSIS,
):
    NEED_CASE_TRANSITIONS[(source, NeedCaseStatus.DEFERRED)] = TransitionRule(True)
for source in (
    NeedCaseStatus.CAPTURED,
    NeedCaseStatus.CLARIFYING,
    NeedCaseStatus.READY_FOR_ANALYSIS,
):
    NEED_CASE_TRANSITIONS[(source, NeedCaseStatus.DUPLICATE)] = TransitionRule(True, terminal=True)
    NEED_CASE_TRANSITIONS[(source, NeedCaseStatus.REJECTED)] = TransitionRule(True, terminal=True)
for source in (
    NeedCaseStatus.HANDED_OFF,
    NeedCaseStatus.DUPLICATE,
    NeedCaseStatus.DEFERRED,
    NeedCaseStatus.REJECTED,
):
    NEED_CASE_TRANSITIONS[(source, NeedCaseStatus.ARCHIVED)] = TransitionRule(True, terminal=True)


ARTIFACT_TRANSITIONS: dict[tuple[str, str], TransitionRule] = {
    (ArtifactStatus.DRAFTING, ArtifactStatus.VALIDATING): TransitionRule(True),
    (ArtifactStatus.VALIDATING, ArtifactStatus.READY_FOR_REVIEW): TransitionRule(True, True),
    (ArtifactStatus.READY_FOR_REVIEW, ArtifactStatus.IN_REVIEW): TransitionRule(True),
    (ArtifactStatus.IN_REVIEW, ArtifactStatus.RETURNED): TransitionRule(True),
    (ArtifactStatus.RETURNED, ArtifactStatus.DRAFTING): TransitionRule(True),
    (ArtifactStatus.IN_REVIEW, ArtifactStatus.APPROVED_BASELINE): TransitionRule(True),
    (ArtifactStatus.APPROVED_BASELINE, ArtifactStatus.SUPERSEDED): TransitionRule(True, terminal=True),
}


def need_case_transition(current: str, target: str) -> TransitionRule:
    return NEED_CASE_TRANSITIONS.get((current, target), TransitionRule(False))


def artifact_transition(current: str, target: str) -> TransitionRule:
    return ARTIFACT_TRANSITIONS.get((current, target), TransitionRule(False))

