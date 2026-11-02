"""Факторы приоритизации, свёртка, овверрайды и шкала P1–P5 (ТЗ 3.1.5)."""

from __future__ import annotations

import datetime as dt

import pytest

from value_priority_assessor.core.references import ReferenceBundle, ReferenceError, save_reference
from value_priority_assessor.core.scoring import (
    FACTOR_TITLES,
    ScoringContext,
    apply_overrides,
    compute_factors,
    factor_dependencies,
    factor_effort,
    factor_urgency,
    factor_value,
    score_task,
    score_to_priority,
)
from tests.conftest import make_task


@pytest.fixture()
def ctx(today) -> ScoringContext:
    return ScoringContext(max_value_mln=1000.0, today=today)


class TestFactorValue:
    def test_zero_value_scores_zero(self, ctx):
        assert factor_value(make_task(value_internal_mln=0.0), ctx) == 0.0

    def test_max_value_scores_one(self, ctx):
        assert factor_value(make_task(value_internal_mln=1000.0), ctx) == pytest.approx(1.0)

    def test_logarithmic_not_linear(self, ctx):
        """Логарифм принципиален: эффекты в бэклоге различаются на два порядка,
        и линейная шкала схлопнула бы все задачи кроме одной-двух в ноль."""
        small = factor_value(make_task(value_internal_mln=10.0), ctx)
        assert small > 10.0 / 1000.0


class TestCostValueIsNotAFactor:
    """C/V убран из скоринга как мультиколлинеарный: он равен Cost / Value, то
    есть выводится из трудозатрат (F4) и Value (F1) и новых вводных не несёт."""

    def test_no_cost_value_factor(self, refs, ctx):
        factors = compute_factors(make_task(cost_to_value=2.0), refs, ctx)
        assert "F8_cost_value" not in factors
        assert "F8_cost_value" not in FACTOR_TITLES

    def test_ratio_does_not_move_the_score(self, refs, ctx):
        """Две задачи, отличающиеся только C/V, обязаны получить равный скор:
        сами Value и трудозатраты у них одинаковые."""
        cheap = score_task(make_task(cost_to_value=0.1), refs, ctx)
        expensive = score_task(make_task(cost_to_value=9.0), refs, ctx)
        assert cheap.score == pytest.approx(expensive.score)

    def test_ratio_is_still_computed_for_the_card(self, refs, ctx):
        """Показатель остаётся диагностикой: считается и виден, но не оценивается."""
        task = make_task(cost_to_value=2.0)
        assert task.cost_to_value == 2.0
        assert "F8_cost_value" not in score_task(task, refs, ctx).contributions


class TestFactorUrgency:
    @pytest.mark.parametrize(
        "days,expected",
        [(10, 1.0), (30, 1.0), (60, 0.7), (90, 0.7), (150, 0.4), (300, 0.1)],
    )
    def test_steps(self, refs, ctx, today, days, expected):
        task = make_task(deadline=today + dt.timedelta(days=days))
        assert factor_urgency(task, refs, ctx) == expected

    def test_overdue_is_maximally_urgent(self, refs, ctx, today):
        task = make_task(deadline=today - dt.timedelta(days=30))
        assert factor_urgency(task, refs, ctx) == 1.0

    def test_no_deadline_scores_low(self, refs, ctx):
        assert factor_urgency(make_task(deadline=None), refs, ctx) == 0.1


class TestFactorEffort:
    def test_cheap_task_scores_high(self, refs):
        assert factor_effort(make_task(effort_man_days=2.0), refs) == 1.0

    def test_expensive_task_scores_low(self, refs):
        assert factor_effort(make_task(effort_man_days=200.0), refs) == 0.3

    def test_linear_between_thresholds(self, refs):
        middle = factor_effort(make_task(effort_man_days=27.5), refs)
        assert 0.3 < middle < 1.0

    def test_unknown_effort_is_neutral(self, refs):
        assert factor_effort(make_task(effort_man_days=None), refs) == 0.5


class TestFactorDependencies:
    def test_no_dependencies_scores_one(self, refs):
        assert factor_dependencies(make_task(involved_teams_count=0), refs) == 1.0

    def test_floor(self, refs):
        assert factor_dependencies(make_task(involved_teams_count=99), refs) == 0.2


class TestPriorityBands:
    @pytest.mark.parametrize(
        "score,expected",
        [(0.95, "P1"), (0.8, "P1"), (0.79, "P2"), (0.6, "P2"),
         (0.5, "P3"), (0.4, "P3"), (0.3, "P4"), (0.2, "P4"), (0.1, "P5")],
    )
    def test_bands(self, refs, score, expected):
        assert score_to_priority(score, refs) == expected


class TestOverrides:
    def test_regulatory_with_near_deadline_becomes_p1(self, refs, ctx, today):
        """ТЗ Ф19 в дефолтной, суженной редакции."""
        task = make_task(is_regulatory=True, deadline=today + dt.timedelta(days=30))
        priority, applied = apply_overrides(task, refs, ctx, "P4")

        assert priority == "P1"
        assert applied[0]["id"] == "regulatory_deadline"

    def test_regulatory_with_far_deadline_is_untouched(self, refs, ctx, today):
        task = make_task(is_regulatory=True, deadline=today + dt.timedelta(days=300))
        priority, applied = apply_overrides(task, refs, ctx, "P4")
        assert priority == "P4"
        assert applied == []

    def test_blocking_task_becomes_p1(self, refs, ctx):
        task = make_task(is_blocking=True)
        priority, applied = apply_overrides(task, refs, ctx, "P5")
        assert priority == "P1"

    def test_override_never_lowers_priority(self, refs, ctx, today):
        """Овверрайды только повышают: задача, уже попавшая в P1 по скору,
        не должна опускаться из-за срабатывания правила «минимум P2»."""
        task = make_task(is_regulatory=True, deadline=today + dt.timedelta(days=10))
        priority, _ = apply_overrides(task, refs, ctx, "P1")
        assert priority == "P1"

    def test_tz_quarterly_rule_is_disabled_by_default(self, refs, ctx, today):
        """Буквальное правило ТЗ отправило бы в P1 187 задач из 440,
        поэтому в дефолтном справочнике оно выключено."""
        task = make_task(
            task_type="КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ",
            deadline=today + dt.timedelta(days=30),
        )
        priority, applied = apply_overrides(task, refs, ctx, "P3")
        assert priority == "P3"
        assert applied == []

    def test_tz_quarterly_rule_works_when_enabled(self, session, ctx, today):
        payload = ReferenceBundle(session).raw["overrides"]
        for rule in payload["rules"]:
            if rule["id"] == "tz_quarterly_goal_deadline":
                rule["enabled"] = True
        save_reference(session, "overrides", payload, actor="test")
        session.flush()

        refs = ReferenceBundle(session)
        task = make_task(
            task_type="КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ",
            deadline=today + dt.timedelta(days=30),
        )
        priority, applied = apply_overrides(task, refs, ctx, "P3")
        assert priority == "P1"
        assert applied[0]["id"] == "tz_quarterly_goal_deadline"

    def test_tribe_leader_customer_sets_minimum_p2(self, session, ctx):
        payload = ReferenceBundle(session).raw["customer_levels"]
        payload["customers"]["Д. Андреев"] = "tribe_leader"
        save_reference(session, "customer_levels", payload, actor="test")
        session.flush()

        refs = ReferenceBundle(session)
        task = make_task(customer="Д. Андреев")
        priority, applied = apply_overrides(task, refs, ctx, "P4")

        assert priority == "P2"
        assert applied


class TestWeightsMatchFactors:
    """Справочник весов и набор факторов обязаны совпадать один в один.

    Расхождение молчаливо: лишний вес в справочнике просто не применится, а
    фактор без веса не попадёт в скор. Ни то, ни другое не заметно по результату
    — приоритеты останутся правдоподобными, но перестанут соответствовать
    настройке методолога.
    """

    def test_no_orphan_weights_and_no_unweighted_factors(self, refs, ctx):
        factors = set(compute_factors(make_task(), refs, ctx))
        assert factors == set(refs.weights)
        assert factors == set(FACTOR_TITLES)

    def test_weights_sum_to_one(self, refs):
        assert sum(refs.weights.values()) == pytest.approx(1.0)

    def test_stale_weights_fail_loudly(self, session, ctx):
        """Справочник версии 1 с весом C/V должен ломать расчёт, а не занижать его.

        Это сценарий обновления существующей установки: справочник лежит в базе
        и не перетирается при старте.
        """
        # Сумма обязана остаться единицей: тест про осиротевший вес, а не про
        # сломанную валидацию — иначе он падал бы по другой причине.
        payload = ReferenceBundle(session).raw["factor_weights"]
        payload["weights"] = {"F8_cost_value": 0.25, **payload["weights"]}
        payload["weights"]["F1_value"] = 0.15
        payload["weights"]["F4_effort"] = 0.11
        save_reference(session, "factor_weights", payload, actor="test")
        session.flush()

        with pytest.raises(ReferenceError, match="F8_cost_value"):
            score_task(make_task(), ReferenceBundle(session), ctx)


class TestScoreTask:
    def test_weighted_sum_matches_contributions(self, refs, ctx):
        task = make_task(value_internal_mln=100.0, cost_to_value=1.0, effort_man_days=10.0)
        result = score_task(task, refs, ctx)

        assert result.score == pytest.approx(sum(result.contributions.values()), abs=1e-4)
        assert 0.0 <= result.score <= 1.0

    def test_high_value_low_cost_beats_the_opposite(self, refs, ctx):
        """Ключевой кейс методики: дешёвая задача с большим эффектом должна
        обгонять дорогую с малым."""
        good = make_task(
            task_key="GOOD", value_internal_mln=500.0, cost_to_value=0.05, effort_man_days=3.0
        )
        bad = make_task(
            task_key="BAD", value_internal_mln=1.0, cost_to_value=9.0, effort_man_days=200.0
        )
        assert score_task(good, refs, ctx).score > score_task(bad, refs, ctx).score

    def test_explanation_names_top_factors(self, refs, ctx):
        result = score_task(make_task(value_internal_mln=100.0), refs, ctx)
        assert "Наибольший вклад" in result.reason
