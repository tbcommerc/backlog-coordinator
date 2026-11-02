"""Расчёт Value для обоих типов команд, Cost и C/V (ТЗ 3.1.1, 3.1.4)."""

from __future__ import annotations

import pytest

from value_priority_assessor.core.value import (
    CONFIDENCE_HIGH,
    SOURCE_MANUAL,
    SOURCE_REVENUE,
    SOURCE_TIME_SAVING,
    SOURCE_ZERO,
    STATUS_TBD,
    compute_cost,
    compute_cost_to_value,
    compute_value,
)
from value_priority_assessor.api.contract import TaskAttributes
from value_priority_assessor.service.scenarios import _value_result
from tests.conftest import make_task


class TestManualValue:
    def test_manual_value_is_not_recomputed(self, refs):
        """Ф1: введённое человеком значение агент не трогает."""
        task = make_task(value_manual_mln=42.0, team="Core", team_class="serving")
        result = compute_value(task, refs)

        assert result.value_internal_mln == 42.0
        assert result.source == SOURCE_MANUAL
        assert result.confidence == CONFIDENCE_HIGH
        assert "введено вручную" in result.hint

    def test_manual_value_for_earning_team_flows_outward(self, refs):
        """Ф6: у зарабатывающих команд внешний контур совпадает с внутренним."""
        task = make_task(value_manual_mln=100.0, team="IB", team_class="earning")
        result = compute_value(task, refs)
        assert result.value_external_mln == 100.0


class TestRevenueMethod:
    """Доходный метод. Стоимость сделки разрешается по команде.

    Единой ставки «одна сделка = столько-то» больше нет: она жила в упразднённом
    `constants.yaml` и противоречила обоснованиям команд. У Pre-Trade величина
    выводится из справочника, у остальных зарабатывающих команд её нет.
    """

    def test_explicit_deal_count_from_title(self, refs):
        task = make_task(
            team="Pre-Trade",
            team_class="earning",
            title="Привлечь 5 сделок с акционерным риском",
        )
        result = compute_value(task, refs)

        deal_value_mln = refs.deal_value_rub("Pre-Trade")[0] / 1e6
        expected = 5 * 3 * deal_value_mln * refs.constants.discount_factor()

        assert result.source == SOURCE_REVENUE
        assert result.value_internal_mln == pytest.approx(expected, abs=1.0)
        # Все вводные явные — уверенность высокая.
        assert result.confidence == CONFIDENCE_HIGH
        assert result.missing == []

    def test_missing_deal_count_does_not_create_a_plausible_value(self, refs):
        task = make_task(
            team="Pre-Trade", team_class="earning", title="Доработка карточки клиента"
        )
        result = compute_value(task, refs)

        assert result.source == SOURCE_REVENUE
        assert result.value_internal_mln is None
        assert result.missing == ["указать ожидаемое число дополнительных сделок в год"]

    def test_discount_factor_reduces_value(self, refs):
        """Дисконтирование действительно применяется, а не декларируется."""
        task = make_task(team="Pre-Trade", team_class="earning", title="Привлечь 1 сделку")
        result = compute_value(task, refs)

        undiscounted = 1 * 3 * refs.deal_value_rub("Pre-Trade")[0] / 1e6
        assert result.value_internal_mln < undiscounted
        assert result.inputs["discount_factor"] < 1.0

    def test_team_without_own_deal_value_borrows_and_says_so(self, refs):
        """Команде без своей стоимости сделки она занимается — с оговоркой.

        Раньше здесь была единая константа 50 млн ₽ неизвестного происхождения.
        Теперь величина заимствуется явно (решение владельца от 2026-08-18):
        оценка с понижённой уверенностью полезнее пустоты, но заимствование
        обязано быть видно — и в уверенности, и в списке того, что уточнить.

        IB для этого больше не подходит: с выгрузкой из финансовой модели у
        него появилась своя величина, 20 млн ₽.
        """
        assert refs._deal_value_of("Delivery") is None, "у команды не должно быть своей величины"

        value, origin, donor = refs.deal_value_rub("Delivery")
        assert origin == "substitution"
        assert donor == "Pre-Trade"
        assert value == refs.deal_value_rub("Pre-Trade")[0]

        task = make_task(team="Delivery", team_class="earning", title="Привлечь 5 сделок")
        result = compute_value(task, refs)

        assert result.value_internal_mln is not None
        assert result.confidence == "low", "заимствование стоит ступени уверенности"
        assert any("стоимость сделки" in m for m in result.missing)
        assert "Pre-Trade" in (result.inputs or {}).get("formula", "")

    def test_teams_with_own_deal_value_do_not_borrow(self, refs):
        """У IB и Pre-Trade величины из финансовой модели — занимать нечего."""
        for team, expected_mln in (("IB", 20), ("Pre-Trade", 100)):
            value, origin, donor = refs.deal_value_rub(team)
            assert origin == "reference", f"{team} не должен заимствовать"
            assert donor == team
            assert value == expected_mln * 1_000_000


class TestTimeSavingMethod:
    def test_explicit_inputs(self, refs):
        task = make_task(
            team="Core",
            team_class="serving",
            title="Автоматизация отчёта: 30 пользователей тратят 45 мин на операцию",
        )
        result = compute_value(
            task,
            refs,
            {"operations_per_year": 50, "confident": True},
        )

        assert result.source == SOURCE_TIME_SAVING
        # Частоту 50 вернула модель; ядро её не подставляет самостоятельно.
        assert result.value_internal_mln > 0
        components = {c["name"]: c for c in result.inputs["components"]}
        assert components["users"]["value"] == 30
        assert components["users"]["explicit"] is True
        assert components["minutes_per_operation"]["value"] == 45

    def test_external_value_is_tbd_for_serving_team(self, refs):
        """Ф7/Ф9: наружу экономия времени не выходит ни при каких условиях."""
        task = make_task(team="Core", team_class="serving", title="Автоматизация витрины")
        result = compute_value(
            task,
            refs,
            {
                "users": 1,
                "minutes_per_operation": 15,
                "operations_per_year": 50,
                "confident": True,
            },
        )

        assert result.value_external_mln is None
        assert result.value_external_status == STATUS_TBD

    def test_hours_are_converted_to_minutes(self, refs):
        task = make_task(
            team="Core", team_class="serving", title="Процесс занимает 2 часа у сотрудника"
        )
        result = compute_value(
            task,
            refs,
            {"users": 1, "operations_per_year": 50, "confident": True},
        )
        components = {c["name"]: c for c in result.inputs["components"]}
        assert components["minutes_per_operation"]["value"] == 120


class TestZeroValue:
    @pytest.mark.parametrize(
        "flags", [{"is_regulatory": True}, {"is_rnd": True}]
    )
    def test_regulatory_and_rnd_have_zero_value(self, refs, flags):
        """Ф2: эффект таких задач не монетизируется, в скор они входят через овверрайды."""
        task = make_task(team="Core", team_class="serving", **flags)
        result = compute_value(task, refs)

        assert result.value_internal_mln == 0.0
        assert result.source == SOURCE_ZERO
        assert result.zero_value_reason in {"regulatory", "rnd"}


class TestCost:
    def test_cost_formula(self, refs):
        """Cost_₽ = ч/д × часов в дне × ставку часа.

        Ставка не зашита в тест числом: она выводится из бюджета ПШЕ и
        производственного календаря, и зафиксированное здесь значение
        разошлось бы со справочником при первой же правке бюджета.
        """
        task = make_task(effort_man_days=10.0)
        expected = (
            10.0 * refs.constants.hours_per_man_day * refs.constants.man_hour_rate_rub
        )
        assert compute_cost(task, refs) == pytest.approx(expected)

    def test_cost_is_none_without_effort(self, refs):
        assert compute_cost(make_task(), refs) is None


class TestCostToValue:
    def test_ratio(self):
        # 240 000 ₽ затрат на 1 млн ₽ эффекта.
        assert compute_cost_to_value(240_000.0, 1.0) == pytest.approx(0.24)

    def test_undefined_when_value_is_zero(self):
        """Различаем «не посчитано» и «посчитано и вышло нейтрально»."""
        assert compute_cost_to_value(240_000.0, 0.0) is None

    def test_undefined_without_cost(self):
        assert compute_cost_to_value(None, 10.0) is None


class TestHint:
    def test_missing_drivers_are_named_without_a_substitute_number(self, refs):
        """Ф22: без драйверов агент запрашивает вводные, а не строит оценку."""
        task = make_task(team="Core", team_class="serving", title="Автоматизация витрины")
        result = compute_value(task, refs)

        assert result.value_internal_mln is None
        assert "применить не удалось" in result.hint
        assert "Что уточнить" in result.hint
        assert "20 польз." not in result.hint
        assert "15 мин" not in result.hint
        assert "50 раз/год" not in result.hint

    def test_missing_value_is_not_called_exact(self, refs):
        task = make_task(team="Core", team_class="serving", title="Автоматизация витрины")
        core = compute_value(task, refs)
        output = _value_result(
            task,
            core,
            TaskAttributes(
                task_id="T-1",
                task_type="AD-HOC",
                team="Core",
                title=task.title,
                deadline="4Q 2026",
            ),
            [],
        )

        assert output.value_mln is None
        assert "Значение точное" not in output.explanation
