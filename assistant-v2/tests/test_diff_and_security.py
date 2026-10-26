from datetime import datetime, timezone

import pytest
from jose import jwt

from app.api.errors import DomainError
from app.config import get_settings
from app.domain.digest import digest_json
from app.models import (
    Artifact, ArtifactRevision, CaseParticipant, Claim, ClaimEvidence, NeedCase,
    SourceArtifact, SourceFragment, new_id, utcnow,
)
from app.security import decode_actor_envelope, reset_replay_cache


def _seed_artifact(db, actor):
    case = NeedCase(
        id=new_id(), case_number="NC-2026-DIFF", title="Diff", status="captured", version=0,
        passport_json={}, potentially_stale=False, created_by=actor.user_id, created_at=utcnow(), updated_at=utcnow(),
    )
    artifact = Artifact(
        id=new_id(), case_id=case.id, artifact_type="business_requirement", status="approved_baseline", version=0,
        potentially_stale=False, created_by=actor.user_id, created_at=utcnow(), updated_at=utcnow(),
    )
    revision = ArtifactRevision(
        id=new_id(), artifact_id=artifact.id, revision_no=1, schema_version="business-requirement/1.0",
        content_json={"title": "Requirement"}, digest=digest_json({"title": "Requirement"}),
        digest_algorithm="sha256:jcs-v1", created_by=actor.user_id, created_at=utcnow(),
    )
    source = SourceArtifact(
        id=new_id(), case_id=case.id, kind="text", origin_type="verbatim", channel="test",
        mime_type="text/plain", content="Grounded source", digest="sha256:source",
        digest_algorithm="sha256:jcs-v1", captured_at=utcnow(), created_by=actor.user_id, created_at=utcnow(),
    )
    fragment = SourceFragment(
        id=new_id(), source_id=source.id, locator_type="characters", start_offset=0, end_offset=15,
        selector="chars:0-15", text_digest="sha256:source", excerpt="Grounded source",
    )
    claim = Claim(
        id=new_id(), case_id=case.id, statement="Grounded change", path="/description",
        claim_type="source_statement", status="accepted", confirmation_level="operator_confirmed",
        author_type="dmb_user", author_id=actor.user_id, created_at=utcnow(),
    )
    evidence = ClaimEvidence(
        id=new_id(), claim_id=claim.id, source_fragment_id=fragment.id, evidence_role="supports",
    )
    participant = CaseParticipant(
        id=new_id(), case_id=case.id, subject_type="dmb_user", subject_id=actor.user_id,
        subject_snapshot={}, role="operator", active=True, created_at=utcnow(),
    )
    db.add(case)
    db.flush()
    db.add_all([artifact, source, claim, participant])
    db.flush()
    db.add_all([revision, fragment])
    db.flush()
    artifact.current_revision_id = revision.id
    artifact.approved_revision_id = revision.id
    db.add(evidence)
    db.commit()
    return artifact, revision, claim, fragment


def test_proposed_diff_requires_lineage_and_human_decision(service, db, actor, monkeypatch):
    monkeypatch.setattr(service.settings, "ALLOW_REAL_DATA", True)
    artifact, revision, claim, fragment = _seed_artifact(db, actor)
    with pytest.raises(DomainError) as error:
        service.create_diff({
            "target_type": "task", "target_id": "248", "base_version": 7, "base_digest": "sha256:task-v7",
            "source_revision_id": revision.id, "source_revision_digest": revision.digest,
            "operations": [{"ordinal": 1, "op": "replace", "path": "/owner_id", "proposed_value": "7", "claim_refs": [claim.id], "evidence_refs": [fragment.id], "rationale": "x", "risk": "high"}],
            "expires_at": None,
        }, "diff-00000001")
    assert error.value.code == "diff_validation_failed"

    created = service.create_diff({
        "target_type": "task", "target_id": "248", "base_version": 7, "base_digest": "sha256:task-v7",
        "source_revision_id": revision.id, "source_revision_digest": revision.digest,
        "operations": [{"ordinal": 1, "op": "replace", "path": "/description", "proposed_value": "After", "claim_refs": [claim.id], "evidence_refs": [fragment.id], "rationale": "Clarified", "risk": "low"}],
        "expires_at": None,
    }, "diff-00000002")
    operation = created["operations"][0]
    decided = service.decide_diff_operation(created["id"], operation["id"], {
        "expected_version": created["version"], "decision": "accept", "rationale": "Reviewed by BA",
    }, "diff-decision-0001")
    assert decided["status"] == "accepted"
    intent = service.create_apply_intent(created["id"], {"expected_version": decided["version"]}, "apply-intent-0001")
    assert intent["applied"] is False
    assert intent["prefill"] == {"description": "After"}


def test_actor_envelope_replay_is_rejected(monkeypatch):
    settings = get_settings()
    reset_replay_cache()
    now = int(datetime.now(timezone.utc).timestamp())
    token = jwt.encode({
        "iss": settings.ENVELOPE_ISSUER, "aud": settings.ENVELOPE_AUDIENCE,
        "iat": now, "exp": now + 60, "jti": "unique-jti", "user_id": "42",
        "team_id": "7", "roles": [], "permissions": {}, "pilot_allowed": True,
        "request_id": "req", "trace_id": "trace",
    }, settings.ENVELOPE_SECRET, algorithm=settings.ENVELOPE_ALGORITHM)
    assert decode_actor_envelope(token).user_id == "42"
    with pytest.raises(DomainError) as error:
        decode_actor_envelope(token)
    assert error.value.code == "actor_envelope_replayed"
