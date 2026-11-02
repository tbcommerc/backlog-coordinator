"""Document MVP tests use only agent-owned sessions and mocked LLM output.

No DMB tables, users, roles, teams or dictionaries are created by this module.
"""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from business_analyst_experimental.context import UserContext
from business_analyst_experimental.dialogue.state import DialogueState
from business_analyst_experimental.session import SessionStore, state_from_dict, state_to_dict
from business_analyst_experimental.v2 import document_workspace as workspace
from business_analyst_experimental.v2.fingerprint import canonical_fingerprint
from business_analyst_experimental.v2.orchestrator import V2Orchestrator


@pytest.fixture
def session():
    store = SessionStore(database_url="sqlite:///:memory:")
    state = store.new_session(17)
    state.product_mode = "requirement_copilot"
    state.operator_role = "BA"
    state.artifact_type = "business_requirement_v2"
    store.save(state)
    orchestrator = V2Orchestrator(store)
    response = orchestrator.import_requirement_document(state.session_id,
        "# Заявки\n## Проблема\nРучная сверка занимает два часа.\n"
        "## Бизнес-цель\nСократить время сверки до десяти минут.\n"
        "## В объёме\nСверка входящих заявок\n## Критерии приёмки\n"
        "95% заявок сверяются не более чем за десять минут.\n"
        "## Заметки автора\nВажный неизвестный раздел и его содержание.", 17)
    assert response.action == "document_imported"
    return store, orchestrator, state.session_id


def fake_model(monkeypatch, answer):
    class Provider:
        name = "test"
        model = "fixture-model"
        def available(self):
            return True
        def chat_json(self, messages, **kwargs):
            assert "недоверенные" in kwargs["system_prompt"]
            context = json.loads(messages[0]['content'])
            if 'ПОЛНОТУ И ТОЧНОСТЬ ПЕРЕНОСА' in kwargs['system_prompt']:
                from business_analyst_experimental.v2.document_generation import field_text
                document = context['candidate_document']
                coverage = []
                for fact in context['source_facts']:
                    field = fact['field']
                    quote = fact['quote']
                    found = field in workspace.EDITABLE_FIELDS and quote in field_text(document, field)
                    coverage.append({'fact_id': fact['id'], 'status': 'covered' if found else 'not_applicable',
                                     'field': field, 'quote': quote if found else '', 'reason': 'Служебная заметка фикстуры'})
                return {'coverage': coverage, 'questions': [
                    {'index': i, 'decision': 'keep', 'priority': 'behavior', 'reason': 'Нет ответа'}
                    for i, _ in enumerate(document.get('open_questions', []))], 'unsupported': []}
            return deepcopy(answer)
    monkeypatch.setattr(workspace, "get_llm", Provider)


def perform(session, action, **kwargs):
    store, orchestrator, session_id = session
    state = store.get(session_id)
    request = {"action": action, "expected_draft_hash": (state.draft or {}).get("fingerprint", ""), **kwargs}
    return orchestrator.document_action(session_id, 17, request)


def test_autosave_batch_preserves_other_fields_and_rejects_stale_write(session):
    store, _, session_id = session
    before = deepcopy(store.get(session_id).draft)
    result = perform(session, "save_sections", sections={"business_goal": "Новая цель", "scope_out": "Архив\nИстория"})
    assert result.draft["business_goal"] == "Новая цель"
    assert result.draft["scope_out"] == ["Архив", "История"]
    assert result.draft["problem_statement"] == before["problem_statement"]
    assert result.draft["business_requirements"] == before["business_requirements"]
    assert result.draft["revision"] == before["revision"] + 1
    conflict = perform(session, "save_sections", expected_draft_hash=before["fingerprint"], sections={"business_goal": "Потерянная правка"})
    assert conflict.action == "revision_conflict"
    assert store.get(session_id).draft == result.draft


def test_autosave_invalid_batch_is_atomic_and_empty_sections_are_allowed(session):
    store, _, session_id = session
    before = deepcopy(store.get(session_id).draft)
    result = perform(session, "save_sections", sections={"business_goal": "Новая цель", "created_by": "Другой автор"})
    assert result.action == "validation_error"
    assert store.get(session_id).draft == before
    result = perform(session, "save_sections", sections={"business_goal": "", "scope_in": ""})
    assert result.draft["business_goal"] == ""
    assert result.draft["scope_in"] == []
    assert not store.get(session_id).get("business_goal")


def test_initial_generation_is_unconfirmed_and_cannot_overwrite_existing(session, monkeypatch):
    store, _, session_id = session
    state = store.get(session_id)
    state.draft = None
    store.save(state)
    fake_model(monkeypatch, {"operations": [{"field": "business_goal", "after": "Сократить ожидание"}]})
    result = perform(session, "create_draft")
    assert result.action == "draft_ready"
    # An existing explicit source takes precedence over the incomplete model reply.
    assert result.draft["business_goal"] == "Сократить время сверки до десяти минут."
    assert result.draft["field_provenance"]["business_goal"]["confirmed"] is False
    assert store.get(session_id).artifact_revision_history[-1]["author_kind"] == "agent_proposal"
    assert store.get(session_id).final_summary_confirmed is False
    before = deepcopy(result.draft)
    result = perform(session, "create_draft")
    assert result.action == "validation_error"
    assert store.get(session_id).draft == before


def test_rejected_proposal_cannot_be_applied(session, monkeypatch):
    fake_model(monkeypatch, {"operations": [{"field": "business_goal", "after": "Другая цель"}]})
    result = perform(session, "propose_change")
    proposal = result.document_proposals[-1]
    before = deepcopy(result.draft)
    result = perform(session, "dismiss_proposal", proposal_id=proposal["id"])
    assert result.draft == before
    assert result.document_proposals[-1]["status"] == "rejected"
    result = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][0]["id"]])
    assert result.action == "validation_error"


def test_review_never_changes_document_and_is_versioned(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "business_goal", "quote": "до десяти минут",
        "message": "Не указан период измерения.", "risk": "Результат нельзя сопоставить.", "severity": "warning"}], "summary": "Нужен период измерения."})
    store, _, session_id = session
    before = deepcopy(store.get(session_id).draft)
    history = deepcopy(store.get(session_id).artifact_revision_history)
    result = perform(session, "review")
    after = store.get(session_id)
    assert after.draft == before
    assert after.artifact_revision_history == history
    assert result.document_review["status"] == "completed"
    assert result.document_review["model"] == "fixture-model"
    assert result.document_review["source_fingerprint"] == canonical_fingerprint(after.document_sources)
    assert any(item["method"] == "llm" for item in result.document_findings)
    assert result.draft["fingerprint"] == canonical_fingerprint(result.draft)


def test_unavailable_and_bad_citations_are_degraded(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "business_goal", "quote": "Выдуманная цитата", "message": "Ошибка"}]})
    result = perform(session, "review")
    assert result.document_review["status"] == "degraded"
    assert all(item["method"] in {"deterministic", "transfer"} for item in result.document_findings)
    monkeypatch.setattr(workspace, "get_llm", lambda: SimpleNamespace(name="mock"))
    result = perform(session, "review")
    assert result.document_review["status"] == "degraded"


def test_sources_preserve_unmapped_original_versions_and_invalidate_review(session, monkeypatch):
    fake_model(monkeypatch, {"findings": []})
    result = perform(session, "review")
    source = result.document_sources[0]
    assert "Важный неизвестный раздел" in source["content"]
    assert any(section["title"] == "Заметки автора" for section in source["sections"])
    before = result.draft["fingerprint"]
    result = perform(session, "add_source", source={"id": source["id"], "title": "Новая версия", "content": "Обновлённый материал"})
    assert [item["version"] for item in result.document_sources] == [1, 2]
    assert result.document_sources[0] == source
    assert result.document_review["stale"] is True
    assert result.draft["fingerprint"] == before


def test_proposal_requires_selection_and_preserves_unknown_fields(session, monkeypatch):
    store, _, session_id = session
    state = store.get(session_id)
    state.draft["future_extension"] = {"keep": "original"}
    state.draft["fingerprint"] = canonical_fingerprint(state.draft)
    store.save(state)
    before = deepcopy(state.draft)
    fake_model(monkeypatch, {"operations": [
        {"field": "business_goal", "after": "Сократить среднее время сверки до десяти минут за квартал."},
        {"field": "scope_out", "after": ["Архивные заявки"]},
    ]})
    proposed = perform(session, "propose_change")
    assert proposed.draft == before
    proposal = proposed.document_proposals[-1]
    accepted = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][0]["id"]])
    assert accepted.draft["scope_out"] == before["scope_out"]
    assert accepted.draft["future_extension"] == before["future_extension"]
    assert accepted.document_proposals[-1]["status"] == "partially_applied"
    assert accepted.draft["revision"] == before["revision"] + 1
    again = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][1]["id"]])
    assert again.document_proposals[-1]["status"] == "applied"
    assert again.draft["scope_out"] == ["Архивные заявки"]


def test_stale_proposal_cannot_overwrite_manual_edit(session, monkeypatch):
    fake_model(monkeypatch, {"operations": [{"field": "business_goal", "after": "Новое предложение"}]})
    proposed = perform(session, "propose_change")
    proposal = proposed.document_proposals[-1]
    store, orchestrator, session_id = session
    edited = orchestrator.edit_draft_section(session_id, "business_goal", "Ручная правка аналитика", 17)
    rejected = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][0]["id"]])
    assert rejected.action == "revision_conflict"
    assert rejected.draft == edited.draft
    assert rejected.document_proposals[-1]["status"] == "stale"


def test_draft_from_empty_can_be_accepted_in_parts_and_br_ids_remain_stable(monkeypatch):
    store = SessionStore(database_url="sqlite:///:memory:")
    state = store.new_session(17)
    state.product_mode, state.operator_role = "requirement_copilot", "BA"
    store.save(state)
    session = (store, V2Orchestrator(store), state.session_id)
    fake_model(monkeypatch, {"operations": [
        {"field": "title", "after": "Сверка заявок"},
        {"field": "problem_statement", "after": "Ручная сверка заявок"},
        {"field": "business_requirements", "after": [{"text": "Исключить повторный ввод данных"}]},
    ]})
    proposal = perform(session, "draft").document_proposals[-1]
    first = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[item["id"] for item in proposal["operations"][:2]])
    assert first.draft["title"] == "Сверка заявок"
    assert first.draft["created_by"]["user_id"] == 17
    assert all(item["status"] == "applied" for item in first.artifact_revision_history[-1]["applied_operations"])
    second = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][2]["id"]])
    key = second.draft["business_requirements"][0]["id"]
    assert key == proposal["operations"][2]["after"][0]["id"]
    revision = perform(session, "next_revision")
    assert revision.draft["business_requirements"][0]["id"] == key
    assert revision.artifact_id == first.artifact_id == second.artifact_id
    assert revision.draft["fingerprint"] == canonical_fingerprint(revision.draft)


def test_hash_conflict_and_unknown_model_fields_do_not_mutate(session, monkeypatch):
    before = session[0].get(session[2]).draft
    result = perform(session, "draft", expected_draft_hash="")
    assert result.action == "revision_conflict"
    fake_model(monkeypatch, {"operations": [{"field": "team_id", "after": "protected"}]})
    result = perform(session, "propose_change")
    assert result.action == "unavailable"
    assert result.draft == before
    assert not result.document_proposals


def test_finding_decision_requires_reason_and_survives_repeat_review(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "business_goal", "message": "Нет периода", "severity": "critical"}]})
    result = perform(session, "review")
    finding = next(item for item in result.document_findings if item["method"] == "llm")
    rejected = perform(session, "resolve_finding", finding_id=finding["id"], decision="rejected")
    assert rejected.action == "validation_error"
    decided = perform(session, "resolve_finding", finding_id=finding["id"], decision="rejected", reason="Период зафиксирован в договорённости.")
    repeated = perform(session, "review")
    matches = [item for item in repeated.document_findings if item["id"] == finding["id"]]
    assert len(matches) == 1
    assert matches[0]["status"] == "rejected"
    assert matches[0]["reason"]
    assert decided.draft == result.draft


def test_free_chat_review_routes_without_edit_and_checks_owner(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [], "summary": "Содержательная проверка завершена"})
    store, orchestrator, session_id = session
    before = deepcopy(store.get(session_id).draft)
    reply = orchestrator.handle_message(session_id, "Проверь бизнес-требования", UserContext(user_id=17), "review-message")
    assert reply.action == "document_reviewed"
    assert reply.draft == before
    denied = orchestrator.handle_message(session_id, "Проверь", UserContext(user_id=18))
    assert denied.action == "error"


def test_legacy_session_and_document_envelope_roundtrip(session):
    store, _, session_id = session
    state = store.get(session_id)
    restored = state_from_dict(state_to_dict(state))
    assert restored.document_sources == state.document_sources
    assert restored.artifact_id == state.artifact_id
    old = state_from_dict({"session_id": "legacy", "user_id": 17})
    assert old.document_sources == []
    summaries = store.list_for_user(17)
    assert summaries[0]["artifact_id"] == state.artifact_id
    assert summaries[0]["draft_fingerprint"] == state.draft["fingerprint"]


def test_next_revision_unlocks_legacy_sent_artifact(session):
    store, _, session_id = session
    state = store.get(session_id)
    state.review_status, state.review_task_id = "needs_review", 123
    store.save(state)
    result = perform(session, "next_revision")
    assert result.action == "draft_ready"
    assert result.draft["revision"] == state.draft["revision"] + 1
    assert store.get(session_id).review_status == ""


def test_stale_source_prevents_apply_and_finding_decision(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "business_goal", "message": "Уточнить период"}]})
    review = perform(session, "review")
    finding = review.document_findings[-1]
    fake_model(monkeypatch, {"operations": [{"field": "business_goal", "after": "Предложенный результат"}]})
    proposed = perform(session, "propose_change")
    proposal = proposed.document_proposals[-1]
    perform(session, "add_source", source={"title": "Уточнение", "content": "Изменены исходные условия"})
    result = perform(session, "apply_proposal", proposal_id=proposal["id"], operation_ids=[proposal["operations"][0]["id"]])
    assert result.action == "revision_conflict"
    result = perform(session, "resolve_finding", finding_id=finding["id"], decision="resolved", reason="Закрыто")
    assert result.action == "revision_conflict"


def test_deterministic_conflict_retains_both_addressed_sides(session, monkeypatch):
    fake_model(monkeypatch, {"findings": []})
    store, orchestrator, session_id = session
    orchestrator.edit_draft_section(session_id, "current_process", "Оператор сверяет заявки вручную", 17)
    orchestrator.edit_draft_section(session_id, "target_process", "Оператор сверяет заявки вручную", 17)
    result = perform(session, "review")
    conflict = next(item for item in result.document_findings if item.get("code") == "as_is_equals_to_be")
    assert result.document_review["status"] == "completed"
    assert {item["field"] for item in conflict["related"]} == {"current_process", "target_process"}
    assert all(item["quote"] in result.draft[item["field"]] for item in conflict["related"])


def test_document_api_idempotency_payload_binding_and_ownership(session, monkeypatch):
    from fastapi import HTTPException
    from business_analyst_experimental.api import router
    from business_analyst_experimental.api.schemas import DocumentActionRequest
    from business_analyst_experimental.config import settings
    store, orchestrator, session_id = session
    monkeypatch.setattr(router, "_orchestrator", orchestrator)
    monkeypatch.setattr(settings, "ENABLED", True)
    monkeypatch.setattr(settings, "KILL_SWITCH", False)
    req = DocumentActionRequest(session_id=session_id, user_id=17, action="add_source", idempotency_key="one-source",
                                source={"title": "Материал", "content": "Исходные данные"})
    first = router.document_action(req)
    repeated = router.document_action(req)
    assert repeated["document_sources"] == first.document_sources
    assert len(store.get(session_id).document_sources) == 2
    changed = req.model_copy(update={"instruction": "changed-payload"})
    with pytest.raises(HTTPException) as conflict:
        router.document_action(changed)
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException) as denied:
        router.document_action(req.model_copy(update={"user_id": 18}))
    assert denied.value.status_code == 404
    with pytest.raises(HTTPException) as stale:
        router.document_action(DocumentActionRequest(session_id=session_id, user_id=17, action="review", expected_draft_hash="stale"))
    assert stale.value.status_code == 409
    fake_model(monkeypatch, {"operations": [{"field": "password", "after": "forbidden"}]})
    with pytest.raises(HTTPException) as unavailable:
        router.document_action(DocumentActionRequest(session_id=session_id, user_id=17, action="propose_change", expected_draft_hash=first.draft["fingerprint"]))
    assert unavailable.value.status_code == 503


def test_new_session_and_link_receipts_bind_authorized_target(session, monkeypatch):
    from fastapi import HTTPException
    from business_analyst_experimental.api import router
    from business_analyst_experimental.api.schemas import LinkObjectRequest, NewSessionRequest
    from business_analyst_experimental.config import settings
    from datetime import datetime, timezone
    store, orchestrator, session_id = session
    monkeypatch.setattr(router, "_orchestrator", orchestrator)
    monkeypatch.setattr(settings, "ENABLED", True)
    monkeypatch.setattr(settings, "KILL_SWITCH", False)
    req = NewSessionRequest(user_id=17, context={"user_id": 17, "operator_role": "BA"},
                            product_mode="requirement_copilot", idempotency_key="same-creation")
    first = router.new_session(req)
    assert router.new_session(req)["session_id"] == first.session_id
    with pytest.raises(HTTPException) as error:
        router.new_session(req.model_copy(update={"source_context": {"source_type": "operator", "channel": "oral", "source_summary": "other"}}))
    assert error.value.status_code == 409
    snapshot = {"object_type": "task", "object_id": "123", "object_version": "1", "fingerprint": "sha256:" + "a" * 64,
                "captured_at": datetime.now(timezone.utc).isoformat()}
    link = LinkObjectRequest(user_id=17, snapshot=snapshot, idempotency_key="same-link")
    first_link = router.link_object(session_id, link)
    assert router.link_object(session_id, link)["linked_object"] == first_link.linked_object
    with pytest.raises(HTTPException) as error:
        router.link_object(session_id, link.model_copy(update={"snapshot": {**snapshot, "object_id": "456"}}))
    assert error.value.status_code == 409
    assert store.get(session_id).linked_object_snapshot["object_id"] == "123"


@pytest.mark.parametrize("action", ["new_session", "link_object"])
def test_authorized_snapshot_transport_time_does_not_break_retry(session, monkeypatch, action):
    from fastapi import HTTPException
    from business_analyst_experimental.api import router
    from business_analyst_experimental.api.schemas import LinkObjectRequest, NewSessionRequest
    from business_analyst_experimental.config import settings
    store, orchestrator, session_id = session
    monkeypatch.setattr(router, "_orchestrator", orchestrator)
    monkeypatch.setattr(settings, "ENABLED", True)
    monkeypatch.setattr(settings, "KILL_SWITCH", False)
    snapshot = {"object_type": "task", "object_id": "123", "object_version": "1", "fingerprint": "sha256:" + "a" * 64,
                "fields": {"description": "Исходное описание", "captured_at": "business-field-value"},
                "captured_at": "2026-10-09T10:00:00+00:00"}
    if action == "new_session":
        req = NewSessionRequest(user_id=17, context={"user_id": 17, "operator_role": "BA"}, product_mode="requirement_copilot",
                                idempotency_key="semantic-retry", linked_object=snapshot)
        call = router.new_session
        key = "linked_object"
    else:
        req = LinkObjectRequest(user_id=17, snapshot=snapshot, idempotency_key="semantic-retry")
        call = lambda request: router.link_object(session_id, request)
        key = "snapshot"
    first = call(req)
    repeated = call(req.model_copy(update={key: {**snapshot, "captured_at": "2026-10-09T11:00:00+00:00"}}))
    assert repeated["session_id"] == first.session_id
    assert repeated["linked_object"] == first.linked_object
    assert repeated["linked_object"]["captured_at"] == "2026-10-09T10:00:00Z"
    for changed in (
        {"object_id": "456"}, {"object_version": "2"}, {"fingerprint": "sha256:" + "b" * 64},
        {"fields": {"description": "Другое описание", "captured_at": "business-field-value"}},
        {"fields": {**snapshot["fields"], "captured_at": "changed-business-field"}},
    ):
        with pytest.raises(HTTPException) as error:
            call(req.model_copy(update={key: {**snapshot, **changed}}))
        assert error.value.status_code == 409


def test_targeted_session_lookup_filters_before_limit_and_keeps_owner_scope(session, monkeypatch):
    from fastapi import HTTPException
    from business_analyst_experimental.api import router
    store, orchestrator, session_id = session
    old = store.get(session_id)
    old.linked_object_snapshot = {"object_type": "task", "object_id": "old-task"}
    store.save(old)
    with store.engine.begin() as conn:
        conn.execute(store._sessions.update().where(store._sessions.c.session_id == session_id).values(last_message_at="2020-01-01T00:00:00Z"))
    for _ in range(55):
        store.new_session(17)
    foreign = store.new_session(18)
    foreign.linked_object_snapshot = deepcopy(old.linked_object_snapshot)
    store.save(foreign)
    assert len(store.list_for_user(17)) == 50
    assert session_id not in {item["session_id"] for item in store.list_for_user(17)}
    matches = store.list_for_user(17, linked_object_type="task", linked_object_id="old-task")
    assert [item["session_id"] for item in matches] == [session_id]
    assert store.list_for_user(17, linked_object_type="request", linked_object_id="old-task") == []
    monkeypatch.setattr(router, "_orchestrator", orchestrator)
    assert router.sessions(17, "task", "old-task")["sessions"] == matches
    with pytest.raises(HTTPException) as incomplete:
        router.sessions(17, "task", "")
    assert incomplete.value.status_code == 422
    with pytest.raises(HTTPException):
        router.sessions(17, "unsupported", "old-task")


def test_review_can_cite_read_only_business_context_but_cannot_modify_it(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "problem_statement", "quote": "Ручная сверка",
        "message": "Нужно обосновать приоритет", "related": [{"field": "priority", "quote": "Средний"}]}]})
    store, _, sid = session
    state = store.get(sid)
    state.draft["priority"] = "Средний"
    state.draft["fingerprint"] = canonical_fingerprint(state.draft)
    store.save(state)
    before = deepcopy(store.get(sid).draft)
    result = perform(session, "review")
    assert result.document_review["status"] == "completed"
    assert store.get(sid).draft == before
    assert any(item["related"] == [{"field": "priority", "quote": "Средний"}] for item in result.document_findings)
    fake_model(monkeypatch, {"operations": [{"field": "priority", "after": "Высокий"}]})
    rejected = perform(session, "propose_change")
    assert rejected.action == "unavailable"
    assert store.get(sid).draft == before


def test_review_still_rejects_fabricated_read_only_citations(session, monkeypatch):
    fake_model(monkeypatch, {"findings": [{"field": "problem_statement", "quote": "Ручная сверка",
        "message": "Нужно обосновать приоритет", "related": [{"field": "priority", "quote": "Несуществующий"}]}]})
    result = perform(session, "review")
    assert result.document_review["status"] == "degraded"
    assert all(item["method"] == "deterministic" for item in result.document_findings)
