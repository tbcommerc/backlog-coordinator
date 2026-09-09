from datetime import datetime, timezone

from models import Task
from routers.express_router import _task_to_response, task_to_quick_estimate_response


def test_quick_estimate_response_normalizes_legacy_null_progress():
    now = datetime.now(timezone.utc)
    task = Task(
        id=42,
        public_id="TASK-000-042",
        team_id=1,
        title="Legacy quick estimate task",
        progress=None,
        created_at=now,
        updated_at=now,
    )

    response = task_to_quick_estimate_response(task, [])

    assert response.progress == 0


def test_backlog_import_response_normalizes_legacy_null_progress():
    now = datetime.now(timezone.utc)
    task = Task(
        id=43,
        public_id="TASK-000-043",
        team_id=1,
        title="Legacy backlog task",
        progress=None,
        created_at=now,
        updated_at=now,
    )

    response = _task_to_response(task)

    assert response.progress == 0
