"""Оценка факторов F5 и F6 субагентами: рубрика, хранение, влияние на приоритет."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.models import FactorAssessment
from app.core.references import ReferenceBundle, ReferenceError, save_reference
from app.core.scoring import ScoringContext, factor_dependencies, factor_strategy_fit
from app.strategy.analysts import (
    AgentDependencyAnalyst,
    AgentStrategyAnalyst,
    DeclaredDependencyAnalyst,
    StubStrategyAnalyst,
)
from app.strategy.rubric import (
    FACTOR_DEPENDENCIES,
    FACTOR_STRATEGY,
    RubricError,
    score_dependencies,
    score_strategy,
    validate_strategy_rubric,
)
from app.strategy.store import get_active, hydrate_task, save_dependencies, save_strategy
from tests.conftest import make_task

FULL_ANSWERS = {
    "strategic_theme": "direct",
    "revenue_link": "direct",
    "client_impact": "core",
    "platform_leverage": "platform",
    "mandate_fit": "core",
}


class TestStrategyRubric:
    def test_all_top_answers_give_maximum(self, refs):
        result = score_strategy(FULL_ANSWERS, refs.strategy_rubric)
        assert result.normalised == pytest.approx(1.0)
        assert result.raw_score == pytest.approx(10.0)

    def test_all_bottom_answers_give_minimum(self, refs):
        answers = {
            "strategic_theme": "none",
            "revenue_link": "none",
            "client_impact": "none",
            "platform_leverage": "one_off",
            "mandate_fit": "foreign",
        }
        result = score_strategy(answers, refs.strategy_rubric)
        assert result.raw_score < 2.0

    def test_breakdown_explains_every_criterion(self, refs):
        """Оценку должно быть можно оспорить по пунктам, а не только целиком."""
        result = score_strategy(FULL_ANSWERS, refs.strategy_rubric)
        assert len(result.breakdown) == 5
        assert all("contribution" in row for row in result.breakdown)
        assert sum(row["contribution"] for row in result.breakdown) == pytest.approx(
            result.normalised, abs=1e-6
        )

    def test_missing_criterion_is_rejected(self, refs):
        """Пропущенный критерий — ошибка, а не повод подставить середину."""
        answers = dict(FULL_ANSWERS)
        answers.pop("revenue_link")
        with pytest.raises(RubricError, match="не отвечен"):
            score_strategy(answers, refs.strategy_rubric)

    def test_invalid_option_is_rejected(self, refs):
        answers = dict(FULL_ANSWERS, strategic_theme="выдумка")
        with pytest.raises(RubricError, match="недопустимый ответ"):
            score_strategy(answers, refs.strategy_rubric)

    def test_unknown_criterion_is_rejected(self, refs):
        answers = dict(FULL_ANSWERS, изобретённый_критерий="direct")
        with pytest.raises(RubricError, match="неизвестные критерии"):
            score_strategy(answers, refs.strategy_rubric)

    def test_confidence_follows_evidence(self, refs):
        """Оценка без опоры на источники не должна выглядеть уверенной."""
        rubric = refs.strategy_rubric
        assert score_strategy(FULL_ANSWERS, rubric, evidence=[]).confidence == "low"
        assert score_strategy(FULL_ANSWERS, rubric, evidence=["a"]).confidence == "medium"
        assert score_strategy(FULL_ANSWERS, rubric, evidence=["a", "b"]).confidence == "high"

    def test_weights_must_sum_to_one(self, refs):
        validate_strategy_rubric(refs.strategy_rubric)
        broken = {"strategy_fit": {"criteria": [{"id": "a", "weight": 0.4}]}}
        with pytest.raises(RubricError, match="сумма весов"):
            validate_strategy_rubric(broken)

    def test_reference_save_validates_rubric(self, session):
        broken = {"strategy_fit": {"criteria": [{"id": "a", "weight": 0.4}]}}
        with pytest.raises(ReferenceError, match="сумма весов"):
            save_reference(session, "strategy_rubric", broken, actor="test")


class TestDependencyRubric:
    def test_empty_list_is_a_valid_answer(self, refs):
        """Самодостаточная задача не должна получать выдуманные зависимости."""
        result = score_dependencies([], refs.strategy_rubric)
        assert result.score == 1.0
        assert result.blocking_count == 0

    def test_blocking_costs_more_than_coordination(self, refs):
        """Ради этого различия фактор и перенесли внутрь проекта."""
        rubric = refs.strategy_rubric
        blocking = score_dependencies([{"team": "AI", "type": "blocking"}], rubric)
        coordination = score_dependencies([{"team": "AI", "type": "coordination"}], rubric)
        informational = score_dependencies([{"team": "AI", "type": "informational"}], rubric)

        assert blocking.score < coordination.score < informational.score

    def test_one_blocking_beats_three_informational(self, refs):
        """Прежняя формула по счётчику команд давала обратный, неверный порядок."""
        rubric = refs.strategy_rubric
        one_blocking = score_dependencies([{"team": "AI", "type": "blocking"}], rubric)
        three_light = score_dependencies(
            [
                {"team": "AI", "type": "informational"},
                {"team": "Core", "type": "informational"},
                {"team": "Delivery", "type": "informational"},
            ],
            rubric,
        )
        assert one_blocking.score < three_light.score

    def test_score_has_a_floor(self, refs):
        teams = [{"team": f"Команда {i}", "type": "blocking"} for i in range(10)]
        assert score_dependencies(teams, refs.strategy_rubric).score == 0.2

    def test_invalid_type_is_rejected(self, refs):
        with pytest.raises(RubricError, match="недопустимый тип"):
            score_dependencies([{"team": "AI", "type": "какой-то"}], refs.strategy_rubric)

    def test_team_is_required(self, refs):
        with pytest.raises(RubricError, match="не указана команда"):
            score_dependencies([{"type": "blocking"}], refs.strategy_rubric)


class TestAnalysts:
    def test_stub_is_deterministic(self, refs):
        analyst = StubStrategyAnalyst()
        first = analyst.assess("Доработка воронки сделок", "IB", refs.strategy_rubric)
        second = analyst.assess("Доработка воронки сделок", "IB", refs.strategy_rubric)
        assert first.raw_score == second.raw_score

    def test_stub_fills_the_whole_rubric(self, refs):
        result = StubStrategyAnalyst().assess("Витрина отчётности", "Core", refs.strategy_rubric)
        assert len(result.answers) == 5

    def test_declared_analyst_reads_backlog_attribute(self, refs):
        result = DeclaredDependencyAnalyst().assess(
            "Задача", "Pre-Trade", "AI, Core", refs.team_names, refs.strategy_rubric
        )
        assert {t["team"] for t in result.teams} == {"AI", "Core"}
        # Тип связи в бэклоге не указан — принимаем осторожное «согласование».
        assert all(t["type"] == "coordination" for t in result.teams)

    def test_declared_analyst_excludes_the_executor(self, refs):
        result = DeclaredDependencyAnalyst().assess(
            "Задача", "AI", "AI, Core", refs.team_names, refs.strategy_rubric
        )
        assert {t["team"] for t in result.teams} == {"Core"}

    def test_agent_analyst_uses_the_adapter(self, refs):
        from app.llm.mock import MockAdapter

        analyst = AgentStrategyAnalyst(MockAdapter(), use_rag=False)
        result = analyst.assess("Доработка платформы лидов", "Pre-Trade", refs.strategy_rubric)
        assert 1.0 <= result.raw_score <= 10.0
        assert len(result.answers) == 5

    def test_agent_dependency_analyst_returns_empty_on_mock(self, refs):
        """Мок не выдумывает зависимостей — он не может знать, кто что поставляет."""
        from app.llm.mock import MockAdapter

        analyst = AgentDependencyAnalyst(MockAdapter(), use_rag=False)
        result = analyst.assess(
            "Задача", "Core", None, refs.team_names, refs.strategy_rubric
        )
        assert result.teams == []


class TestStore:
    def test_assessment_is_persisted_with_provenance(self, session, refs):
        task = make_task()
        session.add(task)
        session.flush()

        assessment = score_strategy(
            FULL_ANSWERS, refs.strategy_rubric, rationale="потому что", evidence=["k3:1"]
        )
        save_strategy(session, task, assessment, provider="agent", actor="strategy-analyst",
                      model="test-model")
        session.flush()

        row = get_active(session, task.id, FACTOR_STRATEGY)
        assert row.provider == "agent"
        assert row.actor == "strategy-analyst"
        assert row.model == "test-model"
        assert row.rationale == "потому что"
        assert row.evidence == ["k3:1"]
        assert row.payload["breakdown"]

    def test_new_assessment_supersedes_the_previous(self, session, refs):
        """История суждений сохраняется: активна всегда одна оценка."""
        task = make_task()
        session.add(task)
        session.flush()

        for theme in ("none", "direct"):
            save_strategy(
                session,
                task,
                score_strategy(dict(FULL_ANSWERS, strategic_theme=theme), refs.strategy_rubric),
                provider="agent",
            )
            session.flush()

        rows = session.scalars(
            select(FactorAssessment).where(FactorAssessment.task_id == task.id)
        ).all()
        assert len(rows) == 2
        assert sum(1 for r in rows if r.is_active) == 1
        assert get_active(session, task.id, FACTOR_STRATEGY).payload["answers"][
            "strategic_theme"
        ] == "direct"

    def test_hydrate_restores_both_factors(self, session, refs):
        task = make_task()
        session.add(task)
        session.flush()

        save_strategy(session, task, score_strategy(FULL_ANSWERS, refs.strategy_rubric),
                      provider="agent")
        save_dependencies(
            session,
            task,
            score_dependencies([{"team": "AI", "type": "blocking"}], refs.strategy_rubric),
            provider="agent",
        )
        session.flush()

        task.strategy_fit_raw = None
        task.dependency_score = None
        hydrate_task(session, task)

        assert task.strategy_fit_raw == pytest.approx(10.0)
        assert task.dependency_score == pytest.approx(0.75)


class TestScoringIntegration:
    def test_f6_uses_the_assessment(self, refs):
        task = make_task(strategy_fit_raw=10.0)
        assert factor_strategy_fit(task, refs) == pytest.approx(1.0)

    def test_f7_prefers_the_assessment_over_the_counter(self, refs):
        """Сохранённая оценка вытесняет старое правило по счётчику команд."""
        task = make_task(involved_teams_count=3, dependency_score=0.63)
        assert factor_dependencies(task, refs) == pytest.approx(0.63)

    def test_f7_falls_back_to_the_counter(self, refs):
        task = make_task(involved_teams_count=2, dependency_score=None)
        assert factor_dependencies(task, refs) == pytest.approx(0.6)

    def test_blocking_dependency_lowers_the_priority_score(self, session, refs, today):
        from app.core.scoring import score_task

        task = make_task(value_internal_mln=100.0, effort_man_days=10.0)
        session.add(task)
        session.flush()
        ctx = ScoringContext(max_value_mln=1000.0, today=today)

        save_dependencies(
            session, task, score_dependencies([], refs.strategy_rubric), provider="agent"
        )
        session.flush()
        without = score_task(task, refs, ctx).score

        save_dependencies(
            session,
            task,
            score_dependencies(
                [{"team": "AI", "type": "blocking"}, {"team": "Core", "type": "blocking"}],
                refs.strategy_rubric,
            ),
            provider="agent",
        )
        session.flush()
        with_blocking = score_task(task, refs, ctx).score

        assert with_blocking < without
