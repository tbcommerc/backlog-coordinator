"""Isolated integrity regressions. Run this file directly; never loads conftest/DB.

python -B dmb-backlog/backend/tests/test_requirement_artifact_integrity.py
"""
from __future__ import annotations

import ast
from contextlib import nullcontext
from copy import deepcopy
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import unittest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifacts = load_file("requirement_artifacts", BACKEND / "requirement_artifacts.py")
agent_revision = load_file("agent_revision", ROOT / "agent/agent/composer/revision.py")


class Expression:
    def __eq__(self, other):
        return self

    def is_(self, other):
        return self

    def in_(self, other):
        return self


class RequestModel:
    id = user_id = agent_session_id = is_deleted = Expression()

    def __init__(self, **values):
        self.__dict__.update(values)
        self.id = 7
        self.version = 0
        self.revision_history = []
        self.status_history = []


class FakeDB:
    def __init__(self, row=None):
        self.row = row
        self.saved = None
        self.commits = 0
        self.rollbacks = 0

    def query(self, *args):
        return self

    def filter(self, *args):
        return self

    def with_for_update(self):
        return self

    def join(self, *args):
        return self

    def first(self):
        return self.row

    def add(self, value):
        self.saved = value

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def refresh(self, value):
        pass


class HTTPError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


class StaleDataError(Exception):
    pass


class IntegrityError(Exception):
    pass


def router_functions(**overrides):
    parsed = ast.parse((BACKEND / "routers/agent_router.py").read_text(encoding="utf-8-sig"))
    names = {
        "_render_request", "_request_available_actions", "_sent_request_response", "_confirmed_snapshot",
        "_commit_resubmitted_request", "agent_request_status", "agent_request_resume",
        "agent_send_for_review", "agent_session_state",
    }
    functions = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names]
    for function in functions:
        function.decorator_list = []
        function.args.defaults = []
    constants = [node for node in parsed.body if isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id in {"REQUEST_STATUSES", "REQUEST_STATUS_TRANSITIONS"}
        for target in node.targets
    )]
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *constants, *functions], type_ignores=[])
    env = {name: getattr(artifacts, name) for name in (
        "draft_fingerprint", "render_request", "ensure_request_history", "append_revision", "append_status_event", "current_revision_history",
    )}
    env.update({
        "RequirementRequest": RequestModel, "AgentSession": RequestModel,
        "HTTPException": HTTPError, "StaleDataError": StaleDataError, "IntegrityError": IntegrityError,
        "_submission_lock": lambda sid: nullcontext(), "_user_session_ids": lambda db, user: {"s"},
        "can_review_request": lambda user, team_id: True, "is_customer_portal_only": lambda user: False,
        "_request_to_dict": lambda request, user: dict(vars(request)),
        "_compensate_review_submission": lambda *args: None,
        "get_request_review_access": lambda user: "all",
        "notify_request_decision": lambda *args: None,
    })
    env.update(overrides)
    exec(compile(ast.fix_missing_locations(module), "agent_router_isolated", "exec"), env)
    return env


def sender_request(draft=None):
    return SimpleNamespace(session_id="s", title="", team_id=None,
                           expected_draft_hash=artifacts.draft_fingerprint(draft) if draft else "")


def existing_request(status="returned"):
    return SimpleNamespace(id=7, agent_session_id="s", title="Original", status=status,
                           version=2, draft={"title": "Original", "problem_statement": "BEFORE"},
                           team_id=3, reviewer_id=9, reject_reason="Clarify the limit",
                           revision_history=[], status_history=[], updated_at=None, created_at=None)


class RequirementIntegrityTests(unittest.TestCase):
    author = SimpleNamespace(id=2, team_id=3, name="Author")
    reviewer = SimpleNamespace(id=9, team_id=3, name="Reviewer")

    def test_agent_get_snapshot_serializes_read_review_and_hash(self):
        from contextlib import contextmanager
        source = ast.parse((ROOT / "agent/agent/api/router.py").read_text(encoding="utf-8-sig"))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "session_state")
        function.decorator_list = []
        function.args.defaults = []
        class RemoveImports(ast.NodeTransformer):
            def visit_ImportFrom(self, node):
                return None
        function = RemoveImports().visit(function)
        locked = []
        @contextmanager
        def serialized(session_id):
            locked.append(session_id)
            try: yield
            finally: locked.pop()
        draft = {"title": "Reviewed snapshot"}
        def get(session_id):
            self.assertEqual(locked, [session_id])
            return SimpleNamespace(draft=draft)
        def build(state, *args):
            self.assertEqual(locked, ["s"])
            return SimpleNamespace(draft=state.draft)
        env = {"_orchestrator": SimpleNamespace(store=SimpleNamespace(serialized=serialized, get=get), _build_response=build),
               "draft_fingerprint": artifacts.draft_fingerprint, "HTTPException": HTTPError}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), "agent_api_snapshot", "exec"), env)
        response = env["session_state"]("s", None)
        self.assertEqual(response.draft_revision, artifacts.draft_fingerprint(draft))
        self.assertEqual(locked, [])

    def test_migration_compiles_offline_and_only_changes_requirement_history(self):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        output = io.StringIO()
        context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
        migration = load_file("history_migration", BACKEND / "alembic/versions/c1a9e8b7d602_requirement_revision_history.py")
        with Operations.context(context):
            migration.upgrade()
        sql = output.getvalue()
        self.assertIn("ALTER TABLE requirement_requests ADD COLUMN revision_history JSON", sql)
        self.assertIn("ALTER TABLE requirement_requests ADD COLUMN status_history JSON", sql)
        self.assertNotIn("INSERT", sql)
        self.assertNotIn("UPDATE", sql)
        self.assertEqual(sql.count("ALTER TABLE"), 2)

    def test_fingerprint_matches_service_and_tracks_evidence(self):
        first = {"problem_statement": "Сверка", "field_provenance": {"source": "user"}}
        reordered = dict(reversed(list(first.items())))
        self.assertEqual(artifacts.draft_fingerprint(first), agent_revision.draft_fingerprint(reordered))
        self.assertNotEqual(artifacts.draft_fingerprint(first), artifacts.draft_fingerprint({**first, "field_provenance": {"source": "assumption"}}))

    def test_task_renderer_keeps_all_semantic_and_evidence_fields(self):
        draft = {"risks": ["RISK"], "dependencies": ["DEPENDENCY"], "conflicts": [{"message": "CONFLICT"}],
                 "field_provenance": {"problem_statement": {"evidence": "EVIDENCE"}},
                 "field_status": {"dependencies": "not_applicable"}, "assumption_details": [{"text": "ASSUMPTION"}],
                 "future_business_field": "FUTURE"}
        rendered = artifacts.render_request(draft)
        for value in ("RISK", "DEPENDENCY", "CONFLICT", "EVIDENCE", "not_applicable", "ASSUMPTION", "FUTURE"):
            self.assertIn(value, rendered)

    def test_delivery_of_legacy_request_rebuilds_full_task_description(self):
        row = existing_request("in_review")
        row.description = "Legacy incomplete description"
        row.draft.update({"risks": ["LEGACY_RISK"], "dependencies": ["LEGACY_DEPENDENCY"]})
        row.task_id = None
        row.user = SimpleNamespace(business_customer_id=None)
        class UserModel:
            id = team_id = is_active = role_id = Expression()
        class RoleModel:
            id = name = Expression()
        class StatusModel:
            name = Expression()
        class DeliveryDB(FakeDB):
            def query(self, model):
                self.model = model
                return self
            def first(self):
                if self.model is UserModel: return self_assignee
                if self.model is StatusModel: return SimpleNamespace(id=1)
                return row
        self_assignee = SimpleNamespace(id=11)
        db = DeliveryDB(row)
        env = router_functions(User=UserModel, Role=RoleModel, TaskStatus=StatusModel, Task=RequestModel,
                               func=SimpleNamespace(lower=lambda value: value), ASSIGNABLE_REQUEST_ANALYST_ROLES={"analyst"},
                               notify_assignment=lambda *args: None)
        env["agent_request_status"](7, SimpleNamespace(status="in_progress", version=2, assignee_id=11, reject_reason=""), db, self.reviewer)
        self.assertIn("LEGACY_RISK", db.saved.description)
        self.assertIn("LEGACY_DEPENDENCY", db.saved.description)
        self.assertEqual(db.saved.link_requirements, ["#/review/7?revision=1"])
        self.assertEqual(row.status_history[-1]["status"], "in_progress")

    def test_reviewer_can_release_request_with_audited_reason(self):
        row = existing_request("in_review")
        env = router_functions()
        body = SimpleNamespace(status="submitted", version=2, reject_reason="", assignee_id=None,
                               team_id=None, action_reason="Передать профильному специалисту",
                               finding_resolutions=[])
        env["agent_request_status"](7, body, FakeDB(row), self.reviewer)
        self.assertEqual(row.status, "submitted")
        self.assertIsNone(row.reviewer_id)
        self.assertEqual(row.status_history[-1]["comment"], "Передать профильному специалисту")

    def test_returned_cannot_be_claimed_and_comment_remains(self):
        row = existing_request()
        env = router_functions()
        self.assertEqual(env["_request_available_actions"](row, self.reviewer), [])
        with self.assertRaises(HTTPError) as result:
            env["agent_request_status"](7, SimpleNamespace(status="in_review", version=2, reject_reason="", assignee_id=None), FakeDB(row), self.reviewer)
        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(row.reject_reason, "Clarify the limit")
        self.assertEqual(row.status, "returned")

    def test_stale_preview_rejected_before_confirmation(self):
        calls = []
        def call(method, path, payload=None):
            calls.append(method)
            return {"draft": {"title": "New"}}
        env = router_functions(_call_agent=call)
        with self.assertRaises(HTTPError) as result:
            env["agent_send_for_review"](sender_request({"title": "Old"}), FakeDB(), self.author)
        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(calls, ["GET"])

    def test_concurrent_edit_conflict_does_not_commit(self):
        before = {"title": "A"}
        def call(method, path, payload=None):
            if method == "GET": return {"draft": before}
            self.assertEqual(payload["expected_draft_hash"], artifacts.draft_fingerprint(before))
            return {"action": "revision_conflict", "message": "Draft changed"}
        env = router_functions(_call_agent=call)
        db = FakeDB()
        with self.assertRaises(HTTPError): env["agent_send_for_review"](sender_request(before), db, self.author)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.rollbacks, 1)

    def test_persisted_document_is_the_confirmed_snapshot(self):
        before = {"title": "A", "review_findings": []}
        confirmed = {"title": "A", "review_findings": [{"message": "Verified warning", "severity": "warning"}]}
        def call(method, path, payload=None):
            if method == "GET": return {"draft": deepcopy(before)}
            self.assertEqual(payload["expected_draft_hash"], artifacts.draft_fingerprint(before))
            return {"action": "sent", "success": True, "draft": deepcopy(confirmed)}
        env = router_functions(_call_agent=call)
        db = FakeDB()
        response = env["agent_send_for_review"](sender_request(before), db, self.author)
        self.assertEqual(response["draft"], db.saved.draft)
        self.assertEqual(db.saved.draft, confirmed)
        self.assertEqual(db.saved.revision_history[0]["draft"], confirmed)
        self.assertIn("Verified warning", db.saved.description)

    def test_new_draft_never_masquerades_as_successful_duplicate(self):
        row = existing_request("in_review")
        env = router_functions(_call_agent=lambda *args: {"draft": {"title": "Changed"}})
        db = FakeDB(row)
        with self.assertRaises(HTTPError) as result: env["agent_send_for_review"](sender_request(), db, self.author)
        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(row.draft["problem_statement"], "BEFORE")

    def test_equal_snapshot_retry_is_idempotent(self):
        row = existing_request("submitted")
        env = router_functions(_call_agent=lambda *args: {"draft": deepcopy(row.draft)})
        response = env["agent_send_for_review"](sender_request(row.draft), FakeDB(row), self.author)
        self.assertTrue(response["duplicate"])
        self.assertEqual(response["draft"], row.draft)

    def test_post_commit_refresh_failure_never_unlocks_persisted_submission(self):
        draft = {"title": "Persisted"}
        compensations = []
        env = router_functions(_call_agent=lambda method, *args: {"draft": draft} if method == "GET" else {"action": "sent", "draft": draft},
                               _compensate_review_submission=lambda *args: compensations.append(args))
        db = FakeDB()
        def fail_refresh(row): raise RuntimeError("response read failed after commit")
        db.refresh = fail_refresh
        with self.assertRaises(RuntimeError): env["agent_send_for_review"](sender_request(draft), db, self.author)
        self.assertEqual(db.commits, 1)
        self.assertEqual(compensations, [])

    def test_resubmission_preserves_old_snapshot_and_review_comment(self):
        row = existing_request()
        old = deepcopy(row.draft)
        new = {"title": "Revision 2", "problem_statement": "AFTER"}
        def call(method, *args):
            return {"draft": deepcopy(new)} if method == "GET" else {"action": "sent", "draft": deepcopy(new)}
        env = router_functions(_call_agent=call)
        response = env["agent_send_for_review"](sender_request(new), FakeDB(row), self.author)
        self.assertTrue(response["resubmitted"])
        self.assertEqual(row.revision_history[0]["draft"], old)
        self.assertEqual(row.revision_history[1]["draft"], new)
        self.assertEqual(row.status_history[0]["comment"], "Clarify the limit")
        self.assertIsNone(row.status_history[0]["created_at"])
        self.assertTrue(row.status_history[0]["observed_at"])
        self.assertEqual(row.status_history[1]["status"], "submitted")
        row.draft["problem_statement"] = "MUTATED LATER"
        self.assertEqual(row.revision_history[1]["draft"]["problem_statement"], "AFTER")

    def test_current_dialogue_restore_contains_request_context(self):
        env = router_functions(_call_agent=lambda *args: {"draft": {"title": "A"}},
                               _agent_request_context=lambda *args: {"request_status": "returned", "review_comment": "Clarify", "request_team_id": 3})
        response = env["agent_session_state"](FakeDB(SimpleNamespace(agent_session_id="s")), self.author)
        self.assertTrue(response["active"])
        self.assertEqual(response["review_comment"], "Clarify")


if __name__ == "__main__":
    unittest.main(verbosity=2)
