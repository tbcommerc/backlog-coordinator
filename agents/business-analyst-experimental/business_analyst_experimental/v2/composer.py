"""V2 artifact composers reusing the copied V1 composer and state model."""
from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from ..composer.composer import build_draft
from ..context import UserContext
from ..dialogue.state import DialogueState
from .fingerprint import canonical_fingerprint
from .models import ArtifactRevision, AssignmentPassport, BusinessRequirementDraftV2
from .readiness import assignment_readiness, requirement_readiness
from .document_workspace import ensure_identity, stable_requirements


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).replace("\n", ";").split(";") if item.strip()]


def _field_provenance(state: DialogueState) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for key, slot in state.slots.items():
        if slot.status == "empty" and slot.value is None:
            continue
        claims = deepcopy(slot.provenance)
        if not claims and (slot.evidence or slot.message_id or slot.source):
            source_kind = "agent_hypothesis" if slot.assumption else "operator_interpretation"
            claims = [{
                "kind": source_kind,
                "evidence": slot.evidence,
                "message_id": slot.message_id,
                "confidence": slot.confidence,
                "confirmed": bool(slot.confirmed and not slot.assumption),
            }]
        result[key] = {
            "value": deepcopy(slot.value),
            "status": slot.status,
            "source": slot.source,
            "evidence": slot.evidence,
            "message_id": slot.message_id,
            "confidence": round(float(slot.confidence), 2),
            "confirmed": slot.confirmed,
            "assumption": slot.assumption,
            "claims": claims,
        }
    return result


def _title(state: DialogueState, fallback: str) -> str:
    for key in ("expected_result", "to_be", "assignment_statement", "need_statement"):
        value = state.get(key)
        if value:
            return str(value).splitlines()[0].split(".")[0][:180]
    return fallback


def build_assignment_passport(
    state: DialogueState,
    context: UserContext | None,
) -> AssignmentPassport:
    previous = state.draft or {}
    revision = len(state.artifact_revision_history) + 1
    source_context = deepcopy(state.source_context)
    if state.get("originator"):
        source_context["originator_label"] = state.get("originator")
    passport = AssignmentPassport(
        id=previous.get("id") or f"ap_{uuid.uuid4().hex}",
        title=previous.get("title") or _title(state, "Поручение на проработку"),
        operator={
            "user_id": state.user_id,
            "role": state.operator_role,
            "name": context.name if context else "",
        },
        source_context=source_context,
        assignment_statement=state.get("assignment_statement") or "",
        business_goal=state.get("business_goal") or "",
        expected_result=state.get("expected_result") or "",
        scope={"in": _list(state.get("scope_in")), "out": _list(state.get("scope_out"))},
        constraints=_list(state.get("constraints")),
        deadline_or_urgency=state.get("deadline_or_urgency") or "",
        stakeholders=_list(state.get("stakeholders")),
        dependencies=_list(state.get("dependencies")),
        initial_risks=_list(state.get("initial_risks")),
        source_materials=_list(state.get("source_materials")),
        open_questions=_list(state.get("open_questions")),
        owner_next_step=state.get("owner_next_step") or "",
        assumptions=deepcopy(state.requirement_assumptions),
        gaps=[gap.__dict__.copy() for gap in state.gaps if gap.status != "resolved"],
        conflicts=deepcopy(state.requirement_conflicts),
        sources=deepcopy(state.sources),
        field_provenance=_field_provenance(state),
        readiness=assignment_readiness(state),
        revision=revision,
        prompt_set_version=state.prompt_set_version,
    )
    passport.fingerprint = canonical_fingerprint(passport)
    return passport


def build_business_requirement_v2(
    state: DialogueState,
    context: UserContext | None,
) -> BusinessRequirementDraftV2:
    # V2 names the confirmed outcome ``business_goal`` while the compatible
    # V1 envelope calls the same fact ``business_value``/``value``. Compose the
    # inherited part from a copy with that alias populated so V1 quality rules
    # do not create a duplicate critical gap. The live dialogue state keeps the
    # canonical V2 slot and its original provenance.
    composition_state = deepcopy(state)
    if not composition_state.get("value") and composition_state.get("business_goal"):
        composition_state.slots["value"] = deepcopy(composition_state.slots["business_goal"])
        composition_state.slots["value"].key = "value"
    base = build_draft(composition_state, context).model_dump()
    state.quality_assessment = deepcopy(composition_state.quality_assessment)
    state.gaps = deepcopy(composition_state.gaps)
    previous = state.draft or {}
    if previous.get("schema") == "business-requirement-draft.v2":
        base["id"] = previous.get("id", base["id"])
        base["created_by"] = previous.get("created_by", base.get("created_by", {}))
    revision = len(state.artifact_revision_history) + 1
    handoff = state.handoff_context or {}
    passport = handoff.get("assignment_passport") or {}
    linked = deepcopy(state.linked_object_snapshot)
    artifact = BusinessRequirementDraftV2(
        **base,
        origin={
            "assignment_passport_id": passport.get("id", ""),
            "source_type": (state.source_context or {}).get("source_type", ""),
        },
        linked_object={
            key: linked.get(key) for key in (
                "object_type", "object_id", "source_system", "object_version", "fingerprint"
            )
        } if linked else None,
        business_goal=state.get("business_goal") or state.get("value") or "",
        scope_in=_list(state.get("scope_in")),
        scope_out=_list(state.get("scope_out")),
        actors=_list(state.get("actors")) or _list(state.get("role")),
        stakeholders=_list(state.get("stakeholders")) or _list(state.get("users")),
        alternative_scenarios=_list(state.get("alternative_scenarios")),
        exception_scenarios=_list(state.get("exception_scenarios")),
        functional_requirements=_list(state.get("functional_requirements")) or _list(state.get("to_be")),
        non_functional_requirements=_list(state.get("non_functional_requirements")),
        success_metrics=_list(state.get("success_metrics")),
        constraints=_list(state.get("constraints")),
        revision=revision,
        prompt_set_version=state.prompt_set_version,
    )
    # V1 composer already provides compatible field-level provenance. Merge in
    # the new V2 slots instead of replacing its contract.
    artifact.field_provenance.update(_field_provenance(state))
    # Retain forward-compatible document fields and identities across manual
    # slot edits; unknown imported data must not disappear on recomposition.
    for key, value in previous.items():
        if key not in BusinessRequirementDraftV2.model_fields:
            setattr(artifact, key, deepcopy(value))
    artifact.artifact_id = ensure_identity(state)
    artifact.business_requirements = stable_requirements(
        previous.get("business_requirements", []), previous.get("business_requirements", []),
    )
    if previous.get("title"):
        artifact.title = previous["title"]
    artifact.document_profile = previous.get("document_profile", "product_process_change")
    artifact.fingerprint = canonical_fingerprint(artifact)
    artifact.quality = requirement_readiness(state, artifact.model_dump(mode="json"))
    artifact.fingerprint = canonical_fingerprint(artifact)
    return artifact


def record_revision(
    state: DialogueState,
    artifact: AssignmentPassport | BusinessRequirementDraftV2,
    *,
    author_kind: str,
    applied_operations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    before = (state.draft or {}).get("fingerprint", "")
    artifact_type = (
        "assignment_passport"
        if isinstance(artifact, AssignmentPassport)
        else "business_requirement_v2"
    )
    revision = ArtifactRevision(
        revision=artifact.revision,
        artifact_type=artifact_type,
        author_kind=author_kind,
        before_fingerprint=before,
        fingerprint=artifact.fingerprint,
        applied_operations=deepcopy(applied_operations or []),
        artifact=artifact.model_dump(mode="json"),
        created_at=datetime.now(timezone.utc),
    ).model_dump(mode="json")
    state.artifact_type = artifact_type
    state.draft = deepcopy(revision["artifact"])
    state.artifact_revision_history.append(revision)
    return revision
