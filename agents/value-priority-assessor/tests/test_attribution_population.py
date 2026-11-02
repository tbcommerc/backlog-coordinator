import pytest

from value_priority_assessor.core import attribution
from value_priority_assessor.core.attribution import AttributionError, run_attribution
from value_priority_assessor.core.models import Task


class _References:
    def __init__(self, _session):
        pass

    @staticmethod
    def team_class(team):
        return "earning" if team == "Front" else "serving"


def _task(key, team, value):
    return Task(
        task_key=key,
        team=team,
        status="ВЫПОЛНЕНА",
        value_internal_mln=value,
        raw={},
        factor_scores={},
        factor_contributions={},
        applied_overrides=[],
        value_inputs={},
    )


def test_attribution_uses_only_explicit_population(session, monkeypatch):
    monkeypatch.setattr(attribution, "ReferenceBundle", _References)
    selected_front = _task("FRONT-1", "Front", 100.0)
    selected_service = _task("SERVICE-1", "Platform", 50.0)
    excluded_service = _task("SERVICE-OLD", "Platform", 500.0)
    session.add_all([selected_front, selected_service, excluded_service])
    session.flush()

    result = run_attribution(
        session,
        period="3Q 2026",
        front_actual_revenue_mln=1000.0,
        task_keys=["FRONT-1", "SERVICE-1"],
    )

    assert result["population_task_keys"] == ["FRONT-1", "SERVICE-1"]
    assert result["population_size"] == 2
    assert selected_service.value_external_mln == 900.0
    assert excluded_service.value_external_mln is None


def test_attribution_rejects_missing_or_duplicate_population(session):
    with pytest.raises(AttributionError, match="непустую выборку"):
        run_attribution(session, "3Q 2026", 1000.0, task_keys=[])

    with pytest.raises(AttributionError, match="дубликаты"):
        run_attribution(
            session,
            "3Q 2026",
            1000.0,
            task_keys=["TASK-1", "TASK-1"],
        )


def test_attribution_rejects_unknown_task(session, monkeypatch):
    monkeypatch.setattr(attribution, "ReferenceBundle", _References)

    with pytest.raises(AttributionError, match="не найдены"):
        run_attribution(
            session,
            "3Q 2026",
            1000.0,
            task_keys=["TASK-DOES-NOT-EXIST"],
        )
