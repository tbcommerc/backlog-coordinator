"""Read-only probe of task import router guards with no database writes."""
from __future__ import annotations

import io
import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, UploadFile


ROOT = Path.cwd()
BACKEND = ROOT / "dmb-backlog" / "backend"
sys.path.insert(0, str(BACKEND))

tasks_router = importlib.import_module("routers.tasks_router")  # noqa: E402
import import_service  # noqa: E402


EVIDENCE = ROOT / "docs" / "dev-testing" / "evidence" / "import-testing-2026-09-20"


class FakeDb:
    def __init__(self):
        self.rolled_back = False

    def rollback(self):
        self.rolled_back = True


def upload(name, data):
    return UploadFile(filename=name, file=io.BytesIO(data))


def run_case(name, filename, data, *, allowed=True, service="ok"):
    db = FakeDb()
    user = SimpleNamespace(id=101)
    original_permission = tasks_router.check_permission
    original_service = import_service.import_tasks_from_csv
    called = {"service": False, "bytes": None}

    def fake_service(_db, content, _user):
        called["service"] = True
        called["bytes"] = len(content)
        if service == "value_error":
            raise ValueError("synthetic validation")
        if service == "runtime_error":
            raise RuntimeError("synthetic failure")
        return {"total": 0, "created": 0, "skipped": 0, "errors": [], "task_ids": []}

    tasks_router.check_permission = lambda *_args, **_kwargs: allowed
    import_service.import_tasks_from_csv = fake_service
    try:
        result = tasks_router.import_tasks(upload(filename, data), db, user)
        return {"case": name, "status": 200, "result": result, "service_called": called["service"], "service_bytes": called["bytes"], "rolled_back": db.rolled_back}
    except HTTPException as exc:
        return {"case": name, "status": exc.status_code, "detail": exc.detail, "service_called": called["service"], "service_bytes": called["bytes"], "rolled_back": db.rolled_back}
    finally:
        tasks_router.check_permission = original_permission
        import_service.import_tasks_from_csv = original_service


cases = [
    run_case("missing_filename", None, b"title,team_id\n"),
    run_case("wrong_extension", "tasks.xlsx", b"not csv"),
    run_case("uppercase_extension", "TASKS.CSV", b"title,team_id\n"),
    run_case("permission_denied", "tasks.csv", b"title,team_id\n", allowed=False),
    run_case("wrong_extension_before_permission", "tasks.xlsx", b"x", allowed=False),
    run_case("empty", "tasks.csv", b""),
    run_case("exactly_10mb", "tasks.csv", b"x" * (10 * 1024 * 1024)),
    run_case("over_10mb", "tasks.csv", b"x" * (10 * 1024 * 1024 + 1)),
    run_case("service_value_error", "tasks.csv", b"x", service="value_error"),
    run_case("service_runtime_error", "tasks.csv", b"x", service="runtime_error"),
]

output = EVIDENCE / "route-probe-results.json"
output.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(cases, ensure_ascii=False, indent=2))
