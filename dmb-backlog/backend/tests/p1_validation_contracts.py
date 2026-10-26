"""P1 regressions without database connections or protected test records.
Run from repository root: .venv/Scripts/python.exe -B dmb-backlog/backend/tests/p1_validation_contracts.py
"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as Obj
from unittest.mock import Mock, patch
from contextlib import nullcontext

os.environ.update(DATABASE_URL="sqlite:///:memory:", RUN_STARTUP_SEED="false",
                  RUN_STARTUP_MAINTENANCE="false", RUN_NOTIFICATION_SCHEDULER="false")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pydantic import ValidationError
from schemas import BulkActionRequest
import import_service as service


class BulkContracts(unittest.TestCase):
    def test_invalid_values_rejected_for_both_payload_names(self):
        invalid = [
            {"progress": 101}, {"progress": -1}, {"progress": 1.5},
            {"progress": None}, {"progress": True}, {"progress": "bad"},
            {"effort_days": 10001}, {"effort_rub": -1},
            {"financial_effect": float("inf")}, {"financial_effect": float("nan")},
            {"date_received": "2026-02-30"}, {"team_id": None},
            {"link_mockups": "javascript:alert(1)"},
            {"directorate_status": "x" * 1001}, {"unknown_field": 1},
            {"tags_add": ["x"] * 51}, {"tags_remove": ["x" * 101]},
        ]
        for key in ("fields", "updates"):
            for fields in invalid:
                with self.subTest(key=key, fields=fields), self.assertRaises(ValidationError):
                    BulkActionRequest(action="update", task_ids=[1, 2], **{key: fields})

    def test_valid_boundaries_and_normalization(self):
        for value in (0, 100, "75"):
            request = BulkActionRequest(action="update", task_ids=[1],
                updates={"progress": value, "date_received": "2026-10-17",
                         "effort_days": "10000", "link_jira": "https://example.test/A"})
            self.assertEqual(request.fields["progress"], int(value))
            self.assertEqual(request.fields["date_received"].isoformat(), "2026-10-17")
            self.assertEqual(request.fields["effort_days"], 10000)
            self.assertEqual(request.fields["link_jira"], ["https://example.test/A"])
            self.assertIsNone(request.updates)
            self.assertNotIn("version", request.fields)
            self.assertNotIn("tags_add", request.fields)

    def test_ambiguous_payload_is_rejected(self):
        with self.assertRaises(ValidationError):
            BulkActionRequest(action="update", task_ids=[1], fields={"progress": 0},
                              updates={"progress": 101})

    def test_missing_reference_rejects_entire_batch_before_changes(self):
        from fastapi import HTTPException
        import importlib
        routes = importlib.import_module('routers.tasks_router')
        for field in routes.BULK_REFERENCE_MODELS:
            with self.subTest(field=field):
                tasks = [Obj(id=1, version=1, team_id=7, progress=0),
                         Obj(id=2, version=1, team_id=7, progress=0)]
                db = Mock()
                db.query.return_value.filter.return_value.first.return_value = None
                request = BulkActionRequest(action='update', task_ids=[1, 2],
                    versions={1: 1, 2: 1}, fields={field: 999, 'progress': 25})
                with patch.object(routes, '_load_bulk_tasks', return_value=([1, 2], tasks)), \
                     patch.object(routes, 'require_bulk_task_edit_access'), \
                     self.assertRaises(HTTPException) as error:
                    routes.bulk_action(request, db, Obj(id=1))
                self.assertEqual(error.exception.status_code, 422)
                self.assertEqual([task.progress for task in tasks], [0, 0])
                db.add.assert_not_called()
                db.commit.assert_not_called()

    def test_http_invalid_bulk_never_reaches_orm(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from sqlalchemy.engine import Engine
        from database import get_db
        from auth import get_current_user, require_backlog_page_access
        from routers.tasks_router import router
        db = Mock()
        app = FastAPI()
        app.include_router(router, prefix="/tasks")
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: Obj(id=1)
        app.dependency_overrides[require_backlog_page_access] = lambda: None
        with patch.object(Engine, "connect", side_effect=AssertionError("No database")), TestClient(app) as client:
            for endpoint in ("/tasks/bulk", "/tasks/bulk/preview"):
                for key in ("fields", "updates"):
                    response = client.post(endpoint, json={
                        "action": "update", "task_ids": [1, 2], "versions": {"1": 1, "2": 1},
                        key: {"progress": 101, "financial_effect": 10}})
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertIn("Прогресс", response.text)
                    self.assertEqual(db.mock_calls, [])


class ImportContracts(unittest.TestCase):
    def test_encodings_blank_prefix_multiline_and_delimiter(self):
        text = '\r\n  \r\ntitle;team_id;description\r\nТест;Команда;"строка1\r\nстрока2"\r\n'
        expected = [{"title": "Тест", "team_id": "Команда", "description": "строка1\r\nстрока2"}]
        for encoding in ("utf-8-sig", "cp1251", "utf-16"):
            with self.subTest(encoding=encoding):
                content = service.decode_content(text.encode(encoding))
                self.assertEqual(service.detect_delimiter(content), ";")
                self.assertEqual(service.parse_csv(content, service.detect_delimiter(content)), expected)
        content = service.decode_content(b"\xfe\xff" + text.encode("utf-16be"))
        self.assertEqual(service.parse_csv(content, service.detect_delimiter(content)), expected)
        comma = 'title,team_id,"notes;extra"\nOne,Team,value'
        self.assertEqual(service.detect_delimiter(comma), ",")
        self.assertEqual(service.parse_csv(comma, ",")[0]["title"], "One")

    def test_malformed_csv_is_a_validation_error(self):
        with self.assertRaises(ValueError):
            service.parse_csv('title;team_id\n"broken', ';')

    def test_utf16_without_bom_is_rejected(self):
        with self.assertRaises(ValueError):
            service.decode_content("title;team_id\nOne;Team".encode("utf-16le"))

    def test_blank_data_rows_match_preview(self):
        rows = service.parse_csv("title;team_id\n ; \nOne;Team\n", ";")
        self.assertEqual(rows, [{"title": "One", "team_id": "Team"}])

    def run_import(self, fail_commit):
        db = Mock()
        db.begin_nested.side_effect = lambda: nullcontext()
        if fail_commit:
            db.commit.side_effect = RuntimeError("synthetic commit failure")
        with patch.object(service, "build_field_map", return_value=({}, {}, [])), \
             patch.object(service, "load_reference_indexes", return_value={}), \
             patch.object(service, "process_row", side_effect=[(Obj(id=11, link_jira=[]), []), (None, []),
                                                               (Obj(id=13, link_jira=[]), [])]), \
             patch.object(service, "persist_task") as persist:
            result = service.import_tasks_from_csv(db, b"title;team_id\nA;T\nB;T\nC;T", Obj(id=1))
        self.assertEqual(persist.call_count, 2)
        self.assertEqual(result["total"], result["created"] + result["skipped"])
        return result, db

    def test_commit_failure_counts_every_row_as_skipped(self):
        result, db = self.run_import(True)
        self.assertEqual((result["created"], result["skipped"], result["task_ids"]), (0, 3, []))
        self.assertIsNone(result["errors"][-1]["row"])
        db.rollback.assert_called_once()

    def test_partial_success_keeps_only_persisted_ids(self):
        result, db = self.run_import(False)
        self.assertEqual((result["created"], result["skipped"], result["task_ids"]), (2, 1, [11, 13]))
        db.rollback.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
