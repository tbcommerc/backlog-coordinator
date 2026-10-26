"""In-memory transaction-path probe for import_tasks_from_csv."""
from __future__ import annotations

import contextlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path.cwd()
sys.path.insert(0, str(ROOT / "dmb-backlog" / "backend"))
import import_service  # noqa: E402


EVIDENCE = ROOT / "docs" / "dev-testing" / "evidence" / "import-testing-2026-09-20"


class FakeDb:
    def __init__(self, fail_commit=False):
        self.fail_commit = fail_commit
        self.rolled_back = False

    @contextlib.contextmanager
    def begin_nested(self):
        yield

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("synthetic commit failure")

    def rollback(self):
        self.rolled_back = True


def scenario(name, *, process_fail_rows=(), persist_fail_rows=(), fail_commit=False):
    originals = {
        "build_field_map": import_service.build_field_map,
        "load_reference_indexes": import_service.load_reference_indexes,
        "process_row": import_service.process_row,
        "persist_task": import_service.persist_task,
    }
    row_counter = {"value": 0}

    import_service.build_field_map = lambda _db: ({}, {}, {"title", "team_id"})
    import_service.load_reference_indexes = lambda _db: {}

    def fake_process(row_num, *_args, **_kwargs):
        row_counter["value"] += 1
        if row_num in process_fail_rows:
            raise RuntimeError(f"synthetic process failure row {row_num}")
        return SimpleNamespace(id=row_num, link_jira=[]), []

    def fake_persist(_db, task, *_args, **_kwargs):
        if task.id in persist_fail_rows:
            raise RuntimeError(f"synthetic persist failure row {task.id}")

    import_service.process_row = fake_process
    import_service.persist_task = fake_persist
    db = FakeDb(fail_commit=fail_commit)
    try:
        result = import_service.import_tasks_from_csv(
            db,
            b"a,b\n1,2\n3,4\n",
            SimpleNamespace(id=101),
        )
        return {"scenario": name, "result": result, "rolled_back": db.rolled_back}
    finally:
        for key, value in originals.items():
            setattr(import_service, key, value)


results = [
    scenario("all_success"),
    scenario("row_processing_failure_then_success", process_fail_rows={2}),
    scenario("row_persistence_failure_then_success", persist_fail_rows={2}),
    scenario("final_commit_failure", fail_commit=True),
]

output = EVIDENCE / "transaction-probe-results.json"
output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False, indent=2))
