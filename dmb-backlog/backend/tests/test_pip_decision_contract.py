from pathlib import Path
import pytest
from pydantic import ValidationError

from routers.tasks_router import PIP_TARGET_STATUSES
from schemas import PipDecisionRequest


def test_pip_accept_allows_optional_comment():
    payload = PipDecisionRequest(decision="accept", version=4, reason="  Берём в PI  ")

    assert payload.reason == "Берём в PI"


@pytest.mark.parametrize("decision", ["rework", "reject"])
def test_pip_non_accept_decisions_require_reason(decision):
    with pytest.raises(ValidationError):
        PipDecisionRequest(decision=decision, version=4, reason="   ")


def test_pip_rework_returns_task_to_express_estimate():
    payload = PipDecisionRequest(decision="rework", version=4, reason="Уточнить оценку FE")

    assert payload.reason == "Уточнить оценку FE"
    assert PIP_TARGET_STATUSES[payload.decision] == "ЭКСПРЕСС-ОЦЕНКА"


def test_pip_report_exposes_task_version_for_optimistic_locking():
    source = Path(__file__).parents[1].joinpath("routers", "reports_router.py").read_text(encoding="utf-8")

    assert '"version": task.version or 0' in source


def test_pip_decision_is_a_single_structured_history_event():
    source = Path(__file__).parents[1].joinpath("routers", "tasks_router.py").read_text(encoding="utf-8")

    assert 'field_name="pip_decision"' in source
    assert '"decision": payload.decision' in source
    assert 'notify_pip_decision(' not in source
