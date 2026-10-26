from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from models import Task
from routers.express_router import (
    EXPRESS_IMPORT_ELIGIBLE_STATUS_NAMES,
    _build_quick_estimate_readiness,
    _assert_quick_estimate_ready,
    _is_express_import_status_eligible,
    _task_to_response,
    task_to_quick_estimate_response,
)


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


@pytest.mark.parametrize("status_name", EXPRESS_IMPORT_ELIGIBLE_STATUS_NAMES)
def test_express_import_accepts_only_preparation_statuses(status_name):
    assert _is_express_import_status_eligible(status_name)
    assert _is_express_import_status_eligible(f"  {status_name.lower()}  ")


@pytest.mark.parametrize(
    "status_name",
    [
        None,
        "",
        "ЭКСПРЕСС-ОЦЕНКА",
        "ПРИНЯТИЕ РЕШЕНИЯ",
        "ПРИНЯТА В РАБОТУ",
        "ЭСКАЛАЦИЯ НА ЛТ",
        "ХОЛД",
        "ОТКЛОНЕНА",
        "НЕ АКТУАЛЬНА",
        "ВЫПОЛНЕНА",
    ],
)
def test_express_import_rejects_non_preparation_and_terminal_statuses(status_name):
    assert not _is_express_import_status_eligible(status_name)


def _estimate_item(item_id, title, **effort):
    values = {field: None for field in (
        "effort_designee",
        "effort_analytics",
        "effort_be",
        "effort_python_be",
        "effort_fe",
        "effort_test",
        "effort_test_auto",
        "effort_delivery",
    )}
    values.update(effort)
    return SimpleNamespace(id=item_id, title=title, **values)


def test_quick_estimate_readiness_requires_task_decomposition():
    task = SimpleNamespace(id=1, public_id="TASK-000-001", title="Без декомпозиции")

    readiness = _build_quick_estimate_readiness([task], {})

    assert readiness.ready is False
    assert readiness.ready_tasks == 0
    assert readiness.total_blockers == 1
    assert readiness.blocking_tasks[0].blockers[0].code == "missing_decomposition"


def test_quick_estimate_readiness_accepts_positive_terminal_epic_effort():
    task = SimpleNamespace(id=2, public_id="TASK-000-002", title="Готовая задача")
    epic = _estimate_item(20, "Оценённый эпик", effort_analytics=2.5)
    epic._stories = []

    readiness = _build_quick_estimate_readiness([task], {task.id: [epic]})

    assert readiness.ready is True
    assert readiness.ready_tasks == 1
    assert readiness.total_blockers == 0


def test_quick_estimate_readiness_checks_each_story_not_only_task_total():
    task = SimpleNamespace(id=3, public_id="TASK-000-003", title="Частичная оценка")
    epic = _estimate_item(30, "Эпик с историями")
    epic._stories = [
        _estimate_item(31, "Готовая история", effort_fe=1),
        _estimate_item(32, "История без оценки"),
    ]

    readiness = _build_quick_estimate_readiness([task], {task.id: [epic]})

    assert readiness.ready is False
    assert readiness.total_blockers == 1
    blocker = readiness.blocking_tasks[0].blockers[0]
    assert blocker.entity_type == "story"
    assert blocker.entity_id == 32
    assert blocker.code == "missing_effort"


def test_quick_estimate_readiness_rejects_negative_effort():
    task = SimpleNamespace(id=4, public_id="TASK-000-004", title="Некорректная оценка")
    epic = _estimate_item(40, "Эпик", effort_be=-1, effort_fe=3)
    epic._stories = []

    readiness = _build_quick_estimate_readiness([task], {task.id: [epic]})

    assert readiness.ready is False
    assert readiness.blocking_tasks[0].blockers[0].code == "invalid_effort"


def test_quick_estimate_completion_guard_returns_structured_conflict():
    task = SimpleNamespace(id=5, public_id="TASK-000-005", title="Не готова")
    readiness = _build_quick_estimate_readiness([task], {})

    with pytest.raises(HTTPException) as error:
        _assert_quick_estimate_ready(readiness)

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "quick_estimate_incomplete"
    assert error.value.detail["blocking_tasks"][0]["task_id"] == 5
