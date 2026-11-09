"""A factor tool rescores the same kernel without model/retrieval side effects."""
import datetime as dt
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from value_priority_assessor.core import service
from value_priority_assessor.core.models import Task, FactorAssessment, PriorityHistory
from value_priority_assessor.core.references import ReferenceBundle
from value_priority_assessor.core.scoring import ScoringContext, score_task


@pytest.mark.parametrize("manual", [0.0, 1.5, 20.0])
def test_factor_rescore_preserves_value_and_uses_existing_formula(monkeypatch, manual):
    engine = create_engine("sqlite://")
    for table in (Task.__table__, FactorAssessment.__table__, PriorityHistory.__table__):
        table.create(engine)
    # Read-only configuration objects; no reference rows or protected seed.
    references = ReferenceBundle(None)
    monkeypatch.setattr(service, "ReferenceBundle", lambda _: references)
    def forbidden(*_, **__):
        raise AssertionError("Factor-only rescore must not load a model or retrieval")
    for name in ("get_adapter", "get_strategy_analyst", "get_dependency_analyst", "AnalogyIndex", "_prepare_task"):
        monkeypatch.setattr(service, name, forbidden)
    with Session(engine) as session:
        task = Task(task_key="SYNTHETIC", title="Synthetic", team_class="serving", value_manual_mln=manual,
                    value_internal_mln=manual, value_source="manual", cost_rub=10, cost_to_value=0.1,
                    effort_man_days=3, strategy_fit_raw=7, dependency_score=0.8)
        session.add(task)
        session.flush()
        today = dt.date(2026, 11, 2)
        expected = score_task(task, references, ScoringContext.from_tasks([task], today=today))
        service.recompute_factor_priority(session, task, today=today)
        assert task.priority == expected.priority and task.priority_score == expected.score
        assert task.factor_scores == expected.factors
        assert (task.value_manual_mln, task.value_internal_mln, task.value_source, task.cost_rub) == (manual, manual, "manual", 10)
    engine.dispose()
