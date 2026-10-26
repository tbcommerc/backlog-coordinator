from datetime import datetime, timezone

import pytest

from app.api.errors import DomainError
from app.models import (
    Artifact,
    ArtifactRevision,
    AuditEvent,
    CaseParticipant,
    CaseRevision,
    DecisionRecord,
    NeedCase,
    OutboxEvent,
    SourceArtifact,
)


def _key(prefix: str, index: int) -> str:
    return f"{prefix}-{index:08d}"


def _ready_case(service):
    case = service.create_case({
        "title": "Сократить ручную подготовку реестра",
        "passport": {},
        "source_party": {"type": "external", "id": "customer-1", "name": "Заказчик"},
        "data_classification": "synthetic",
    }, _key("case", 1))
    source = service.add_source(case["id"], {
        "expected_version": case["version"],
        "kind": "text",
        "origin_type": "operator_retelling",
        "channel": "meeting",
        "content": "Нужно сократить ручную подготовку реестра и исключить внешнюю отправку.",
        "mime_type": "text/plain",
        "captured_at": datetime.now(timezone.utc),
        "supersedes_id": None,
    }, _key("source", 1))
    case_id = case["id"]
    version = source["case"]["version"]
    fragment_id = source["fragment_id"]
    for index, (path, statement) in enumerate((
        ("/requested_action", "Автоматизировать формирование реестра"),
        ("/expected_outcome", "Сократить ручные операции"),
        ("/business_problem", "Реестр собирается вручную"),
        ("/scope_in", "Формирование реестра"),
        ("/scope_out", "Внешняя отправка"),
    ), start=1):
        result = service.create_claim(case_id, {
            "expected_version": version,
            "statement": statement,
            "path": path,
            "claim_type": "source_statement",
            "confidence": None,
            "evidence_fragment_ids": [fragment_id],
            "status": "accepted",
        }, _key("claim", index))
        version = result["case_version"]
    current = service.case_projection(service._case(case_id))
    decision = service.record_case_decision(case_id, {
        "expected_version": version,
        "decision_type": "fidelity_confirmation",
        "rationale": "Паспорт соответствует источнику",
        "target_refs": {},
        "revision_digest": current["current_revision_digest"],
    }, _key("fidelity", 1))
    version = decision["case_version"]
    for index, target in enumerate(("captured", "clarifying", "ready_for_analysis"), start=1):
        transitioned = service.transition_case(case_id, {
            "expected_version": version,
            "target_status": target,
            "rationale": "Явное решение оператора",
            "disposition": {},
        }, _key("transition", index))
        version = transitioned["version"]
    return case_id, version


def _complete_requirement(title="Автоматическое формирование реестра"):
    return {
        "title": title,
        "purpose": "Снизить объём ручной подготовки",
        "target_outcome": "Файл формируется по запросу пользователя",
        "scope_in": ["Формирование файла"],
        "scope_out": ["Внешняя отправка"],
        "actors": ["Бэк-офицер"],
        "primary_scenarios": ["Пользователь формирует реестр"],
        "business_rules": ["Только разрешённые записи"],
        "assumptions": ["Период задан"],
        "acceptance_criteria": ["Файл содержит все разрешённые записи за выбранный период"],
        "traceability": ["need-case"],
        "unresolved_items": [],
    }


def test_s1_handoff_and_immutable_s2_review(service, db):
    case_id, version = _ready_case(service)
    handoff = service.handoff(case_id, {
        "expected_version": version,
        "rationale": "Кейс готов к глубокой проработке",
        "requirements": [{"title": "Автоматическое формирование реестра", "content": _complete_requirement()}],
    }, _key("handoff", 1))
    artifact_id = handoff["artifact_ids"][0]
    artifact = service.artifact_projection(service._artifact(artifact_id))
    assert artifact["readiness"]["ready"] is True

    candidate = service.create_review_candidate(artifact_id, {
        "expected_version": artifact["version"],
        "revision_id": artifact["current_revision_id"],
        "rationale": "Готово к ревью",
    }, _key("review", 1))
    decided = service.decide_review(candidate["review_gate_id"], {
        "expected_version": 0,
        "decision": "approve",
        "rationale": "Baseline проверен",
    }, _key("review-decision", 1))
    assert decided["artifact"]["status"] == "approved_baseline"
    assert decided["artifact"]["approved_revision_id"] == artifact["current_revision_id"]
    assert db.query(AuditEvent).count() == db.query(OutboxEvent).count()
    assert db.query(DecisionRecord).count() >= 5


def test_source_replacement_is_append_only(service, db):
    created = service.create_case({"title": "Synthetic", "passport": {}, "source_party": {}, "data_classification": "synthetic"}, _key("case", 2))
    first = service.add_source(created["id"], {
        "expected_version": 0, "kind": "note", "origin_type": "operator_retelling", "channel": "meeting",
        "content": "First", "mime_type": "text/plain", "captured_at": datetime.now(timezone.utc), "supersedes_id": None,
    }, _key("source", 2))
    second = service.add_source(created["id"], {
        "expected_version": first["case"]["version"], "kind": "note", "origin_type": "operator_retelling", "channel": "meeting",
        "content": "Corrected", "mime_type": "text/plain", "captured_at": datetime.now(timezone.utc), "supersedes_id": first["source_id"],
    }, _key("source", 3))
    rows = db.query(SourceArtifact).filter_by(case_id=created["id"]).order_by(SourceArtifact.created_at).all()
    assert [row.content for row in rows] == ["First", "Corrected"]
    assert rows[1].supersedes_id == rows[0].id
    assert second["case"]["version"] == 2


def test_idempotency_returns_original_response(service, db):
    body = {"title": "Idempotent", "passport": {}, "source_party": {}, "data_classification": "synthetic"}
    first = service.create_case(body, _key("case", 3))
    second = service.create_case(body, _key("case", 3))
    assert first == second
    assert db.query(NeedCase).count() == 1


def test_case_is_persisted_before_its_participants(service, db):
    created = service.create_case(
        {
            "title": "Проверка внешнего ключа",
            "passport": {},
            "source_party": {"type": "external", "id": "customer-fk", "name": "Заказчик"},
            "data_classification": "synthetic",
        },
        _key("case-fk", 1),
    )

    assert db.get(NeedCase, created["id"]) is not None
    assert db.query(CaseParticipant).filter_by(case_id=created["id"]).count() == 2


def test_real_data_stop_gate_blocks_case_and_dmb_snapshot(service, monkeypatch):
    monkeypatch.setattr(service.settings, "ALLOW_REAL_DATA", False)
    with pytest.raises(DomainError) as case_error:
        service.create_case({
            "title": "Real", "passport": {}, "source_party": {}, "data_classification": "approved_real",
        }, _key("case-real", 1))
    assert case_error.value.code == "real_data_not_allowed"

    with pytest.raises(DomainError) as snapshot_error:
        service.create_artifact({
            "case_id": None, "external_object_type": "task", "external_object_id": "248",
            "title": "External", "content": {},
        }, _key("artifact-real", 1))
    assert snapshot_error.value.code == "real_data_not_allowed"


def test_late_case_change_marks_handed_off_requirement_stale(service, db):
    case_id, version = _ready_case(service)
    handoff = service.handoff(case_id, {
        "expected_version": version,
        "rationale": "Передача после проверки",
        "requirements": [{"title": "BR", "content": _complete_requirement("BR")}],
    }, _key("handoff", 2))
    artifact_id = handoff["artifact_ids"][0]
    result = service.add_source(case_id, {
        "expected_version": handoff["case_version"], "kind": "note",
        "origin_type": "operator_retelling", "channel": "follow-up",
        "content": "Появилось содержательное уточнение после handoff.",
        "mime_type": "text/plain", "captured_at": datetime.now(timezone.utc), "supersedes_id": None,
    }, _key("source", 4))
    assert result["case"]["version"] == handoff["case_version"] + 1
    artifact = db.get(Artifact, artifact_id)
    assert artifact.potentially_stale is True
    assert db.query(OutboxEvent).filter_by(event_type="artifact.staleness_detected", aggregate_id=artifact_id).count() == 1


def test_case_revisions_are_content_addressed_and_sequential(service, db):
    case_id, _ = _ready_case(service)
    revisions = db.query(CaseRevision).filter_by(case_id=case_id).order_by(CaseRevision.revision_no).all()
    assert [row.revision_no for row in revisions] == list(range(1, len(revisions) + 1))
    assert len({row.digest for row in revisions}) == len(revisions)
    # Lifecycle-only transitions do not create duplicate content revisions.
    assert len(revisions) == 7


def test_manual_agent_turn_persists_input_before_unconfirmed_proposal(service, db):
    created = service.create_case({
        "title": "Manual-safe", "passport": {}, "source_party": {}, "data_classification": "synthetic",
    }, _key("case", 5))
    result = service.add_message(created["id"], {
        "message_id": "message-00000001",
        "body": "Нужно сформировать реестр по подтверждённым данным.",
        "expected_case_version": created["version"],
        "mode": "capture_assignment",
        "artifact_revision_id": None,
        "client_context": {"locale": "ru-RU"},
    }, _key("message", 1))
    assert result["degraded"] is True
    assert result["proposed_claims"][0]["confirmation_level"] == "unconfirmed"
    assert result["input"]["case_version"] + 1 == result["output"]["case_version"]
    assert result["input"]["case_revision_digest"] != result["output"]["case_revision_digest"]
    projection = service.case_projection(service._case(created["id"]))
    assert projection["claims"][0]["status"] == "proposed"
    assert db.query(AuditEvent).filter(AuditEvent.action.in_(["case.message_saved", "agent.proposal_created"])).count() == 2


def test_human_split_keeps_parent_lineage_without_copying_confirmation(service):
    case_id, version = _ready_case(service)
    result = service.split_case(case_id, {
        "expected_version": version,
        "rationale": "Два независимых результата",
        "children": [{"title": "Результат A", "passport": {}}, {"title": "Результат B", "passport": {}}],
    }, _key("split", 1))
    for child_id in result["child_case_ids"]:
        child = service.case_projection(service._case(child_id))
        lineage = child["passport"]["split_lineage"]
        assert lineage["parent_case_id"] == case_id
        assert lineage["source_ids"]
        assert lineage["claim_ids"]
        assert lineage["confirmation_copied"] is False
        assert child["claims"] == []


def test_manual_gap_and_conflict_decisions_are_versioned_and_audited(service, db):
    created = service.create_case({
        "title": "Gap and conflict", "passport": {}, "source_party": {}, "data_classification": "synthetic",
    }, _key("case", 6))
    source = service.add_source(created["id"], {
        "expected_version": created["version"], "kind": "text", "origin_type": "verbatim", "channel": "email",
        "content": "Первый вариант. Второй противоречащий вариант.", "mime_type": "text/plain",
        "captured_at": datetime.now(timezone.utc), "supersedes_id": None,
    }, _key("source", 5))
    version = source["case"]["version"]
    claim_ids = []
    for index, statement in enumerate(("Использовать первый вариант", "Использовать второй вариант"), start=10):
        result = service.create_claim(created["id"], {
            "expected_version": version, "statement": statement, "path": "/requested_action",
            "claim_type": "source_statement", "confidence": None,
            "evidence_fragment_ids": [source["fragment_id"]], "status": "proposed",
        }, _key("claim", index))
        version = result["case_version"]
        claim_ids.append(result["claim"]["id"])

    before_digest = service.case_projection(service._case(created["id"]))["current_revision_digest"]
    gap_result = service.create_gap(created["id"], {
        "expected_version": version, "rule_id": "MANUAL_UNKNOWN", "path": "/passport/unknowns",
        "severity": "blocking", "owner_snapshot": None, "next_step": None, "due_at": None,
    }, _key("gap", 1))
    version = gap_result["case_version"]
    assert gap_result["gap"]["version"] == 0
    assert gap_result["readiness"]["failed_rules"].count("S1_BLOCKING_GAP") == 1
    assert service.case_projection(service._case(created["id"]))["current_revision_digest"] != before_digest

    gap_decision = service.decide_gap(created["id"], gap_result["gap"]["id"], {
        "expected_version": 0, "expected_case_version": version, "decision": "resolve",
        "rationale": "Неизвестное уточнено", "owner_snapshot": None, "next_step": None, "due_at": None,
    }, _key("gap-decision", 1))
    version = gap_decision["case_version"]
    assert gap_decision["gap"]["status"] == "resolved"
    assert gap_decision["gap"]["version"] == 1

    conflict_result = service.create_conflict(created["id"], {
        "expected_version": version, "left_ref": f"claim:{claim_ids[0]}",
        "right_ref": f"claim:{claim_ids[1]}", "severity": "critical",
    }, _key("conflict", 1))
    version = conflict_result["case_version"]
    assert "S1_CRITICAL_CONFLICT" in conflict_result["readiness"]["failed_rules"]

    conflict_decision = service.decide_conflict(created["id"], conflict_result["conflict"]["id"], {
        "expected_version": 0, "expected_case_version": version, "decision": "resolve",
        "rationale": "Выбран первый вариант", "owner_snapshot": None,
    }, _key("conflict-decision", 1))
    assert conflict_decision["conflict"]["status"] == "resolved"
    assert conflict_decision["conflict"]["resolution_decision_id"] == conflict_decision["decision_id"]
    assert db.query(AuditEvent).count() == db.query(OutboxEvent).count()
    assert db.query(DecisionRecord).filter(DecisionRecord.aggregate_type.in_(["gap", "conflict"])).count() == 2
