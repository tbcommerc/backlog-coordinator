from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agent.orchestrator import AgentOrchestrator
from app.api.errors import DomainError
from app.config import get_settings
from app.domain.digest import DIGEST_ALGORITHM, canonical_json, digest_json, digest_text
from app.domain.diffs import aggregate_diff_status, validate_operations
from app.domain.enums import ArtifactStatus, ClaimType, DiffStatus, NeedCaseStatus
from app.domain.readiness import Finding, evaluate_need_case, validate_business_requirement
from app.domain.transitions import need_case_transition
from app.integrations.dmb_adapter import DmbAdapterClient
from app.models import (
    AgentRun,
    Artifact,
    ArtifactRevision,
    AuditEvent,
    CaseParticipant,
    CaseRevision,
    Claim,
    ClaimEvidence,
    Conflict,
    DecisionRecord,
    DiffOperation,
    ExternalObjectLink,
    Gap,
    IdempotencyRecord,
    Message,
    NeedCase,
    OutboxEvent,
    ProposedDiff,
    ReviewGate,
    RevisionClaim,
    SourceArtifact,
    SourceFragment,
    new_id,
    utcnow,
)
from app.security import ActorContext


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _path_key(path: str | None) -> str | None:
    if not path:
        return None
    clean = path.strip()
    if clean.startswith("/passport/"):
        return clean[len("/passport/"):]
    if clean.startswith("/"):
        return clean[1:]
    return clean


class AssistantV2Service:
    def __init__(self, db: Session, actor: ActorContext, adapter: DmbAdapterClient | None = None):
        self.db = db
        self.actor = actor
        self.adapter = adapter or DmbAdapterClient()
        self.settings = get_settings()

    # ----- common transaction and access helpers -----

    def _idempotent(self, operation: str, key: str, payload: Any) -> tuple[dict | None, str]:
        payload_size = len(canonical_json(payload))
        if payload_size > self.settings.MAX_JSON_BYTES:
            raise DomainError(
                "request_too_large",
                "JSON payload превышает допустимый размер.",
                413,
                {"max_bytes": self.settings.MAX_JSON_BYTES},
            )
        request_hash = digest_json(payload)
        row = self.db.query(IdempotencyRecord).filter_by(
            operation=operation,
            actor_id=self.actor.user_id,
            key=key,
        ).first()
        if row:
            if row.request_hash != request_hash:
                raise DomainError(
                    "idempotency_key_reused",
                    "Idempotency-Key уже использован с другим телом запроса.",
                    409,
                )
            return dict(row.response_json), request_hash
        return None, request_hash

    def _store_idempotency(self, operation: str, key: str, request_hash: str, response: dict, resource_ref: str | None) -> None:
        self.db.add(IdempotencyRecord(
            id=new_id(),
            operation=operation,
            actor_id=self.actor.user_id,
            key=key,
            request_hash=request_hash,
            response_json=response,
            resource_ref=resource_ref,
            created_at=utcnow(),
            expires_at=utcnow() + timedelta(days=7),
        ))

    def _event(
        self,
        *,
        action: str,
        aggregate_type: str,
        aggregate_id: str,
        aggregate_version: int,
        before_digest: str | None,
        after_digest: str | None,
        refs: dict[str, Any] | None = None,
        event_type: str | None = None,
        origin: str = "human",
    ) -> None:
        safe_refs = refs or {}
        self.db.add(AuditEvent(
            id=new_id(),
            request_id=self.actor.request_id,
            trace_id=self.actor.trace_id,
            actor_json=self.actor.audit_snapshot(),
            action=action,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            aggregate_version=aggregate_version,
            before_digest=before_digest,
            after_digest=after_digest,
            refs_json=safe_refs,
            origin=origin,
            guard_result="allowed",
            outcome="ok",
            created_at=utcnow(),
        ))
        self.db.add(OutboxEvent(
            id=new_id(),
            event_type=event_type or action,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            aggregate_version=aggregate_version,
            payload_min={"aggregate_id": aggregate_id, "version": aggregate_version, "refs": safe_refs},
            available_at=utcnow(),
            attempts=0,
        ))

    def _finish(self, *, operation: str, key: str, request_hash: str, response: dict, resource_ref: str | None) -> dict:
        self._store_idempotency(operation, key, request_hash, response, resource_ref)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            winner = self.db.query(IdempotencyRecord).filter_by(
                operation=operation,
                actor_id=self.actor.user_id,
                key=key,
            ).first()
            if winner is None:
                raise
            if winner.request_hash != request_hash:
                raise DomainError(
                    "idempotency_key_reused",
                    "Idempotency-Key уже использован с другим телом запроса.",
                    409,
                )
            return dict(winner.response_json)
        except Exception:
            self.db.rollback()
            raise
        return response

    def _case(self, case_id: str, *, require_access: bool = True) -> NeedCase:
        case = self.db.get(NeedCase, case_id)
        if case is None:
            raise DomainError("case_access_denied", "Кейс недоступен.", 403)
        if case.data_classification == "approved_real" and not self.settings.ALLOW_REAL_DATA:
            raise DomainError("real_data_not_allowed", "Доступ к реальным данным выключен stop-gate.", 403)
        if require_access:
            participant = self.db.query(CaseParticipant).filter_by(
                case_id=case_id,
                subject_type="dmb_user",
                subject_id=self.actor.user_id,
                active=True,
            ).first()
            if participant is None:
                raise DomainError("case_access_denied", "Кейс недоступен.", 403)
        return case

    def _artifact(self, artifact_id: str) -> Artifact:
        artifact = self.db.get(Artifact, artifact_id)
        if artifact is None:
            raise DomainError("artifact_access_denied", "Артефакт недоступен.", 403)
        self._case(artifact.case_id)
        return artifact

    @staticmethod
    def _expect_version(resource: Any, expected: int, resource_type: str) -> None:
        if resource.version != expected:
            raise DomainError(
                "version_conflict",
                "Объект был изменён. Обновите данные и повторите действие.",
                409,
                {"resource_type": resource_type, "submitted_version": expected, "current_version": resource.version},
            )

    def _case_revision(self, case: NeedCase, *, created_by: str | None = None) -> CaseRevision:
        previous = self._current_case_revision(case)
        sources = self.db.query(SourceArtifact).filter_by(case_id=case.id).order_by(SourceArtifact.created_at, SourceArtifact.id).all()
        claims = self.db.query(Claim).filter_by(case_id=case.id).order_by(Claim.created_at, Claim.id).all()
        gaps = self.db.query(Gap).filter_by(case_id=case.id).order_by(Gap.rule_id, Gap.id).all()
        conflicts = self.db.query(Conflict).filter_by(case_id=case.id).order_by(Conflict.severity, Conflict.id).all()
        claim_ids = [claim.id for claim in claims]
        evidence_by_claim: dict[str, list[str]] = {claim_id: [] for claim_id in claim_ids}
        if claim_ids:
            evidence_rows = self.db.query(ClaimEvidence).filter(ClaimEvidence.claim_id.in_(claim_ids)).order_by(
                ClaimEvidence.claim_id, ClaimEvidence.source_fragment_id,
            ).all()
            for evidence in evidence_rows:
                evidence_by_claim.setdefault(evidence.claim_id, []).append(evidence.source_fragment_id)
        content = {
            "title": case.title,
            "data_classification": case.data_classification,
            "passport": case.passport_json or {},
            "sources": [
                {"id": source.id, "digest": source.digest, "supersedes_id": source.supersedes_id}
                for source in sources
            ],
            "claims": [
                {
                    "id": claim.id,
                    "statement": claim.statement,
                    "path": claim.path,
                    "claim_type": claim.claim_type,
                    "status": claim.status,
                    "confirmation_level": claim.confirmation_level,
                    "supersedes_id": claim.supersedes_id,
                    "evidence_fragment_ids": evidence_by_claim.get(claim.id, []),
                }
                for claim in claims
            ],
            "gaps": [self._gap_projection(gap) for gap in gaps],
            "conflicts": [self._conflict_projection(conflict) for conflict in conflicts],
        }
        digest = digest_json(content)
        if previous is not None and previous.digest == digest:
            return previous
        revision = CaseRevision(
            id=new_id(),
            case_id=case.id,
            revision_no=(previous.revision_no + 1) if previous else 1,
            base_revision_id=case.current_revision_id,
            content_json=content,
            digest=digest,
            digest_algorithm=DIGEST_ALGORITHM,
            created_by=created_by or self.actor.user_id,
            created_at=utcnow(),
        )
        self.db.add(revision)
        self.db.flush()
        case.current_revision_id = revision.id
        if previous is not None and previous.digest != revision.digest:
            dependants = self.db.query(Artifact).filter_by(case_id=case.id).all()
            for artifact in dependants:
                artifact.potentially_stale = True
                artifact.version += 1
                artifact.updated_at = utcnow()
                self._event(
                    action="artifact.marked_stale",
                    aggregate_type="artifact",
                    aggregate_id=artifact.id,
                    aggregate_version=artifact.version,
                    before_digest=previous.digest,
                    after_digest=revision.digest,
                    refs={"need_case_id": case.id, "need_case_revision_id": revision.id},
                    event_type="artifact.staleness_detected",
                )
        return revision

    def _current_case_revision(self, case: NeedCase) -> CaseRevision | None:
        return self.db.get(CaseRevision, case.current_revision_id) if case.current_revision_id else None

    # ----- projections and deterministic validation -----

    def readiness(self, case: NeedCase) -> dict[str, Any]:
        revision = self._current_case_revision(case)
        source_count = self.db.query(SourceArtifact).filter_by(case_id=case.id).count()
        claims = self.db.query(Claim).filter_by(case_id=case.id, status="accepted").all()
        gaps = self.db.query(Gap).filter_by(case_id=case.id).all()
        conflicts = self.db.query(Conflict).filter_by(case_id=case.id).all()
        fidelity = False
        if revision:
            fidelity = self.db.query(DecisionRecord).filter_by(
                aggregate_type="need_case",
                aggregate_id=case.id,
                decision_type="fidelity_confirmation",
                after_digest=revision.digest,
            ).first() is not None
        findings = evaluate_need_case(
            source_count=source_count,
            passport=case.passport_json or {},
            accepted_claim_paths=[claim.path for claim in claims if claim.path],
            blocking_gaps=[self._gap_projection(row) for row in gaps if row.severity == "blocking"],
            critical_conflicts=[self._conflict_projection(row) for row in conflicts if row.severity == "critical"],
            fidelity_confirmed=fidelity,
        )
        return {"ready": not findings, "failed_rules": [item.rule_id for item in findings], "findings": [item.as_dict() for item in findings]}

    @staticmethod
    def _gap_projection(row: Gap) -> dict[str, Any]:
        return {
            "id": row.id, "case_id": row.case_id, "artifact_id": row.artifact_id,
            "rule_id": row.rule_id, "path": row.path, "severity": row.severity,
            "status": row.status, "owner_snapshot": row.owner_snapshot, "next_step": row.next_step,
            "due_at": _iso(row.due_at), "version": row.version,
        }

    @staticmethod
    def _conflict_projection(row: Conflict) -> dict[str, Any]:
        return {
            "id": row.id, "case_id": row.case_id, "artifact_id": row.artifact_id,
            "left_ref": row.left_ref, "right_ref": row.right_ref,
            "severity": row.severity, "status": row.status,
            "resolution_decision_id": row.resolution_decision_id, "version": row.version,
        }

    def case_projection(self, case: NeedCase, *, include_content: bool = True) -> dict[str, Any]:
        revision = self._current_case_revision(case)
        sources = self.db.query(SourceArtifact).filter_by(case_id=case.id).order_by(SourceArtifact.captured_at).all()
        claims = self.db.query(Claim).filter_by(case_id=case.id).order_by(Claim.created_at).all()
        gaps = self.db.query(Gap).filter_by(case_id=case.id).all()
        conflicts = self.db.query(Conflict).filter_by(case_id=case.id).all()
        artifacts = self.db.query(Artifact).filter_by(case_id=case.id).order_by(Artifact.created_at).all()
        fragment_rows = self.db.query(SourceFragment).join(SourceArtifact).filter(SourceArtifact.case_id == case.id).all()
        fragments_by_source: dict[str, list[SourceFragment]] = {}
        for fragment in fragment_rows:
            fragments_by_source.setdefault(fragment.source_id, []).append(fragment)
        return {
            "id": case.id,
            "case_number": case.case_number,
            "title": case.title,
            "status": case.status,
            "data_classification": case.data_classification,
            "version": case.version,
            "current_revision_id": case.current_revision_id,
            "current_revision_digest": revision.digest if revision else None,
            "passport": case.passport_json or {},
            "potentially_stale": case.potentially_stale,
            "sources": [
                {
                    "id": row.id, "kind": row.kind, "origin_type": row.origin_type, "channel": row.channel,
                    "mime_type": row.mime_type, "content": row.content if include_content else None,
                    "digest": row.digest, "captured_at": _iso(row.captured_at), "supersedes_id": row.supersedes_id,
                    "fragments": [
                        {
                            "id": fragment.id,
                            "selector": fragment.selector,
                            "excerpt": fragment.excerpt if include_content else None,
                            "text_digest": fragment.text_digest,
                        }
                        for fragment in fragments_by_source.get(row.id, [])
                    ],
                }
                for row in sources
            ],
            "claims": [self.claim_projection(row) for row in claims],
            "gaps": [self._gap_projection(row) for row in gaps],
            "conflicts": [self._conflict_projection(row) for row in conflicts],
            "artifacts": [{"id": row.id, "status": row.status, "version": row.version, "current_revision_id": row.current_revision_id} for row in artifacts],
            "readiness": self.readiness(case),
            "created_by": {"type": "dmb_user", "id": case.created_by},
            "created_at": _iso(case.created_at),
            "updated_at": _iso(case.updated_at),
        }

    def claim_projection(self, claim: Claim) -> dict[str, Any]:
        evidence = self.db.query(ClaimEvidence).filter_by(claim_id=claim.id).all()
        return {
            "id": claim.id,
            "case_id": claim.case_id,
            "statement": claim.statement,
            "path": claim.path,
            "claim_type": claim.claim_type,
            "status": claim.status,
            "confirmation_level": claim.confirmation_level,
            "confidence": claim.confidence,
            "author": {"type": claim.author_type, "id": claim.author_id},
            "evidence": [{"source_fragment_id": item.source_fragment_id, "role": item.evidence_role} for item in evidence],
            "supersedes_id": claim.supersedes_id,
            "created_at": _iso(claim.created_at),
        }

    def artifact_projection(self, artifact: Artifact) -> dict[str, Any]:
        revision = self.db.get(ArtifactRevision, artifact.current_revision_id) if artifact.current_revision_id else None
        revisions = self.db.query(ArtifactRevision).filter_by(artifact_id=artifact.id).order_by(ArtifactRevision.revision_no).all()
        findings = self._artifact_findings(revision) if revision else []
        available_claims = self.db.query(Claim).filter_by(case_id=artifact.case_id, status="accepted").order_by(Claim.created_at).all()
        return {
            "id": artifact.id,
            "case_id": artifact.case_id,
            "artifact_type": artifact.artifact_type,
            "status": artifact.status,
            "version": artifact.version,
            "current_revision_id": artifact.current_revision_id,
            "approved_revision_id": artifact.approved_revision_id,
            "potentially_stale": artifact.potentially_stale,
            "current_revision": self.revision_projection(revision) if revision else None,
            "revisions": [self.revision_projection(row, include_content=False) for row in revisions],
            "available_claims": [self.claim_projection(row) for row in available_claims],
            "readiness": {"ready": not findings, "failed_rules": [item.rule_id for item in findings], "findings": [item.as_dict() for item in findings]},
            "created_at": _iso(artifact.created_at),
            "updated_at": _iso(artifact.updated_at),
        }

    def _artifact_findings(self, revision: ArtifactRevision) -> list[Finding]:
        findings = validate_business_requirement(revision.content_json)
        if self.db.query(RevisionClaim).filter_by(revision_id=revision.id).count() == 0:
            findings.append(Finding(
                "BR_CLAIM_TRACEABILITY",
                "blocking",
                "/traceability",
                "Свяжите ревизию хотя бы с одним подтверждённым claim и его evidence.",
            ))
        return findings

    def revision_projection(self, revision: ArtifactRevision | None, *, include_content: bool = True) -> dict[str, Any] | None:
        if revision is None:
            return None
        links = self.db.query(RevisionClaim).filter_by(revision_id=revision.id).order_by(RevisionClaim.usage_path).all()
        return {
            "id": revision.id,
            "artifact_id": revision.artifact_id,
            "revision_no": revision.revision_no,
            "base_revision_id": revision.base_revision_id,
            "schema_version": revision.schema_version,
            "content": revision.content_json if include_content else None,
            "digest": revision.digest,
            "digest_algorithm": revision.digest_algorithm,
            "created_by": {"type": "dmb_user", "id": revision.created_by},
            "created_at": _iso(revision.created_at),
            "claim_traceability": [
                {
                    "claim_id": link.claim_id,
                    "usage_path": link.usage_path,
                    "usage_type": link.usage_type,
                    "claim": self.claim_projection(self.db.get(Claim, link.claim_id)),
                }
                for link in links
            ],
        }

    def diff_projection(self, diff: ProposedDiff) -> dict[str, Any]:
        operations = self.db.query(DiffOperation).filter_by(diff_id=diff.id).order_by(DiffOperation.ordinal).all()
        source_revision = self.db.get(ArtifactRevision, diff.source_revision_id)
        source_artifact = self.db.get(Artifact, source_revision.artifact_id) if source_revision else None
        return {
            "id": diff.id,
            "target": {
                "system": diff.target_system, "type": diff.target_type, "id": diff.target_id,
                "base_version": diff.base_version, "base_digest": diff.base_digest,
            },
            "source_revision_id": diff.source_revision_id,
            "source_revision_digest": diff.source_revision_digest,
            "source_baseline_approved": bool(source_artifact and source_artifact.approved_revision_id == diff.source_revision_id),
            "status": diff.status,
            "version": diff.version,
            "operations": [
                {
                    "id": row.id, "ordinal": row.ordinal, "op": row.op, "path": row.path,
                    "old_value_hash": row.old_value_hash, "proposed_value": row.proposed_value,
                    "claim_refs": row.claim_refs, "evidence_refs": row.evidence_refs,
                    "rationale": row.rationale, "risk": row.risk,
                    "decision_status": row.decision_status, "decision_record_id": row.decision_record_id,
                }
                for row in operations
            ],
            "created_at": _iso(diff.created_at),
            "expires_at": _iso(diff.expires_at),
            "rebased_from_id": diff.rebased_from_id,
        }

    # ----- case commands -----

    def create_case(self, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.create", key, body)
        if cached:
            return cached
        if body.get("data_classification") == "approved_real" and not self.settings.ALLOW_REAL_DATA:
            raise DomainError("real_data_not_allowed", "Реальные данные запрещены до утверждения retention/privacy policy.", 403)
        case_id = new_id()
        case = NeedCase(
            id=case_id,
            case_number=f"NC-{utcnow().year}-{case_id.split('-')[0].upper()}",
            title=body["title"].strip(),
            status=NeedCaseStatus.DRAFT,
            data_classification=body.get("data_classification") or "synthetic",
            version=0,
            passport_json=dict(body.get("passport") or {}),
            created_by=self.actor.user_id,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(case)
        # The participant rows reference the case by id, but the models do not
        # define an ORM relationship that SQLAlchemy can use for flush ordering.
        # Persist the parent explicitly before adding its participants.
        self.db.flush()
        self.db.add(CaseParticipant(
            id=new_id(), case_id=case.id, subject_type="dmb_user", subject_id=self.actor.user_id,
            subject_snapshot={"team_id": self.actor.team_id}, role="operator", active=True, created_at=utcnow(),
        ))
        source_party = body.get("source_party") or {}
        if source_party:
            self.db.add(CaseParticipant(
                id=new_id(), case_id=case.id,
                subject_type=str(source_party.get("type") or "external"),
                subject_id=str(source_party.get("id") or f"provisional:{new_id()}"),
                subject_snapshot={key: value for key, value in source_party.items() if key not in {"password", "token", "secret"}},
                role="source", active=True, created_at=utcnow(),
            ))
        self.db.flush()
        revision = self._case_revision(case)
        self._event(action="case.created", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version, before_digest=None, after_digest=revision.digest)
        response = self.case_projection(case)
        return self._finish(operation="case.create", key=key, request_hash=request_hash, response=response, resource_ref=f"need_case:{case.id}")

    def list_cases(self, *, limit: int, cursor: str | None) -> dict[str, Any]:
        accessible = self.db.query(CaseParticipant.case_id).filter_by(
            subject_type="dmb_user", subject_id=self.actor.user_id, active=True,
        )
        query = self.db.query(NeedCase).filter(NeedCase.id.in_(accessible)).order_by(NeedCase.updated_at.desc(), NeedCase.id.desc())
        if not self.settings.ALLOW_REAL_DATA:
            query = query.filter(NeedCase.data_classification == "synthetic")
        if cursor:
            try:
                cursor_time_text, cursor_id = cursor.split("|", 1)
                cursor_time = datetime.fromisoformat(cursor_time_text.replace("Z", "+00:00"))
            except (TypeError, ValueError) as exc:
                raise DomainError("invalid_cursor", "Некорректный cursor.", 400) from exc
            query = query.filter(or_(NeedCase.updated_at < cursor_time, and_(NeedCase.updated_at == cursor_time, NeedCase.id < cursor_id)))
        rows = query.limit(limit + 1).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = f"{_iso(rows[-1].updated_at)}|{rows[-1].id}" if has_more and rows else None
        return {"items": [self.case_projection(row, include_content=False) for row in rows], "next_cursor": next_cursor}

    def add_source(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.source.create", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        if body["kind"] == "raw_audio":
            raise DomainError("source_kind_not_supported", "Сырое аудио не поддерживается в MVP.", 415)
        content = body["content"]
        if len(content.encode("utf-8")) > self.settings.MAX_SOURCE_BYTES:
            raise DomainError("source_too_large", "Источник превышает допустимый размер.", 413, {"max_bytes": self.settings.MAX_SOURCE_BYTES})
        if body.get("supersedes_id"):
            previous = self.db.get(SourceArtifact, body["supersedes_id"])
            if previous is None or previous.case_id != case.id:
                raise DomainError("source_not_found", "Заменяемый источник недоступен.", 422)
        before = self._current_case_revision(case)
        source = SourceArtifact(
            id=new_id(), case_id=case.id, kind=body["kind"], origin_type=body["origin_type"], channel=body["channel"],
            mime_type=body.get("mime_type") or "text/plain", content=content, digest=digest_text(content),
            digest_algorithm=DIGEST_ALGORITHM, captured_at=body["captured_at"], supersedes_id=body.get("supersedes_id"),
            created_by=self.actor.user_id, created_at=utcnow(),
        )
        fragment = SourceFragment(
            id=new_id(), source_id=source.id, locator_type="characters", start_offset=0, end_offset=len(content),
            selector=f"chars:0-{len(content)}", text_digest=digest_text(content), excerpt=content[:1000],
        )
        self.db.add_all([source, fragment])
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        self._event(
            action="case.source_added", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=before.digest if before else None, after_digest=revision.digest,
            refs={"source_id": source.id, "fragment_id": fragment.id, "supersedes_id": source.supersedes_id},
        )
        response = {"case": self.case_projection(case), "source_id": source.id, "fragment_id": fragment.id}
        return self._finish(operation="case.source.create", key=key, request_hash=request_hash, response=response, resource_ref=f"source:{source.id}")

    def create_claim(self, case_id: str, body: dict[str, Any], key: str, *, origin: str = "human") -> dict:
        cached, request_hash = self._idempotent("case.claim.create", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        evidence_ids = list(body.get("evidence_fragment_ids") or [])
        fragments = self.db.query(SourceFragment).join(SourceArtifact).filter(
            SourceFragment.id.in_(evidence_ids), SourceArtifact.case_id == case.id,
        ).all() if evidence_ids else []
        if len(fragments) != len(set(evidence_ids)):
            raise DomainError("evidence_not_found", "Evidence fragment недоступен в этом кейсе.", 422)
        claim_type = str(body["claim_type"])
        if claim_type in {ClaimType.SOURCE_STATEMENT, ClaimType.SOURCE_INTENT} and not fragments:
            raise DomainError("evidence_required", "Для source claim требуется SourceFragment.", 422)
        accepted = body.get("status") == "accepted"
        if origin == "agent" and accepted:
            raise DomainError("agent_confirmation_forbidden", "Agent proposal не может быть подтверждён автоматически.", 422)
        claim = Claim(
            id=new_id(), case_id=case.id, statement=body["statement"].strip(), path=body.get("path"), claim_type=claim_type,
            status="accepted" if accepted else "proposed",
            confirmation_level="operator_confirmed" if accepted else "unconfirmed",
            confidence=body.get("confidence"), author_type="dmb_user" if origin == "human" else "agent",
            author_id=self.actor.user_id if origin == "human" else None, created_revision_id=case.current_revision_id,
            created_at=utcnow(),
        )
        self.db.add(claim)
        for fragment in fragments:
            self.db.add(ClaimEvidence(id=new_id(), claim_id=claim.id, source_fragment_id=fragment.id, evidence_role="supports"))
        before = self._current_case_revision(case)
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        self._event(
            action="case.claim_created", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=before.digest if before else None, after_digest=revision.digest, refs={"claim_id": claim.id}, origin=origin,
        )
        response = {"case_version": case.version, "claim": self.claim_projection(claim), "readiness": self.readiness(case)}
        return self._finish(operation="case.claim.create", key=key, request_hash=request_hash, response=response, resource_ref=f"claim:{claim.id}")

    def decide_claim(self, case_id: str, claim_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.claim.decision", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        claim = self.db.get(Claim, claim_id)
        if claim is None or claim.case_id != case.id:
            raise DomainError("claim_not_found", "Claim недоступен.", 404)
        before = self._current_case_revision(case)
        decision = body["decision"]
        target_claim = claim
        if decision == "accept":
            if claim.claim_type == ClaimType.AGENT_HYPOTHESIS:
                raise DomainError("hypothesis_confirmation_forbidden", "Гипотезу нужно исправить в operator_interpretation перед подтверждением.", 422)
            claim.status = "accepted"
            claim.confirmation_level = "operator_confirmed"
        elif decision == "reject":
            claim.status = "rejected"
            claim.confirmation_level = "rejected"
        else:
            edited_type = str(body.get("edited_claim_type") or ClaimType.OPERATOR_INTERPRETATION)
            if edited_type == ClaimType.AGENT_HYPOTHESIS:
                raise DomainError("edited_claim_type_invalid", "Human edit не может подтверждаться как agent_hypothesis.", 422)
            claim.status = "superseded"
            target_claim = Claim(
                id=new_id(), case_id=case.id, statement=body["edited_statement"].strip(), path=claim.path,
                claim_type=edited_type, status="accepted", confirmation_level="operator_confirmed", confidence=None,
                author_type="dmb_user", author_id=self.actor.user_id, supersedes_id=claim.id,
                created_revision_id=case.current_revision_id, created_at=utcnow(),
            )
            self.db.add(target_claim)
            for evidence in self.db.query(ClaimEvidence).filter_by(claim_id=claim.id).all():
                self.db.add(ClaimEvidence(id=new_id(), claim_id=target_claim.id, source_fragment_id=evidence.source_fragment_id, evidence_role=evidence.evidence_role))
        key_name = _path_key(target_claim.path)
        if decision in {"accept", "edit"} and key_name and body.get("passport_value") is not None:
            passport = dict(case.passport_json or {})
            passport[key_name] = body["passport_value"]
            case.passport_json = passport
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        record = DecisionRecord(
            id=new_id(), aggregate_type="claim", aggregate_id=target_claim.id, decision_type=f"claim_{decision}",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"],
            target_refs={"original_claim_id": claim.id, "case_id": case.id},
            before_digest=before.digest if before else None, after_digest=revision.digest,
            idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(record)
        self.db.flush()
        self._event(
            action="case.claim_decided", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=before.digest if before else None, after_digest=revision.digest,
            refs={"claim_id": target_claim.id, "decision_id": record.id, "decision": decision},
        )
        response = {"case_version": case.version, "claim": self.claim_projection(target_claim), "readiness": self.readiness(case)}
        return self._finish(operation="case.claim.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"claim:{target_claim.id}")

    def record_case_decision(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.decision", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        revision = self._current_case_revision(case)
        if revision is None:
            raise DomainError("case_revision_missing", "У кейса отсутствует revision.", 409)
        submitted_digest = body.get("revision_digest") or revision.digest
        if submitted_digest != revision.digest:
            raise DomainError("version_conflict", "Подтверждение относится к устаревшей ревизии.", 409, {"current_digest": revision.digest})
        case.version += 1
        case.updated_at = utcnow()
        record = DecisionRecord(
            id=new_id(), aggregate_type="need_case", aggregate_id=case.id, decision_type=body["decision_type"],
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"], target_refs=body.get("target_refs") or {},
            before_digest=revision.digest, after_digest=revision.digest, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(record)
        self._event(
            action="case.decision_recorded", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=revision.digest, after_digest=revision.digest, refs={"decision_id": record.id, "decision_type": record.decision_type},
        )
        response = {"case_version": case.version, "decision_id": record.id, "readiness": self.readiness(case)}
        return self._finish(operation="case.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"decision:{record.id}")

    def create_gap(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.gap.create", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        before = self._current_case_revision(case)
        gap = Gap(
            id=new_id(), case_id=case.id, artifact_id=None, rule_id=body["rule_id"].strip(),
            path=body["path"].strip(), severity=body["severity"], status="open",
            owner_snapshot=body.get("owner_snapshot"), next_step=body.get("next_step"),
            due_at=body.get("due_at"), version=0,
        )
        self.db.add(gap)
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        self._event(
            action="case.gap_opened", aggregate_type="need_case", aggregate_id=case.id,
            aggregate_version=case.version, before_digest=before.digest if before else None,
            after_digest=revision.digest, refs={"gap_id": gap.id, "rule_id": gap.rule_id},
        )
        response = {"case_version": case.version, "gap": self._gap_projection(gap), "readiness": self.readiness(case)}
        return self._finish(operation="case.gap.create", key=key, request_hash=request_hash, response=response, resource_ref=f"gap:{gap.id}")

    def decide_gap(self, case_id: str, gap_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.gap.decision", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_case_version"], "need_case")
        gap = self.db.get(Gap, gap_id)
        if gap is None or gap.case_id != case.id:
            raise DomainError("gap_not_found", "Gap недоступен.", 404)
        self._expect_version(gap, body["expected_version"], "gap")
        before_revision = self._current_case_revision(case)
        before_gap_digest = digest_json(self._gap_projection(gap))
        decision_name = body["decision"]
        gap.status = {"resolve": "resolved", "assign": "open", "defer": "deferred", "reopen": "open"}[decision_name]
        if body.get("owner_snapshot") is not None:
            gap.owner_snapshot = body["owner_snapshot"]
        if body.get("next_step") is not None:
            gap.next_step = body["next_step"]
        if body.get("due_at") is not None:
            gap.due_at = body["due_at"]
        gap.version += 1
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        record = DecisionRecord(
            id=new_id(), aggregate_type="gap", aggregate_id=gap.id, decision_type=f"gap_{decision_name}",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"],
            target_refs={"case_id": case.id, "owner_snapshot": gap.owner_snapshot, "next_step": gap.next_step},
            before_digest=before_gap_digest, after_digest=digest_json(self._gap_projection(gap)),
            idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(record)
        self._event(
            action="case.gap_decided", aggregate_type="need_case", aggregate_id=case.id,
            aggregate_version=case.version, before_digest=before_revision.digest if before_revision else None,
            after_digest=revision.digest, refs={"gap_id": gap.id, "decision_id": record.id, "decision": decision_name},
        )
        response = {
            "case_version": case.version, "gap": self._gap_projection(gap),
            "decision_id": record.id, "readiness": self.readiness(case),
        }
        return self._finish(operation="case.gap.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"gap:{gap.id}")

    def _validate_case_ref(self, case: NeedCase, value: str) -> None:
        try:
            kind, resource_id = value.split(":", 1)
        except ValueError as exc:
            raise DomainError("conflict_ref_invalid", "Conflict ref должен иметь вид claim:<id> или revision:<id>.", 422) from exc
        if kind == "claim":
            claim = self.db.get(Claim, resource_id)
            valid = claim is not None and claim.case_id == case.id
        elif kind == "revision":
            revision = self.db.get(ArtifactRevision, resource_id)
            artifact = self.db.get(Artifact, revision.artifact_id) if revision else None
            valid = artifact is not None and artifact.case_id == case.id
        else:
            valid = False
        if not valid:
            raise DomainError("conflict_ref_invalid", "Conflict ref недоступен в этом кейсе.", 422)

    def create_conflict(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.conflict.create", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        self._validate_case_ref(case, body["left_ref"])
        self._validate_case_ref(case, body["right_ref"])
        before = self._current_case_revision(case)
        conflict = Conflict(
            id=new_id(), case_id=case.id, artifact_id=None, left_ref=body["left_ref"],
            right_ref=body["right_ref"], severity=body["severity"], status="open", version=0,
        )
        self.db.add(conflict)
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        self._event(
            action="case.conflict_opened", aggregate_type="need_case", aggregate_id=case.id,
            aggregate_version=case.version, before_digest=before.digest if before else None,
            after_digest=revision.digest, refs={"conflict_id": conflict.id},
        )
        response = {"case_version": case.version, "conflict": self._conflict_projection(conflict), "readiness": self.readiness(case)}
        return self._finish(operation="case.conflict.create", key=key, request_hash=request_hash, response=response, resource_ref=f"conflict:{conflict.id}")

    def decide_conflict(self, case_id: str, conflict_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.conflict.decision", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_case_version"], "need_case")
        conflict = self.db.get(Conflict, conflict_id)
        if conflict is None or conflict.case_id != case.id:
            raise DomainError("conflict_not_found", "Conflict недоступен.", 404)
        self._expect_version(conflict, body["expected_version"], "conflict")
        before_revision = self._current_case_revision(case)
        before_conflict_digest = digest_json(self._conflict_projection(conflict))
        decision_name = body["decision"]
        conflict.status = {"resolve": "resolved", "escalate": "escalated", "reopen": "open"}[decision_name]
        conflict.version += 1
        case.version += 1
        case.updated_at = utcnow()
        record = DecisionRecord(
            id=new_id(), aggregate_type="conflict", aggregate_id=conflict.id,
            decision_type=f"conflict_{decision_name}", actor_json=self.actor.audit_snapshot(),
            rationale=body["rationale"],
            target_refs={"case_id": case.id, "owner_snapshot": body.get("owner_snapshot")},
            before_digest=before_conflict_digest, after_digest=None, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(record)
        self.db.flush()
        conflict.resolution_decision_id = record.id if decision_name in {"resolve", "escalate"} else None
        self.db.flush()
        record.after_digest = digest_json(self._conflict_projection(conflict))
        revision = self._case_revision(case)
        self._event(
            action="case.conflict_decided", aggregate_type="need_case", aggregate_id=case.id,
            aggregate_version=case.version, before_digest=before_revision.digest if before_revision else None,
            after_digest=revision.digest,
            refs={"conflict_id": conflict.id, "decision_id": record.id, "decision": decision_name},
        )
        response = {
            "case_version": case.version, "conflict": self._conflict_projection(conflict),
            "decision_id": record.id, "readiness": self.readiness(case),
        }
        return self._finish(operation="case.conflict.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"conflict:{conflict.id}")

    def transition_case(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.transition", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        target = str(body["target_status"])
        rule = need_case_transition(case.status, target)
        if not rule.allowed:
            raise DomainError("transition_not_allowed", "Переход состояния не разрешён.", 422, {"from": case.status, "to": target})
        if target == NeedCaseStatus.CAPTURED and self.db.query(SourceArtifact).filter_by(case_id=case.id).count() == 0:
            raise DomainError("readiness_failed", "Для captured требуется immutable source.", 422, {"failed_rules": ["S1_SOURCE_REQUIRED"]})
        readiness = self.readiness(case)
        if rule.requires_readiness and not readiness["ready"]:
            raise DomainError("readiness_failed", "Кейс не прошёл readiness gate.", 422, readiness)
        if target == NeedCaseStatus.DUPLICATE and not (body.get("disposition") or {}).get("target_case_id"):
            raise DomainError("duplicate_target_required", "Для duplicate требуется target case.", 422)
        if target in {NeedCaseStatus.DEFERRED, NeedCaseStatus.REJECTED} and not body["rationale"].strip():
            raise DomainError("rationale_required", "Для перехода требуется причина.", 422)
        before = self._current_case_revision(case)
        old_status = case.status
        case.status = target
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        decision = DecisionRecord(
            id=new_id(), aggregate_type="need_case", aggregate_id=case.id, decision_type="lifecycle_transition",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"],
            target_refs={"from": old_status, "to": target, **(body.get("disposition") or {})},
            before_digest=before.digest if before else None, after_digest=revision.digest, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self._event(
            action="case.transitioned", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=before.digest if before else None, after_digest=revision.digest,
            refs={"decision_id": decision.id, "from": old_status, "to": target},
        )
        response = self.case_projection(case)
        return self._finish(operation="case.transition", key=key, request_hash=request_hash, response=response, resource_ref=f"need_case:{case.id}")

    def split_case(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.split", key, body)
        if cached:
            return cached
        parent = self._case(case_id)
        self._expect_version(parent, body["expected_version"], "need_case")
        parent_revision = self._current_case_revision(parent)
        parent_source_ids = [row[0] for row in self.db.query(SourceArtifact.id).filter_by(case_id=parent.id).all()]
        parent_claim_ids = [row[0] for row in self.db.query(Claim.id).filter_by(case_id=parent.id).all()]
        child_ids: list[str] = []
        for item in body["children"]:
            child_id = new_id()
            child_passport = dict(item.get("passport") or {})
            child_passport["split_lineage"] = {
                "parent_case_id": parent.id,
                "parent_revision_id": parent_revision.id if parent_revision else None,
                "parent_revision_digest": parent_revision.digest if parent_revision else None,
                "source_ids": parent_source_ids,
                "claim_ids": parent_claim_ids,
                "confirmation_copied": False,
            }
            child = NeedCase(
                id=child_id, case_number=f"NC-{utcnow().year}-{child_id.split('-')[0].upper()}", title=item["title"],
                status=NeedCaseStatus.DRAFT, data_classification=parent.data_classification,
                version=0, parent_case_id=parent.id, passport_json=child_passport,
                created_by=self.actor.user_id, created_at=utcnow(), updated_at=utcnow(),
            )
            self.db.add(child)
            self.db.flush()
            self.db.add(CaseParticipant(
                id=new_id(), case_id=child.id, subject_type="dmb_user", subject_id=self.actor.user_id,
                subject_snapshot={"team_id": self.actor.team_id}, role="operator", active=True, created_at=utcnow(),
            ))
            self.db.flush()
            child_revision = self._case_revision(child)
            self._event(
                action="case.split_child_created", aggregate_type="need_case", aggregate_id=child.id,
                aggregate_version=0, before_digest=parent_revision.digest if parent_revision else None,
                after_digest=child_revision.digest,
                refs={
                    "parent_case_id": parent.id,
                    "parent_revision_id": parent_revision.id if parent_revision else None,
                    "source_count": len(parent_source_ids),
                    "claim_count": len(parent_claim_ids),
                    "confirmation_copied": False,
                },
            )
            child_ids.append(child.id)
        parent.version += 1
        parent.updated_at = utcnow()
        revision = self._current_case_revision(parent)
        decision = DecisionRecord(
            id=new_id(), aggregate_type="need_case", aggregate_id=parent.id, decision_type="split",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"], target_refs={"child_case_ids": child_ids},
            before_digest=revision.digest if revision else None, after_digest=revision.digest if revision else None,
            idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self._event(
            action="case.split", aggregate_type="need_case", aggregate_id=parent.id, aggregate_version=parent.version,
            before_digest=revision.digest if revision else None, after_digest=revision.digest if revision else None,
            refs={"decision_id": decision.id, "child_case_ids": child_ids},
        )
        response = {"parent_case_id": parent.id, "parent_version": parent.version, "child_case_ids": child_ids, "decision_id": decision.id}
        return self._finish(operation="case.split", key=key, request_hash=request_hash, response=response, resource_ref=f"need_case:{parent.id}")

    # ----- messages / safe proposal runtime -----

    def add_message(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.message.create", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_case_version"], "need_case")
        artifact_revision_id = body.get("artifact_revision_id")
        if body["mode"] == "requirement_copilot" and not artifact_revision_id:
            raise DomainError("artifact_revision_required", "Для requirement_copilot нужна ревизия BR.", 422)
        if artifact_revision_id:
            artifact_revision = self.db.get(ArtifactRevision, artifact_revision_id)
            if artifact_revision is None:
                raise DomainError("revision_not_found", "Ревизия BR недоступна.", 404)
            artifact = self._artifact(artifact_revision.artifact_id)
            if artifact.case_id != case.id:
                raise DomainError("revision_not_found", "Ревизия BR недоступна в этом кейсе.", 404)
        if len(body["body"].encode("utf-8")) > self.settings.MAX_MESSAGE_BYTES:
            raise DomainError("message_too_large", "Сообщение превышает допустимый размер.", 413)
        existing = self.db.query(Message).filter_by(case_id=case.id, message_id=body["message_id"]).first()
        if existing:
            run = self.db.query(AgentRun).filter_by(case_id=case.id, message_id=body["message_id"]).first()
            return run.result_json if run else {"status": "queued", "message_id": body["message_id"]}
        before = self._current_case_revision(case)
        message = Message(
            id=new_id(), case_id=case.id, actor_type="dmb_user", actor_id=self.actor.user_id, role="user",
            body=body["body"], body_digest=digest_text(body["body"]), message_id=body["message_id"], created_at=utcnow(),
        )
        source = SourceArtifact(
            id=new_id(), case_id=case.id, kind="message", origin_type="operator_input", channel="assistant_v2",
            mime_type="text/plain", content=body["body"], digest=digest_text(body["body"]), digest_algorithm=DIGEST_ALGORITHM,
            captured_at=utcnow(), created_by=self.actor.user_id, created_at=utcnow(),
        )
        fragment = SourceFragment(
            id=new_id(), source_id=source.id, locator_type="characters", start_offset=0, end_offset=len(body["body"]),
            selector=f"chars:0-{len(body['body'])}", text_digest=digest_text(body["body"]), excerpt=body["body"][:1000],
        )
        self.db.add_all([message, source, fragment])
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        self._event(
            action="case.message_saved", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=before.digest if before else None, after_digest=revision.digest,
            refs={"message_id": message.message_id, "source_id": source.id, "fragment_id": fragment.id},
        )
        # Persist input and its audit before any provider work. This commit is intentional.
        self.db.commit()
        input_case_version = case.version
        readiness = self.readiness(case)
        proposal = AgentOrchestrator().propose(
            message=body["body"], mode=body["mode"], fragment_id=fragment.id,
            failed_rules=list(readiness["failed_rules"]),
        )
        claim = Claim(
            id=new_id(), case_id=case.id, statement=proposal.proposed_claims[0].statement,
            path=proposal.proposed_claims[0].path, claim_type=proposal.proposed_claims[0].claim_type,
            status="proposed", confirmation_level="unconfirmed", confidence=proposal.proposed_claims[0].confidence,
            author_type="agent", author_id=None, created_revision_id=revision.id, created_at=utcnow(),
        )
        self.db.add(claim)
        self.db.add(ClaimEvidence(id=new_id(), claim_id=claim.id, source_fragment_id=fragment.id, evidence_role="supports"))
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        output_revision = self._case_revision(case)
        result = proposal.model_dump()
        result["proposed_claims"][0]["id"] = claim.id
        result.update({
            "status": "completed",
            "input": {"case_version": input_case_version, "case_revision_id": revision.id, "case_revision_digest": revision.digest},
            "output": {
                "case_version": case.version,
                "case_revision_id": output_revision.id,
                "case_revision_digest": output_revision.digest,
            },
            "model_metadata": {
                "model_id": "manual-safe-mode", "prompt_version": self.settings.PROMPT_VERSION,
                "policy_version": self.settings.POLICY_VERSION, "schema_version": self.settings.OUTPUT_SCHEMA_VERSION,
            },
        })
        run = AgentRun(
            id=new_id(), case_id=case.id, artifact_id=None, revision_id=body.get("artifact_revision_id"),
            message_id=body["message_id"], input_revision_digest=revision.digest, mode=body["mode"],
            model="manual-safe-mode", prompt_version=self.settings.PROMPT_VERSION, policy_version=self.settings.POLICY_VERSION,
            schema_version=self.settings.OUTPUT_SCHEMA_VERSION, status="completed", result_json={}, token_metadata={},
            started_at=utcnow(), ended_at=utcnow(),
        )
        result["run_id"] = run.id
        run.result_json = result
        self.db.add(run)
        self._event(
            action="agent.proposal_created", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=revision.digest, after_digest=output_revision.digest,
            refs={"run_id": run.id, "claim_id": claim.id, "mode": body["mode"]}, origin="agent",
        )
        return self._finish(operation="case.message.create", key=key, request_hash=request_hash, response=result, resource_ref=f"agent_run:{run.id}")

    # ----- artifacts and review -----

    def _new_artifact(self, case: NeedCase, title: str, content: dict[str, Any]) -> Artifact:
        initial = {"title": title, **content}
        artifact = Artifact(
            id=new_id(), case_id=case.id, artifact_type="business_requirement", status=ArtifactStatus.DRAFTING,
            version=0, potentially_stale=False, created_by=self.actor.user_id, created_at=utcnow(), updated_at=utcnow(),
        )
        self.db.add(artifact)
        self.db.flush()
        revision = ArtifactRevision(
            id=new_id(), artifact_id=artifact.id, revision_no=1, base_revision_id=None,
            schema_version="business-requirement/1.0", content_json=initial,
            digest=digest_json(initial), digest_algorithm=DIGEST_ALGORITHM,
            created_by=self.actor.user_id, created_at=utcnow(),
        )
        self.db.add(revision)
        self.db.flush()
        artifact.current_revision_id = revision.id
        accepted_claims = self.db.query(Claim).filter_by(case_id=case.id, status="accepted").all()
        for claim in accepted_claims:
            self.db.add(RevisionClaim(
                id=new_id(), revision_id=revision.id, claim_id=claim.id,
                usage_path=claim.path or "/", usage_type="supports",
            ))
        self.db.flush()
        return artifact

    def handoff(self, case_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("case.handoff", key, body)
        if cached:
            return cached
        case = self._case(case_id)
        self._expect_version(case, body["expected_version"], "need_case")
        readiness = self.readiness(case)
        if case.status != NeedCaseStatus.READY_FOR_ANALYSIS or not readiness["ready"]:
            raise DomainError("readiness_failed", "Handoff доступен только для ready_for_analysis.", 422, readiness)
        case_revision = self._current_case_revision(case)
        unresolved_items = [
            {"kind": "gap", **self._gap_projection(row)}
            for row in self.db.query(Gap).filter_by(case_id=case.id, status="open").all()
        ] + [
            {"kind": "conflict", **self._conflict_projection(row)}
            for row in self.db.query(Conflict).filter_by(case_id=case.id).all()
            if row.status not in {"resolved", "escalated"}
        ]
        artifact_ids: list[str] = []
        for item in body["requirements"]:
            content = dict(item.get("content") or {})
            content.setdefault("traceability", [{"need_case_revision_id": case_revision.id, "digest": case_revision.digest}])
            content.setdefault("unresolved_items", unresolved_items)
            artifact = self._new_artifact(case, item["title"], content)
            artifact_ids.append(artifact.id)
            self._event(
                action="artifact.created_from_handoff", aggregate_type="artifact", aggregate_id=artifact.id,
                aggregate_version=artifact.version, before_digest=None,
                after_digest=self.db.get(ArtifactRevision, artifact.current_revision_id).digest,
                refs={"need_case_id": case.id, "need_case_revision_id": case_revision.id},
            )
        old_status = case.status
        case.status = NeedCaseStatus.HANDED_OFF
        case.version += 1
        case.updated_at = utcnow()
        self.db.flush()
        revision = self._case_revision(case)
        decision = DecisionRecord(
            id=new_id(), aggregate_type="need_case", aggregate_id=case.id, decision_type="handoff",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"],
            target_refs={"artifact_ids": artifact_ids, "source_revision_id": case_revision.id},
            before_digest=case_revision.digest, after_digest=revision.digest, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self._event(
            action="case.handed_off", aggregate_type="need_case", aggregate_id=case.id, aggregate_version=case.version,
            before_digest=case_revision.digest, after_digest=revision.digest,
            refs={"decision_id": decision.id, "artifact_ids": artifact_ids, "from": old_status}, event_type="need_case.handed_off",
        )
        response = {"case_id": case.id, "case_version": case.version, "artifact_ids": artifact_ids, "decision_id": decision.id}
        return self._finish(operation="case.handoff", key=key, request_hash=request_hash, response=response, resource_ref=f"need_case:{case.id}")

    def create_artifact(self, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("artifact.create", key, body)
        if cached:
            return cached
        if body.get("case_id"):
            case = self._case(body["case_id"])
            snapshot = None
        else:
            if not self.settings.ALLOW_REAL_DATA:
                raise DomainError("real_data_not_allowed", "Authorized DMB snapshots запрещены до утверждения real-data policy.", 403)
            snapshot = self.adapter.snapshot(body["external_object_type"], body["external_object_id"], self.actor.raw_envelope)
            case_id = new_id()
            case = NeedCase(
                id=case_id, case_number=f"NC-{utcnow().year}-{case_id.split('-')[0].upper()}", title=body["title"],
                status=NeedCaseStatus.CAPTURED, data_classification="approved_real", version=0,
                passport_json={"related_external_objects": [{"type": snapshot["object_type"], "id": snapshot["object_id"]}]},
                created_by=self.actor.user_id, created_at=utcnow(), updated_at=utcnow(),
            )
            self.db.add(case)
            self.db.flush()
            self.db.add(CaseParticipant(
                id=new_id(), case_id=case.id, subject_type="dmb_user", subject_id=self.actor.user_id,
                subject_snapshot={"team_id": self.actor.team_id}, role="operator", active=True, created_at=utcnow(),
            ))
            self.db.flush()
            source_content = canonical_json(snapshot["projection"]).decode("utf-8")
            source = SourceArtifact(
                id=new_id(), case_id=case.id, kind="dmb_snapshot", origin_type="authorized_snapshot", channel="dmb_adapter",
                mime_type="application/json", content=str(source_content), digest=snapshot["digest"], digest_algorithm=DIGEST_ALGORITHM,
                captured_at=datetime.fromisoformat(snapshot["captured_at"].replace("Z", "+00:00")),
                created_by=self.actor.user_id, created_at=utcnow(),
            )
            self.db.add(source)
            self.db.flush()
            self.db.add(SourceFragment(
                id=new_id(), source_id=source.id, locator_type="json_pointer",
                start_offset=None, end_offset=None, selector="/", text_digest=snapshot["digest"],
                excerpt=source_content[:1000],
            ))
            self.db.flush()
            self._case_revision(case)
        artifact = self._new_artifact(case, body["title"], body.get("content") or {})
        if snapshot:
            link = ExternalObjectLink(
                id=new_id(), case_id=case.id, artifact_id=artifact.id, system="dmb", object_type=snapshot["object_type"],
                external_id=str(snapshot["object_id"]), snapshot_version=int(snapshot["version"]), snapshot_digest=snapshot["digest"],
                display_snapshot=snapshot["projection"], access_checked_at=utcnow(), active=True,
            )
            self.db.add(link)
        revision = self.db.get(ArtifactRevision, artifact.current_revision_id)
        self._event(
            action="artifact.created", aggregate_type="artifact", aggregate_id=artifact.id, aggregate_version=0,
            before_digest=None, after_digest=revision.digest, refs={"case_id": case.id, "external": bool(snapshot)},
        )
        response = self.artifact_projection(artifact)
        return self._finish(operation="artifact.create", key=key, request_hash=request_hash, response=response, resource_ref=f"artifact:{artifact.id}")

    def create_revision(self, artifact_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("artifact.revision.create", key, body)
        if cached:
            return cached
        artifact = self._artifact(artifact_id)
        self._expect_version(artifact, body["expected_version"], "artifact")
        if artifact.status in {ArtifactStatus.IN_REVIEW, ArtifactStatus.APPROVED_BASELINE, ArtifactStatus.SUPERSEDED}:
            raise DomainError("immutable_artifact_state", "Review candidate/approved baseline нельзя изменять in place.", 409)
        if body["base_revision_id"] != artifact.current_revision_id:
            current = self.db.get(ArtifactRevision, artifact.current_revision_id)
            raise DomainError("version_conflict", "Base revision устарела.", 409, {"current_revision_id": artifact.current_revision_id, "current_digest": current.digest})
        current = self.db.get(ArtifactRevision, artifact.current_revision_id)
        content = body["content"]
        digest = digest_json(content)
        if digest == current.digest:
            raise DomainError("revision_unchanged", "Новая ревизия не содержит изменений.", 422)
        revision = ArtifactRevision(
            id=new_id(), artifact_id=artifact.id, revision_no=current.revision_no + 1,
            base_revision_id=current.id, schema_version="business-requirement/1.0", content_json=content,
            digest=digest, digest_algorithm=DIGEST_ALGORITHM, created_by=self.actor.user_id, created_at=utcnow(),
        )
        self.db.add(revision)
        self.db.flush()
        for link in body.get("claim_links") or []:
            claim = self.db.get(Claim, link.get("claim_id"))
            if claim is None or claim.case_id != artifact.case_id:
                raise DomainError("claim_not_found", "Traceability claim недоступен.", 422)
            self.db.add(RevisionClaim(
                id=new_id(), revision_id=revision.id, claim_id=claim.id,
                usage_path=link.get("usage_path") or "/", usage_type=link.get("usage_type") or "supports",
            ))
        artifact.current_revision_id = revision.id
        artifact.version += 1
        artifact.status = ArtifactStatus.DRAFTING
        artifact.updated_at = utcnow()
        self._event(
            action="artifact.revision_created", aggregate_type="artifact", aggregate_id=artifact.id,
            aggregate_version=artifact.version, before_digest=current.digest, after_digest=revision.digest,
            refs={"revision_id": revision.id, "base_revision_id": current.id},
        )
        response = self.artifact_projection(artifact)
        return self._finish(operation="artifact.revision.create", key=key, request_hash=request_hash, response=response, resource_ref=f"revision:{revision.id}")

    def validate_artifact(self, artifact_id: str, revision_id: str) -> dict:
        artifact = self._artifact(artifact_id)
        revision = self.db.get(ArtifactRevision, revision_id)
        if revision is None or revision.artifact_id != artifact.id:
            raise DomainError("revision_not_found", "Ревизия недоступна.", 404)
        findings = self._artifact_findings(revision)
        return {
            "artifact_id": artifact.id, "revision_id": revision.id, "revision_digest": revision.digest,
            "ready": not findings, "findings": [item.as_dict() for item in findings],
        }

    def create_review_candidate(self, artifact_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("review_candidate.create", key, body)
        if cached:
            return cached
        artifact = self._artifact(artifact_id)
        self._expect_version(artifact, body["expected_version"], "artifact")
        if body["revision_id"] != artifact.current_revision_id:
            raise DomainError("version_conflict", "Review candidate должен использовать текущую ревизию.", 409)
        validation = self.validate_artifact(artifact.id, body["revision_id"])
        if not validation["ready"]:
            raise DomainError("readiness_failed", "Артефакт не прошёл readiness gate.", 422, validation)
        before = self.db.get(ArtifactRevision, artifact.current_revision_id)
        gate = ReviewGate(
            id=new_id(), artifact_revision_id=before.id, status="in_review", reviewer_snapshot=None,
            findings_digest=digest_json(validation["findings"]), version=0, active=True, submitted_at=utcnow(),
        )
        self.db.add(gate)
        artifact.status = ArtifactStatus.IN_REVIEW
        artifact.version += 1
        artifact.updated_at = utcnow()
        decision = DecisionRecord(
            id=new_id(), aggregate_type="artifact", aggregate_id=artifact.id, decision_type="review_submitted",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"], target_refs={"review_gate_id": gate.id, "revision_id": before.id},
            before_digest=before.digest, after_digest=before.digest, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self._event(
            action="artifact.review_submitted", aggregate_type="artifact", aggregate_id=artifact.id,
            aggregate_version=artifact.version, before_digest=before.digest, after_digest=before.digest,
            refs={"review_gate_id": gate.id, "revision_id": before.id, "decision_id": decision.id},
        )
        response = {"review_gate_id": gate.id, "status": gate.status, "artifact": self.artifact_projection(artifact)}
        return self._finish(operation="review_candidate.create", key=key, request_hash=request_hash, response=response, resource_ref=f"review_gate:{gate.id}")

    def decide_review(self, gate_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("review_gate.decision", key, body)
        if cached:
            return cached
        gate = self.db.get(ReviewGate, gate_id)
        if gate is None or not gate.active:
            raise DomainError("review_gate_not_found", "Review gate недоступен.", 404)
        revision = self.db.get(ArtifactRevision, gate.artifact_revision_id)
        artifact = self._artifact(revision.artifact_id)
        self._expect_version(gate, body["expected_version"], "review_gate")
        if artifact.status != ArtifactStatus.IN_REVIEW:
            raise DomainError("transition_not_allowed", "Артефакт не находится на review.", 422)
        gate.version += 1
        gate.active = False
        gate.decided_at = utcnow()
        gate.reviewer_snapshot = self.actor.audit_snapshot()
        if body["decision"] == "approve":
            gate.status = "approved"
            artifact.status = ArtifactStatus.APPROVED_BASELINE
            artifact.approved_revision_id = revision.id
            result_revision = revision
        else:
            gate.status = "returned"
            artifact.status = ArtifactStatus.DRAFTING
            duplicate_content = dict(revision.content_json)
            duplicate_content["review_return"] = {
                "from_revision_id": revision.id,
                "rationale": body["rationale"],
                "returned_at": _iso(utcnow()),
            }
            result_revision = ArtifactRevision(
                id=new_id(), artifact_id=artifact.id, revision_no=revision.revision_no + 1,
                base_revision_id=revision.id, schema_version=revision.schema_version, content_json=duplicate_content,
                digest=digest_json(duplicate_content),
                digest_algorithm=DIGEST_ALGORITHM, created_by=self.actor.user_id, created_at=utcnow(),
            )
            self.db.add(result_revision)
            self.db.flush()
            for link in self.db.query(RevisionClaim).filter_by(revision_id=revision.id).all():
                self.db.add(RevisionClaim(
                    id=new_id(), revision_id=result_revision.id, claim_id=link.claim_id,
                    usage_path=link.usage_path, usage_type=link.usage_type,
                ))
            artifact.current_revision_id = result_revision.id
        artifact.version += 1
        artifact.updated_at = utcnow()
        decision = DecisionRecord(
            id=new_id(), aggregate_type="review_gate", aggregate_id=gate.id, decision_type=f"review_{body['decision']}",
            actor_json=self.actor.audit_snapshot(), rationale=body["rationale"],
            target_refs={"artifact_id": artifact.id, "revision_id": revision.id, "result_revision_id": result_revision.id},
            before_digest=revision.digest, after_digest=result_revision.digest, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self._event(
            action="review.decided", aggregate_type="artifact", aggregate_id=artifact.id,
            aggregate_version=artifact.version, before_digest=revision.digest, after_digest=result_revision.digest,
            refs={"review_gate_id": gate.id, "decision_id": decision.id, "decision": body["decision"]},
        )
        response = {"review_gate_id": gate.id, "review_status": gate.status, "artifact": self.artifact_projection(artifact)}
        return self._finish(operation="review_gate.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"review_gate:{gate.id}")

    # ----- ProposedDiff -----

    def create_diff(self, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("diff.create", key, body)
        if cached:
            return cached
        if not self.settings.ALLOW_REAL_DATA:
            raise DomainError("real_data_not_allowed", "ProposedDiff для DMB запрещён до утверждения real-data policy.", 403)
        revision = self.db.get(ArtifactRevision, body["source_revision_id"])
        if revision is None:
            raise DomainError("revision_not_found", "Source revision недоступна.", 404)
        artifact = self._artifact(revision.artifact_id)
        if revision.digest != body["source_revision_digest"]:
            raise DomainError("version_conflict", "Source revision digest не совпадает.", 409, {"current_digest": revision.digest})
        expires_at = body.get("expires_at")
        if expires_at is not None:
            comparable_expiry = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            if comparable_expiry <= utcnow():
                raise DomainError("diff_expired", "Нельзя создать ProposedDiff с истёкшим сроком.", 422)
        operations = body["operations"]
        errors = validate_operations(operations)
        if errors:
            raise DomainError("diff_validation_failed", "ProposedDiff содержит недопустимые операции.", 422, {"errors": [item.__dict__ for item in errors]})
        claim_refs = {str(ref) for operation in operations for ref in (operation.get("claim_refs") or [])}
        evidence_refs = {str(ref) for operation in operations for ref in (operation.get("evidence_refs") or [])}
        available_claims = {
            row[0] for row in self.db.query(Claim.id).filter(
                Claim.id.in_(claim_refs), Claim.case_id == artifact.case_id, Claim.status == "accepted",
            ).all()
        } if claim_refs else set()
        available_evidence = {
            row[0] for row in self.db.query(SourceFragment.id).join(SourceArtifact).filter(
                SourceFragment.id.in_(evidence_refs), SourceArtifact.case_id == artifact.case_id,
            ).all()
        } if evidence_refs else set()
        if available_claims != claim_refs or available_evidence != evidence_refs:
            raise DomainError(
                "lineage_not_found",
                "Claim/evidence lineage недоступен в source case или claim не подтверждён.",
                422,
            )
        validation = self.adapter.validate_diff({
            "target_type": body["target_type"], "target_id": body["target_id"],
            "base_version": body["base_version"], "base_digest": body["base_digest"],
            "operations": operations,
        }, self.actor.raw_envelope)
        if not validation.get("valid"):
            raise DomainError("version_conflict", "DMB target изменился или недоступен.", 409, validation)
        diff = ProposedDiff(
            id=new_id(), target_system="dmb", target_type=body["target_type"], target_id=str(body["target_id"]),
            source_revision_id=revision.id, source_revision_digest=revision.digest,
            base_version=body["base_version"], base_digest=body["base_digest"], status=DiffStatus.PROPOSED,
            version=0, created_by=self.actor.user_id, created_at=utcnow(), expires_at=body.get("expires_at"),
        )
        self.db.add(diff)
        self.db.flush()
        for item in operations:
            self.db.add(DiffOperation(
                id=new_id(), diff_id=diff.id, ordinal=item["ordinal"], op=item["op"], path=item["path"],
                old_value_hash=item.get("old_value_hash"), proposed_value=item.get("proposed_value"),
                claim_refs=item.get("claim_refs") or [], evidence_refs=item.get("evidence_refs") or [],
                rationale=item["rationale"], risk=item.get("risk") or "unknown", decision_status="pending",
            ))
        self.db.flush()
        self._event(
            action="diff.created", aggregate_type="proposed_diff", aggregate_id=diff.id, aggregate_version=0,
            before_digest=body["base_digest"], after_digest=digest_json(self.diff_projection(diff)),
            refs={"artifact_id": artifact.id, "revision_id": revision.id, "target_type": diff.target_type, "target_id": diff.target_id},
        )
        response = self.diff_projection(diff)
        return self._finish(operation="diff.create", key=key, request_hash=request_hash, response=response, resource_ref=f"proposed_diff:{diff.id}")

    def _diff(self, diff_id: str) -> ProposedDiff:
        diff = self.db.get(ProposedDiff, diff_id)
        if diff is None:
            raise DomainError("diff_not_found", "ProposedDiff недоступен.", 404)
        revision = self.db.get(ArtifactRevision, diff.source_revision_id)
        self._artifact(revision.artifact_id)
        return diff

    def _require_diff_not_expired(self, diff: ProposedDiff) -> None:
        expires_at = diff.expires_at
        if expires_at is None:
            return
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > utcnow():
            return
        if diff.status != DiffStatus.CANCELLED:
            diff.status = DiffStatus.CANCELLED
            diff.version += 1
            self._event(
                action="diff.expired", aggregate_type="proposed_diff", aggregate_id=diff.id,
                aggregate_version=diff.version, before_digest=diff.base_digest, after_digest=diff.base_digest,
                refs={"expires_at": _iso(expires_at)},
            )
            self.db.commit()
        raise DomainError("diff_expired", "Срок действия ProposedDiff истёк.", 409)

    def decide_diff_operation(self, diff_id: str, operation_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("diff.operation.decision", key, body)
        if cached:
            return cached
        diff = self._diff(diff_id)
        self._require_diff_not_expired(diff)
        self._expect_version(diff, body["expected_version"], "proposed_diff")
        if diff.status in {DiffStatus.STALE, DiffStatus.CANCELLED, DiffStatus.APPLIED}:
            raise DomainError("diff_state_invalid", "Решение невозможно в текущем состоянии diff.", 409)
        operation = self.db.get(DiffOperation, operation_id)
        if operation is None or operation.diff_id != diff.id:
            raise DomainError("diff_operation_not_found", "Операция diff недоступна.", 404)
        if operation.decision_status != "pending":
            raise DomainError("operation_already_decided", "По операции уже принято решение.", 409)
        if body["decision"] == "accept" and not (operation.claim_refs or operation.evidence_refs):
            raise DomainError("lineage_required", "Операцию без lineage нельзя принять.", 422)
        operation.decision_status = "accepted" if body["decision"] == "accept" else "rejected"
        decision = DecisionRecord(
            id=new_id(), aggregate_type="diff_operation", aggregate_id=operation.id,
            decision_type=f"diff_operation_{body['decision']}", actor_json=self.actor.audit_snapshot(),
            rationale=body["rationale"], target_refs={"diff_id": diff.id, "ordinal": operation.ordinal},
            before_digest=diff.base_digest, after_digest=None, idempotency_key=key, created_at=utcnow(),
        )
        self.db.add(decision)
        self.db.flush()
        operation.decision_record_id = decision.id
        decisions = [row[0] for row in self.db.query(DiffOperation.decision_status).filter_by(diff_id=diff.id).all()]
        diff.status = aggregate_diff_status(decisions)
        diff.version += 1
        after = digest_json(self.diff_projection(diff))
        decision.after_digest = after
        self._event(
            action="diff.operation_decided", aggregate_type="proposed_diff", aggregate_id=diff.id,
            aggregate_version=diff.version, before_digest=diff.base_digest, after_digest=after,
            refs={"operation_id": operation.id, "decision_id": decision.id, "decision": body["decision"]},
        )
        response = self.diff_projection(diff)
        return self._finish(operation="diff.operation.decision", key=key, request_hash=request_hash, response=response, resource_ref=f"proposed_diff:{diff.id}")

    def rebase_diff(self, diff_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("diff.rebase", key, body)
        if cached:
            return cached
        if not self.settings.ALLOW_REAL_DATA:
            raise DomainError("real_data_not_allowed", "Rebase DMB diff запрещён до утверждения real-data policy.", 403)
        old = self._diff(diff_id)
        self._require_diff_not_expired(old)
        snapshot = self.adapter.snapshot(old.target_type, old.target_id, self.actor.raw_envelope)
        self._expect_version(old, body["expected_version"], "proposed_diff")
        if snapshot["version"] == old.base_version and snapshot["digest"] == old.base_digest:
            raise DomainError("rebase_not_required", "DMB target не изменился; rebase не требуется.", 422)
        operations = self.db.query(DiffOperation).filter_by(diff_id=old.id).order_by(DiffOperation.ordinal).all()
        new = ProposedDiff(
            id=new_id(), target_system=old.target_system, target_type=old.target_type, target_id=old.target_id,
            source_revision_id=old.source_revision_id, source_revision_digest=old.source_revision_digest,
            base_version=int(snapshot["version"]), base_digest=snapshot["digest"], status=DiffStatus.PROPOSED,
            version=0, created_by=self.actor.user_id, created_at=utcnow(), expires_at=old.expires_at, rebased_from_id=old.id,
        )
        self.db.add(new)
        for item in operations:
            self.db.add(DiffOperation(
                id=new_id(), diff_id=new.id, ordinal=item.ordinal, op=item.op, path=item.path,
                old_value_hash=digest_json((snapshot.get("projection") or {}).get(item.path.lstrip("/"))),
                proposed_value=item.proposed_value, claim_refs=item.claim_refs, evidence_refs=item.evidence_refs,
                rationale=item.rationale, risk=item.risk, decision_status="pending",
            ))
        old.status = DiffStatus.STALE
        old.version += 1
        self.db.flush()
        self._event(
            action="diff.rebased", aggregate_type="proposed_diff", aggregate_id=new.id, aggregate_version=0,
            before_digest=old.base_digest, after_digest=new.base_digest, refs={"rebased_from_id": old.id},
        )
        response = self.diff_projection(new)
        return self._finish(operation="diff.rebase", key=key, request_hash=request_hash, response=response, resource_ref=f"proposed_diff:{new.id}")

    def create_apply_intent(self, diff_id: str, body: dict[str, Any], key: str) -> dict:
        cached, request_hash = self._idempotent("diff.apply_intent", key, body)
        if cached:
            return cached
        if not self.settings.ALLOW_REAL_DATA:
            raise DomainError("real_data_not_allowed", "Apply intent для DMB запрещён до утверждения real-data policy.", 403)
        diff = self._diff(diff_id)
        self._require_diff_not_expired(diff)
        self._expect_version(diff, body["expected_version"], "proposed_diff")
        if diff.status != DiffStatus.ACCEPTED:
            raise DomainError("diff_not_accepted", "Apply intent доступен только для полностью принятого diff.", 422)
        source_revision = self.db.get(ArtifactRevision, diff.source_revision_id)
        source_artifact = self._artifact(source_revision.artifact_id)
        if source_artifact.approved_revision_id != source_revision.id:
            raise DomainError("approved_baseline_required", "Apply intent требует утверждённый source baseline.", 422)
        operations = self.db.query(DiffOperation).filter_by(diff_id=diff.id, decision_status="accepted").order_by(DiffOperation.ordinal).all()
        result = self.adapter.prepare_apply_intent({
            "target_type": diff.target_type, "target_id": diff.target_id,
            "base_version": diff.base_version, "base_digest": diff.base_digest,
            "diff_id": diff.id,
            "operations": [{"op": row.op, "path": row.path, "proposed_value": row.proposed_value} for row in operations],
        }, self.actor.raw_envelope)
        if not result.get("valid", False):
            diff.status = DiffStatus.STALE
            diff.version += 1
            self._event(
                action="diff.marked_stale", aggregate_type="proposed_diff", aggregate_id=diff.id,
                aggregate_version=diff.version, before_digest=diff.base_digest,
                after_digest=result.get("current_digest"), refs={"reason": "target_changed"},
            )
            self.db.commit()
            raise DomainError("version_conflict", "DMB target изменился; требуется явный rebase.", 409, result)
        response = {
            "diff_id": diff.id,
            "status": "prepared",
            "applied": False,
            "form_url": result["form_url"],
            "prefill": result["prefill"],
            "target_version": result["version"],
            "target_digest": result["digest"],
        }
        self._event(
            action="diff.apply_intent_prepared", aggregate_type="proposed_diff", aggregate_id=diff.id,
            aggregate_version=diff.version, before_digest=diff.base_digest, after_digest=diff.base_digest,
            refs={"target_type": diff.target_type, "target_id": diff.target_id},
        )
        return self._finish(operation="diff.apply_intent", key=key, request_hash=request_hash, response=response, resource_ref=f"proposed_diff:{diff.id}")

    def get_run(self, run_id: str) -> dict:
        run = self.db.get(AgentRun, run_id)
        if run is None:
            raise DomainError("run_not_found", "Agent run недоступен.", 404)
        self._case(run.case_id)
        return dict(run.result_json)
