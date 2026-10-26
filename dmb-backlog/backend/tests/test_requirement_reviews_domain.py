"""Run directly: python -B dmb-backlog/backend/tests/test_requirement_reviews_domain.py.

No backend conftest, configuration, live DB or protected fixture records. The real
RequirementReview model, listener and service execute against three isolated
in-memory work tables. Identity/ACL boundaries are explicit in-memory mocks.
"""
import ast
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.orm import Query, declarative_base, relationship, sessionmaker
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parents[1]
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = sa.Column(sa.Integer, primary_key=True)
    name = sa.Column(sa.String)


sa.Table("teams", Base.metadata, sa.Column("id", sa.Integer, primary_key=True))


class Task(Base):
    __tablename__ = "tasks"
    id = sa.Column(sa.Integer, primary_key=True)
    title = sa.Column(sa.String)
    description = sa.Column(sa.String)
    link_requirements = sa.Column(sa.JSON, default=list)
    team_id = sa.Column(sa.Integer)
    version = sa.Column(sa.Integer, default=1)
    is_deleted = sa.Column(sa.Boolean, default=False)


class RequirementRequest(Base):
    __tablename__ = "requirement_requests"
    id = sa.Column(sa.Integer, primary_key=True)
    title = sa.Column(sa.String)
    description = sa.Column(sa.String)
    draft = sa.Column(sa.JSON, default=dict)
    team_id = sa.Column(sa.Integer)
    user_id = sa.Column(sa.Integer)
    task_id = sa.Column(sa.Integer)
    status = sa.Column(sa.String, default="in_progress")
    version = sa.Column(sa.Integer, default=1)
    is_deleted = sa.Column(sa.Boolean, default=False)


def _test_relationship(*args, **kwargs):
    # Identity rows do not exist in this test DB. Names are presentation-only.
    return relationship(*args, **kwargs, lazy="noload")


nodes = ast.parse((ROOT / "models.py").read_text(encoding="utf-8")).body
selected = [node for node in nodes if getattr(node, "name", "") in {
    "RequirementReview", "_requirement_review_snapshot_immutable",
}]
namespace = {**vars(sa), "Base": Base, "relationship": _test_relationship, "func": sa.func}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(ROOT / "models.py"), "exec"), namespace)
RequirementReview = namespace["RequirementReview"]


def _scope(actor):
    return actor.role.review_access


def _task_access(action, target, actor):
    return actor.read_all or target.team_id == actor.team_id


auth = ModuleType("auth")
auth.can_access_task = _task_access
auth.get_request_review_access = _scope
auth.task_read_scope_clause = lambda actor, model: sa.true() if actor.read_all else model.team_id == actor.team_id
models = ModuleType("models")
models.RequirementReview, models.RequirementRequest, models.Task = RequirementReview, RequirementRequest, Task
gateway = ModuleType("services.agent_v2_gateway")
gateway.operator_role = lambda actor: actor.operator_role
spec = importlib.util.spec_from_file_location("requirement_reviews_under_test", ROOT / "services" / "requirement_reviews.py")
service = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"auth": auth, "models": models, "services.agent_v2_gateway": gateway}):
    spec.loader.exec_module(service)


def actor(id=1, team=10, *, scope="team", read_all=False, role="BA", admin=False):
    return SimpleNamespace(id=id, team_id=team, name=f"Actor {id}", read_all=read_all,
        operator_role=role, role=SimpleNamespace(review_access=scope, admin_access="full" if admin else "none"))


def artifact(revision=1, artifact_id="br-1", **values):
    data = {"schema": "business-requirement-draft.v2", "artifact_id": artifact_id,
        "revision": revision, "title": "Сократить ожидание", "business_goal": "Сократить время обработки", **values}
    data["fingerprint"] = service._hash(data)
    return data


class ReviewDomainTests(unittest.TestCase):
    def setUp(self):
        self.engine = sa.create_engine("sqlite:///:memory:")
        # Only these ordinary work-record tables are created; no protected data.
        Base.metadata.create_all(self.engine, tables=[Task.__table__, RequirementRequest.__table__, RequirementReview.__table__])
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.author, self.reviewer = actor(), actor(2)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def submit(self, draft=None, key="submit-1", linked=None, **kwargs):
        draft = draft or artifact()
        row = service.submit_from_agent(self.db, self.author, draft, linked,
            session_id="session-1", idempotency_key=key, expected_draft_hash=draft["fingerprint"], **kwargs)
        self.db.commit()
        return row

    def action(self, row, action, who=None, key=None, version=None, comment=""):
        result = service.perform_action(self.db, who or self.reviewer, row.id, action,
            row.version if version is None else version, comment, key or action)
        self.db.commit()
        return result

    def expect_error(self, code, call, status=None):
        with self.assertRaises(HTTPException) as caught:
            call()
        self.assertEqual(caught.exception.detail["code"], code)
        if status:
            self.assertEqual(caught.exception.status_code, status)

    def test_no_protected_tables_and_snapshot_deep_copy(self):
        data = artifact(extra={"unknown": [1, 2]})
        report = {"findings": [{"id": "f1", "text": "Уточнить метрику"}]}
        row = self.submit(data, review_report=report)
        data["extra"]["unknown"].append(3)
        report["findings"].clear()
        self.assertEqual(row.artifact_snapshot["extra"]["unknown"], [1, 2])
        self.assertEqual(len(row.review_report["findings"]), 1)
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()), {"tasks", "requirement_requests", "requirement_reviews"})

    def test_tampered_fingerprint_and_revision_rejected(self):
        data = artifact()
        data["title"] = "Changed without new hash"
        self.expect_error("draft_revision_conflict", lambda: self.submit(data))
        data = artifact(revision=0)
        self.expect_error("artifact_identity_required", lambda: self.submit(data))
        self.assertEqual(self.db.query(RequirementReview).count(), 0)

    def test_submission_idempotency_is_payload_and_actor_scoped(self):
        first = self.submit()
        replay = self.submit()
        self.assertEqual(first.id, replay.id)
        self.expect_error("idempotency_conflict", lambda: self.submit(artifact(2)))
        self.author = actor(3)
        self.expect_error("artifact_owner_conflict", lambda: self.submit(key="other-key"), 403)
        other = self.submit(artifact(artifact_id="br-other"))
        self.assertNotEqual(first.id, other.id)

    def test_new_working_revision_does_not_revoke_pending_snapshot(self):
        row = self.submit()
        next_draft = artifact(2, business_goal="Уточнённая цель")
        self.expect_error("active_review_exists", lambda: self.submit(next_draft, key="next"))
        self.action(row, "claim")
        self.action(row, "approve")
        self.assertEqual(row.status, "approved")
        self.assertEqual(row.artifact_revision, 1)
        self.assertNotEqual(row.artifact_snapshot["business_goal"], next_draft["business_goal"])

    def test_self_approval_and_claim_forbidden_even_full_admin(self):
        row = self.submit()
        for who in [self.author, actor(admin=True, scope="all", read_all=True)]:
            self.expect_error("review_action_forbidden", lambda: self.action(row, "claim", who=who), 403)
            self.expect_error("review_action_forbidden", lambda: self.action(row, "approve", who=who), 403)

    def test_claim_action_replay_does_not_repeat_and_other_key_is_scoped(self):
        row = self.submit()
        self.action(row, "claim", key="claim-one", version=1)
        self.action(row, "claim", key="claim-one", version=1)
        self.assertEqual(row.version, 2)
        self.expect_error("idempotency_conflict", lambda: self.action(row, "return", key="claim-one", version=2, comment="Fix"))
        self.expect_error("review_version_conflict", lambda: self.action(row, "approve", version=1))
        self.expect_error("review_action_forbidden", lambda: self.action(row, "approve", who=actor(3), key="claim-one"))

    def test_return_requires_comment_and_resubmission_preserves_both(self):
        row = self.submit()
        self.action(row, "claim")
        self.expect_error("review_comment_required", lambda: self.action(row, "return"))
        self.action(row, "return", comment="Уточнить метрику")
        next_row = self.submit(artifact(2), key="next")
        self.assertEqual(row.status, "returned")
        self.assertEqual(row.comment, "Уточнить метрику")
        self.assertEqual(next_row.status, "submitted")
        self.assertIsNone(next_row.reviewer_id)

    def test_explicit_supersede_requires_version_and_is_atomic(self):
        row = self.submit()
        self.expect_error("active_review_exists", lambda: self.submit(artifact(2), key="next", supersedes_review_id=row.id, supersedes_version=0))
        replaced = self.submit(artifact(2), key="next", supersedes_review_id=row.id, supersedes_version=1)
        self.assertEqual(row.status, "withdrawn")
        self.assertEqual(row.events[-1]["action"], "supersede")
        self.assertEqual(replaced.active_artifact_id, row.artifact_id)

    def test_failed_supersede_insert_rolls_back_withdrawal(self):
        row = self.submit()
        actual_flush = service._flush
        def fail_on_new(db):
            if any(isinstance(item, RequirementReview) for item in db.new):
                raise sa.exc.IntegrityError("insert", {}, Exception("simulated collision"))
            actual_flush(db)
        with patch.object(service, "_flush", side_effect=fail_on_new):
            self.expect_error("concurrent_review_submission", lambda: self.submit(artifact(2), key="next", supersedes_review_id=row.id, supersedes_version=1))
        self.db.expire_all()
        saved = self.db.get(RequirementReview, row.id)
        self.assertEqual(saved.status, "submitted")
        self.assertEqual(saved.version, 1)
        self.assertEqual(self.db.query(RequirementReview).count(), 1)

    def task_source(self):
        task = Task(id=20, title="Задача", description="Исходное описание", team_id=10, version=1)
        request = RequirementRequest(id=30, title="Запрос", description="Вводные", team_id=10, user_id=99, task_id=20)
        self.db.add_all([task, request])
        self.db.commit()
        linked = {"object_type": "task", "object_id": "20", "object_version": "1",
            "fields": {"title": task.title, "description": task.description}}
        return task, request, linked

    def test_task_review_never_creates_task_or_changes_request_or_author(self):
        task, request, linked = self.task_source()
        before = (task.title, task.description, task.version, request.status, request.version, request.user_id)
        row = self.submit(linked=linked)
        self.action(row, "claim")
        self.action(row, "approve")
        self.assertEqual(row.source_request_author_id, 99)
        self.assertEqual(self.db.query(Task).count(), 1)
        self.assertEqual(self.db.query(RequirementRequest).count(), 1)
        self.assertEqual((task.title, task.description, task.version, request.status, request.version, request.user_id), before)

    def test_live_access_revocation_and_review_scope_separate_from_read(self):
        task, _, linked = self.task_source()
        row = self.submit(linked=linked)
        reader = actor(3, team=77, scope="none", read_all=True)
        self.assertEqual(service.get_review(self.db, reader, row.id).id, row.id)
        self.expect_error("review_action_forbidden", lambda: self.action(row, "claim", who=reader))
        task.team_id = 77
        self.db.commit()
        self.expect_error("not_found_or_forbidden", lambda: service.get_review(self.db, self.author, row.id), 404)
        self.expect_error("not_found_or_forbidden", lambda: self.action(row, "withdraw", who=self.author), 404)
        self.assertEqual(service.list_reviews(self.db, self.author)["total"], 0)

    def test_changed_content_blocks_approval_but_unrelated_version_does_not(self):
        task, _, linked = self.task_source()
        row = self.submit(linked=linked)
        self.action(row, "claim")
        task.version = 8
        self.db.commit()
        self.assertFalse(service.serialize_review(row, self.reviewer, self.db)["context_changed"])
        task.description = "Новые исходные условия"
        self.db.commit()
        dto = service.serialize_review(row, self.reviewer, self.db)
        self.assertTrue(dto["context_changed"])
        self.assertFalse(dto["permissions"]["can_approve"])
        self.expect_error("source_context_changed", lambda: self.action(row, "approve"))
        self.action(row, "return", comment="Обновить контекст")

    def test_request_source_author_retained_and_read_scope_applies_before_paging(self):
        request = RequirementRequest(id=50, title="Запрос", description="Вводные", team_id=10, user_id=99)
        self.db.add(request)
        self.db.commit()
        row = self.submit(linked={"object_type": "request", "object_id": "50"})
        self.assertEqual(row.source_request_author_id, 99)
        self.assertEqual(service.list_reviews(self.db, actor(99, team=88, scope="none"))["total"], 1)
        self.assertEqual(service.list_reviews(self.db, actor(98, team=88, scope="none"))["total"], 0)

    def test_structured_request_change_and_task_requirement_link_change_invalidate_context(self):
        request = RequirementRequest(id=51, title="Запрос", description="Текст", team_id=10, user_id=99, draft={"br": "A"})
        self.db.add(request)
        self.db.commit()
        row = self.submit(linked={"object_type": "request", "object_id": "51"})
        request.draft = {"br": "B"}
        self.db.commit()
        self.assertTrue(service.serialize_review(row, self.reviewer, self.db)["context_changed"])
        self.expect_error("source_context_changed", lambda: self.submit(linked={"object_type": "request", "object_id": "51"}))
        task, _, linked = self.task_source()
        task_review = self.submit(artifact(artifact_id="br-task"), key="task", linked=linked)
        task.link_requirements = ["#/review/10?revision=1"]
        self.db.commit()
        self.assertTrue(service.serialize_review(task_review, self.reviewer, self.db)["context_changed"])

    def test_session_and_document_target_mismatch_rejected(self):
        _, _, linked = self.task_source()
        draft = artifact(linked_object={"object_type": "request", "object_id": "30"})
        self.expect_error("linked_object_conflict", lambda: self.submit(draft, linked=linked))

    def test_stale_linked_structured_fields_rejected_on_submission(self):
        request = RequirementRequest(id=51, title="Запрос", description="Текст", team_id=10, user_id=99, draft={"br": "B"})
        self.db.add(request)
        self.db.commit()
        self.expect_error("source_context_changed", lambda: self.submit(linked={"object_type": "request", "object_id": "51", "fields": {"requirement_draft": {"br": "A"}}}))

    def test_mutations_refresh_and_lock_source_before_review(self):
        _, _, linked = self.task_source()
        calls = []
        original_lock = Query.with_for_update
        original_refresh = Query.populate_existing
        def capture_lock(query, *args, **kwargs):
            calls.append(("lock", query.column_descriptions[0]["entity"].__name__))
            return original_lock(query, *args, **kwargs)
        def capture_refresh(query, *args, **kwargs):
            calls.append(("refresh", query.column_descriptions[0]["entity"].__name__))
            return original_refresh(query, *args, **kwargs)
        with patch.object(Query, "with_for_update", capture_lock), patch.object(Query, "populate_existing", capture_refresh):
            row = self.submit(linked=linked)
            self.assertEqual([item for item in calls if item[0] == "lock"], [("lock", "Task"), ("lock", "RequirementReview")])
            self.assertLess(calls.index(("refresh", "Task")), calls.index(("lock", "Task")))
            calls.clear()
            self.action(row, "claim")
            self.assertEqual([item for item in calls if item[0] == "lock"], [("lock", "Task"), ("lock", "RequirementReview")])
            self.assertLess(calls.index(("refresh", "RequirementReview")), calls.index(("lock", "RequirementReview")))

    def test_source_refresh_observes_external_change_after_gateway_pre_read(self):
        task, _, linked = self.task_source()
        # Keep the source in this Session identity map, then change its ordinary
        # content through another Session. Submission must not use stale fields.
        other = sessionmaker(bind=self.engine)()
        try:
            other.execute(sa.update(Task).where(Task.id == task.id).values(description="Изменено другим аналитиком"))
            other.commit()
        finally:
            other.close()
        self.assertEqual(task.description, "Исходное описание")
        self.expect_error("source_context_changed", lambda: self.submit(linked=linked))
        self.assertEqual(task.description, "Изменено другим аналитиком")

    def test_decision_refresh_observes_external_source_change(self):
        task, _, linked = self.task_source()
        row = self.submit(linked=linked)
        self.action(row, "claim")
        other = sessionmaker(bind=self.engine)()
        try:
            other.execute(sa.update(Task).where(Task.id == task.id).values(description="Изменено перед решением"))
            other.commit()
        finally:
            other.close()
        self.assertEqual(task.description, "Исходное описание")
        self.expect_error("source_context_changed", lambda: self.action(row, "approve"))

    def test_snapshot_orm_reassignment_rejected(self):
        row = self.submit()
        row.artifact_snapshot = {"changed": True}
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.db.flush()
        self.db.rollback()

    def test_database_constraint_prevents_multiple_active_artifacts(self):
        row = self.submit()
        values = {column.name: getattr(row, column.name) for column in RequirementReview.__table__.columns if column.name not in {"id", "created_at", "updated_at"}}
        values["idempotency_key"] = "another"
        self.db.add(RequirementReview(**values))
        with self.assertRaises(sa.exc.IntegrityError):
            self.db.flush()
        self.db.rollback()

    def test_migration_has_single_head_and_only_new_table_ddl(self):
        import io
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        path = ROOT / "alembic" / "versions" / "a6d2f8c0b431_requirement_reviews.py"
        spec = importlib.util.spec_from_file_location("review_migration_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        buffer = io.StringIO()
        ctx = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer})
        with Operations.context(ctx):
            module.upgrade()
        sql = buffer.getvalue()
        self.assertIn("CREATE TABLE requirement_reviews", sql)
        self.assertNotIn("INSERT INTO", sql)
        self.assertNotIn("UPDATE ", sql)
        self.assertNotIn("DELETE FROM", sql)
        revisions, parents = set(), set()
        for item in path.parent.glob("*.py"):
            for node in ast.parse(item.read_text(encoding="utf-8-sig")).body:
                name = node.target.id if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) else node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else None
                if name in {"revision", "down_revision"}:
                    value = ast.literal_eval(node.value)
                    (revisions if name == "revision" else parents).add(value)
        self.assertEqual(revisions - parents, {"a6d2f8c0b431"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
