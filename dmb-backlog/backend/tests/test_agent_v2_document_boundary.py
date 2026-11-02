"""Executable isolated boundary tests: no backend app, database or protected fixtures."""
from __future__ import annotations

import ast
import asyncio
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import sys
from unittest.mock import patch

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("document_contract", ROOT / "services/agent_v2_documents.py")
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def gateway_functions(**overrides):
    tree = ast.parse((ROOT / "routers/agent_v2_router.py").read_text(encoding="utf-8-sig"))
    names = {"_safe_session_id", "_operation_key", "_step_key", "_agent_error", "_session_context",
             "_agent_action", "submit_requirement_review", "resume_requirement_review", "open_object_workspace",
             "_workspace_content", "_complete_workspace_import", "send_for_review", "gateway"}
    functions = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            node.args.defaults = [ast.Constant(None) if isinstance(v, ast.Call) else v for v in node.args.defaults]
            # The two local service imports resolve to an in-memory dependency.
            node.body = [v for v in node.body if not isinstance(v, ast.ImportFrom)]
            functions.append(node)
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias("annotations")], level=0), *functions], type_ignores=[])
    import hashlib
    import re
    from urllib.parse import urlencode, parse_qsl
    from fastapi.responses import JSONResponse, Response
    scope = {"HTTPException": HTTPException, "hashlib": hashlib, "re": re, "urlencode": urlencode,
             "parse_qsl": parse_qsl, "json": json, "JSONResponse": JSONResponse, "Response": Response,
             "_deny_unless_pilot": lambda user: None, "publication_package": contract.publication_package,
             "render_source_document": contract.render_source_document, "trusted_context": lambda user: {"user_id": user.id}}
    scope.update(overrides)
    exec(compile(ast.fix_missing_locations(module), "agent_v2_router.py", "exec"), scope)
    return scope


def valid_state():
    draft = {"schema": "business-requirement-draft.v2", "artifact_id": "br-test", "revision": 1,
             "title": "Заявки", "problem_statement": "Заявки теряются при передаче между подразделениями",
             "business_goal": "Сохранять каждую принятую заявку", "scope_in": ["Все входящие заявки"],
             "acceptance_criteria": ["Каждая принятая заявка доступна по своему номеру"]}
    draft["fingerprint"] = contract.fingerprint(draft)
    sources = [{"id": "source-1", "version": 1, "content": "Сведения заказчика"}]
    return {"draft": draft, "document_sources": sources, "document_findings": [],
            "readiness": {"ready": False, "blocking_codes": ["final_summary_not_confirmed"]},
            "document_review": {"id": "review-1", "status": "completed", "base_fingerprint": draft["fingerprint"],
                                "source_fingerprint": contract.fingerprint(sources)}}


class Request:
    def __init__(self, body, key="operation-1"):
        self.payload = body
        self.headers = {"Idempotency-Key": key}
        self.method = "POST"
        self.state = SimpleNamespace()
        self.url = SimpleNamespace(query="")

    async def json(self):
        return self.payload

    async def body(self):
        return json.dumps(self.payload).encode("utf-8")


class Db:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class PublicationContractTests(unittest.TestCase):
    def test_document_policy_does_not_require_interview_confirmation(self):
        state = valid_state()
        before = deepcopy(state)
        report = contract.publication_package(state, state["draft"]["fingerprint"])
        self.assertEqual(state, before)
        report["sources"][0]["content"] = "mutated copy"
        self.assertEqual(state, before)

    def test_source_change_invalidates_review_even_when_document_is_unchanged(self):
        state = valid_state()
        state["document_sources"][0]["content"] = "Новое правило"
        with self.assertRaises(HTTPException) as ctx:
            contract.publication_package(state, state["draft"]["fingerprint"])
        self.assertEqual(ctx.exception.detail["code"], "document_review_stale")

    def test_tampered_content_and_stale_base_are_rejected(self):
        state = valid_state()
        state["draft"]["business_goal"] = "Подменённая цель"
        with self.assertRaises(HTTPException) as ctx:
            contract.publication_package(state, state["draft"]["fingerprint"])
        self.assertEqual(ctx.exception.detail["code"], "draft_revision_conflict")
        state = valid_state()
        state["document_review"]["base_fingerprint"] = "old"
        with self.assertRaises(HTTPException):
            contract.publication_package(state, state["draft"]["fingerprint"])

    def test_deferred_critical_is_still_blocking_and_rejection_requires_reason(self):
        state = valid_state()
        finding = {"id": "f1", "base_fingerprint": state["draft"]["fingerprint"], "severity": "critical",
                   "status": "deferred", "reason": "Позже"}
        state["document_findings"] = [finding]
        with self.assertRaises(HTTPException):
            contract.publication_package(state, state["draft"]["fingerprint"])
        finding.update(status="rejected", reason="")
        with self.assertRaises(HTTPException):
            contract.publication_package(state, state["draft"]["fingerprint"])
        finding["reason"] = "Правило относится к исключённому из объёма процессу"
        self.assertEqual(contract.publication_package(state, state["draft"]["fingerprint"])["findings"][0]["status"], "rejected")

    def test_degraded_review_requires_explicit_acknowledgment(self):
        state = valid_state()
        state["document_review"]["status"] = "degraded"
        with self.assertRaises(HTTPException) as ctx:
            contract.publication_package(state, state["draft"]["fingerprint"])
        self.assertEqual(ctx.exception.detail["code"], "degraded_review_confirmation_required")
        self.assertTrue(contract.publication_package(state, state["draft"]["fingerprint"], acknowledge_degraded=True)["degraded_acknowledged"])

    def test_original_source_payload_survives_readable_render(self):
        draft = {"title": "БТ", "business_goal": "Снизить ошибки", "custom": {"special": ["точный", "текст"]}}
        result = contract.render_source_document(draft)
        original = result.split("```json\n", 1)[1].rsplit("\n```", 1)[0]
        self.assertEqual(json.loads(original), draft)


class GatewayBoundaryTests(unittest.TestCase):
    actor = SimpleNamespace(id=42)

    def test_gateway_rejects_decoded_url_injection_and_private_service_routes(self):
        def forbidden(**kwargs):
            self.fail("Unrecognised paths must never reach privileged proxy")
        api = gateway_functions(proxy_request=forbidden)
        for method, path in [
            ("GET", "sessions?user_id=99&ignored="),
            ("GET", "sessions#ignored"),
            ("GET", "session/../sessions"),
            ("GET", "sessions%3Fuser_id%3D99"),
            ("GET", "session/test\\..\\sessions"),
            ("POST", "cancel-review"),
            ("POST", "reopen-review"),
            ("DELETE", "session/test"),
        ]:
            with self.subTest(method=method, path=path):
                request = Request({})
                request.method = method
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(api["gateway"](path, request, Db(), self.actor))
                self.assertEqual(ctx.exception.status_code, 404)

    def test_session_listing_overwrites_actor_query_and_filters_revoked_sources(self):
        captured = {}
        def proxy(**kwargs):
            captured.update(kwargs)
            return 200, json.dumps({"sessions": [
                {"session_id": "own-unlinked"},
                {"session_id": "revoked", "linked_object": {"object_type": "task", "object_id": "5"}},
            ]}).encode(), "application/json"
        def denied(*args):
            raise HTTPException(404, "Object is unavailable")
        api = gateway_functions(proxy_request=proxy, _snapshot=denied)
        request = Request({})
        request.method = "GET"
        request.url.query = "user_id=99&user_id=98"
        response = asyncio.run(api["gateway"]("sessions", request, Db(), self.actor))
        self.assertEqual(captured["query"], "user_id=42")
        self.assertEqual(json.loads(response.body)["sessions"], [{"session_id": "own-unlinked"}])

    def test_submission_uses_server_snapshot_and_never_legacy_intake(self):
        state = valid_state()
        captured = {}
        row = SimpleNamespace(id=9, artifact_id="br-test")

        def submit(db, actor, draft, linked, **kwargs):
            captured.update(actor=actor, draft=draft, kwargs=kwargs)
            return row

        reviews = SimpleNamespace(submit_from_agent=submit, serialize_review=lambda *args: {"id": 9, "url": "#/review?requirement_review=9"})
        api = gateway_functions(reviews=reviews, call_json=lambda *args, **kwargs: (200, deepcopy(state)),
                                _snapshot=lambda *args: {})
        req = Request({"session_id": "session-1", "expected_draft_hash": state["draft"]["fingerprint"],
                       "user_id": 999, "draft": {"forged": True}})
        db = Db()
        result = asyncio.run(api["submit_requirement_review"](req, db, self.actor))
        self.assertEqual(captured["draft"], state["draft"])
        self.assertIs(captured["actor"], self.actor)
        self.assertEqual(result["artifact_id"], "br-test")
        self.assertEqual(db.commits, 1)
        self.assertIn("review_report", captured["kwargs"])

    def test_revoked_source_prevents_disclosing_or_submitting_session(self):
        state = valid_state()
        state["linked_object"] = {"object_type": "task", "object_id": "7"}

        def denied(*args):
            raise HTTPException(404, detail="not_found_or_forbidden")

        api = gateway_functions(call_json=lambda *args, **kwargs: (200, state), _snapshot=denied)
        with self.assertRaises(HTTPException) as ctx:
            api["_session_context"](Db(), self.actor, "session-1")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_resume_does_not_overwrite_newer_working_revision(self):
        state = valid_state()
        row = SimpleNamespace(id=9, version=3, creator_id=42, session_id="session-1", artifact_id="br-test",
                              status="returned", artifact_fingerprint="older", artifact_revision=1, comment="Уточните границы")
        calls = []

        def call(method, path, payload=None, **kwargs):
            calls.append((method, path, payload))
            return 200, deepcopy(state)

        api = gateway_functions(reviews=SimpleNamespace(get_review=lambda *args: row), call_json=call, _snapshot=lambda *args: {})
        result = asyncio.run(api["resume_requirement_review"](9, Request({}), Db(), self.actor))
        actions = [payload["action"] for _, path, payload in calls if path == "document-action"]
        self.assertEqual(actions, ["add_source"])
        self.assertEqual(result["state"]["draft"], state["draft"])

    def test_resume_approved_snapshot_creates_next_revision_of_same_artifact(self):
        state = valid_state()
        row = SimpleNamespace(id=9, version=3, creator_id=42, session_id="session-1", artifact_id="br-test",
                              status="approved", artifact_fingerprint=state["draft"]["fingerprint"], artifact_revision=1, comment="")
        calls = []
        def call(method, path, payload=None, **kwargs):
            calls.append((path, payload))
            return 200, deepcopy(state)
        api = gateway_functions(reviews=SimpleNamespace(get_review=lambda *args: row), call_json=call, _snapshot=lambda *args: {})
        asyncio.run(api["resume_requirement_review"](9, Request({}), Db(), self.actor))
        action = next(body for path, body in calls if path == "document-action")
        self.assertEqual(action["action"], "next_revision")
        self.assertEqual(action["expected_draft_hash"], state["draft"]["fingerprint"])

    def test_wrong_actor_and_mismatched_idempotency_are_rejected(self):
        row = SimpleNamespace(creator_id=99)
        api = gateway_functions(reviews=SimpleNamespace(get_review=lambda *args: row))
        with self.assertRaises(HTTPException):
            asyncio.run(api["resume_requirement_review"](1, Request({}), Db(), self.actor))
        with self.assertRaises(HTTPException):
            api["_operation_key"](Request({}), {"idempotency_key": "different"})

    def test_linked_workspace_reuses_existing_document(self):
        state = valid_state()
        state["linked_object"] = {"object_type": "task", "object_id": "7"}
        calls = []
        def call(method, path, **kwargs):
            calls.append(path)
            if path == "sessions":
                self.assertEqual(kwargs["query"], "user_id=42&linked_object_type=task&linked_object_id=7")
                return 200, {"sessions": [{"session_id": "session-1", "product_mode": "requirement_copilot",
                                          "linked_object": state["linked_object"]}]}
            return 200, state
        api = gateway_functions(call_json=call, _snapshot=lambda *args: {"title": "Task"})
        result = asyncio.run(api["open_object_workspace"]("task", "7", Request({}), Db(), self.actor))
        self.assertTrue(result["reused"])
        self.assertEqual(calls, ["sessions", "session/session-1"])

    def test_interrupted_workspace_creation_completes_import_on_retry(self):
        linked = {"object_type": "task", "object_id": "7", "title": "Заявки",
                  "fields": {"title": "Заявки", "description": "Заявки теряются"}}
        state = {"session_id": "session-1", "draft": None, "linked_object": linked,
                 "source_context": {"attachments": [{"kind": "dmb_workspace_bootstrap", "operation_scope": "original"}]}}
        calls = []
        def call(method, path, payload=None, **kwargs):
            calls.append((path, payload))
            if path == "sessions":
                return 200, {"sessions": [{"session_id": "session-1", "product_mode": "requirement_copilot", "linked_object": linked}]}
            if path == "import-requirement-document":
                return 200, {**state, "draft": {"title": "Заявки"}, "action": "document_imported"}
            return 200, state
        api = gateway_functions(call_json=call, _snapshot=lambda *args: linked)
        result = asyncio.run(api["open_object_workspace"]("task", "7", Request({}), Db(), self.actor))
        self.assertIsNotNone(result["state"]["draft"])
        self.assertNotIn("new-session", [path for path, _ in calls])
        self.assertEqual(calls[-1][1]["idempotency_key"], api["_step_key"]("original", "import"))

    def test_legacy_intake_cannot_copy_linked_document_into_new_request(self):
        state = valid_state()
        state["linked_object"] = {"object_type": "task", "object_id": "7"}
        api = gateway_functions(call_json=lambda *args, **kwargs: (200, state), _snapshot=lambda *args: {})
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(api["send_for_review"](Request({"session_id": "session-1"}), Db(), self.actor))
        self.assertEqual(ctx.exception.detail["code"], "requirement_revision_review_required")

    def test_cached_new_session_response_is_reauthorized(self):
        state = valid_state()
        state["linked_object"] = {"object_type": "task", "object_id": "7"}
        def denied(*args):
            raise HTTPException(404, detail="not_found_or_forbidden")
        api = gateway_functions(_snapshot=denied,
            proxy_request=lambda **kwargs: (200, json.dumps(state).encode(), "application/json"))
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(api["gateway"]("new-session", Request({}), Db(), self.actor))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_reused_creation_key_cannot_import_into_another_linked_document(self):
        linked = {"object_type": "task", "object_id": "7", "title": "Заявки",
                  "fields": {"title": "Заявки", "description": "Описание"}}
        calls = []
        def call(method, path, payload=None, **kwargs):
            calls.append(path)
            return 200, {"session_id": "session-other", "linked_object": {"object_type": "task", "object_id": "8"}}
        api = gateway_functions(_snapshot=lambda *args: linked, call_json=call)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(api["open_object_workspace"]("task", "7", Request({"force_new": True}), Db(), self.actor))
        self.assertEqual(ctx.exception.detail["code"], "idempotency_conflict")
        self.assertEqual(calls, ["new-session"])


class RealEngineContractTests(unittest.TestCase):
    def test_writing_review_and_publication_use_the_same_revision_contract(self):
        # Actual agent service objects, but only agent-owned in-memory sessions;
        # no DMB database/app import or protected identity fixture is involved.
        with patch.dict(os.environ, {"AGENT_V2_SESSION_DATABASE_URL": "sqlite:///:memory:",
                                     "AGENT_V2_LLM_PROVIDER": "mock"}):
            sys.path.insert(0, str(ROOT.parents[1] / "agents/business-analyst-experimental"))
            try:
                from dataclasses import asdict
                from business_analyst_experimental.session import SessionStore
                from business_analyst_experimental.v2.orchestrator import V2Orchestrator
                from business_analyst_experimental.v2 import document_workspace
                store = SessionStore(database_url="sqlite:///:memory:")
                state = store.new_session(17)
                state.product_mode, state.operator_role, state.artifact_type = "requirement_copilot", "BA", "business_requirement_v2"
                store.save(state)
                engine = V2Orchestrator(store)

                def action(name, **values):
                    current = store.get(state.session_id)
                    return engine.document_action(state.session_id, 17, {"action": name,
                        "expected_draft_hash": (current.draft or {}).get("fingerprint", ""), **values})

                action("add_source", source={"title": "Встреча", "content": "Сотрудник принимает и проверяет заявки."})
                action("add_source", source={"title": "Правило", "content": "Каждая заявка получает уникальный номер."})
                fields = {"title": "Учёт заявок", "problem_statement": "При передаче теряются заявки",
                          "business_goal": "Сохранить каждую принятую заявку", "scope_in": ["Входящие заявки"],
                          "primary_role": "Оператор", "process": "Регистрация заявок",
                          "current_process": "Оператор записывает заявки вручную",
                          "target_process": "Оператор регистрирует заявку в едином реестре",
                          "acceptance_criteria": ["Каждая принятая заявка имеет уникальный номер"],
                          "business_requirements": [{"text": "Сохранять каждую принятую заявку", "source_refs": []}]}
                class Provider:
                    name, model = "test", "fixture"
                    answer = {"operations": [{"field": key, "after": value, "reason": "По материалам", "source_refs": []}
                                             for key, value in fields.items()]}
                    def available(self):
                        return True
                    def chat_json(self, *args, **kwargs):
                        if 'ПОЛНОТУ И ТОЧНОСТЬ ПЕРЕНОСА' in kwargs.get('system_prompt', ''):
                            context = json.loads(args[0][0]['content'])
                            candidate = context['candidate_document']
                            return {'coverage': [
                                {'fact_id': fact['id'], 'status': 'covered', 'field': 'acceptance_criteria',
                                 'quote': candidate['acceptance_criteria'][0], 'reason': 'Эталонная сверка для теста границы'}
                                for fact in context['source_facts']], 'questions': [], 'unsupported': []}
                        return deepcopy(self.answer)

                provider = Provider()
                with patch.object(document_workspace, "get_llm", lambda: provider):
                    proposed = action("draft")
                    self.assertIsNone(proposed.draft)
                    proposal = proposed.document_proposals[-1]
                    applied = action("apply_proposal", proposal_id=proposal["id"],
                                     operation_ids=[item["id"] for item in proposal["operations"]])
                    self.assertIsNotNone(applied.draft, applied.message)
                    before_review = deepcopy(applied.draft)
                    provider.answer = {"findings": [], "summary": "Проверено на эталонном ответе"}
                    reviewed = action("review")
                    self.assertEqual(reviewed.draft, before_review)
                    report = contract.publication_package(asdict(reviewed), reviewed.draft["fingerprint"])
                    self.assertEqual(len(report["sources"]), 2)
                    self.assertEqual(report["review"]["status"], "completed")
                    next_revision = action("next_revision")
                    self.assertEqual(next_revision.draft["artifact_id"], before_review["artifact_id"])
                    self.assertEqual(next_revision.draft["business_requirements"][0]["id"], before_review["business_requirements"][0]["id"])
                    with self.assertRaises(HTTPException):
                        contract.publication_package(asdict(next_revision), next_revision.draft["fingerprint"])
            finally:
                sys.path.pop(0)


if __name__ == "__main__":
    unittest.main()
