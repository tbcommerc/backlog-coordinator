from pathlib import Path

from schemas import PipDecisionContext
from services.pip_decisions import parse_pip_decision


def test_structured_rework_context_preserves_reason():
    parsed = parse_pip_decision(
        '{"decision":"rework","reason":"  Уточнить оценку интеграции  "}'
    )

    assert parsed == {
        "decision": "rework",
        "reason": "Уточнить оценку интеграции",
    }
    assert PipDecisionContext(**parsed).decision == "rework"


def test_malformed_or_unknown_pip_decision_is_ignored():
    assert parse_pip_decision("not-json") is None
    assert parse_pip_decision('{"decision":"postpone"}') is None
    assert parse_pip_decision('["rework"]') is None


def test_task_lists_load_latest_decisions_in_one_batch():
    root = Path(__file__).parents[1]
    service = root.joinpath("services", "pip_decisions.py").read_text(encoding="utf-8")
    tasks_router = root.joinpath("routers", "tasks_router.py").read_text(encoding="utf-8")
    express_router = root.joinpath("routers", "express_router.py").read_text(encoding="utf-8")

    assert "func.row_number().over(" in service
    assert 'TaskHistory.field_name == "pip_decision"' in service
    assert "load_latest_pip_decisions(db, (task.id for task in tasks))" in tasks_router
    assert "load_latest_pip_decisions(db, (task.id for task in tasks))" in express_router
    assert "latest_pip_decision=pip_decision_context" in tasks_router
    assert "latest_pip_decision=pip_decision_context" in express_router
