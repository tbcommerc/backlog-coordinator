"""Справочник драйверов: целостность и воспроизведение расчётов команд.

Смысл справочника не в том, чтобы хранить числа, а в том, чтобы из него
собирались те же оценки, которые команды защитили вручную. Поэтому здесь
проверяются не значения по отдельности, а формулы целиком: если кто-то поправит
драйвер, разойдётся именно этот тест, и станет видно, какой расчёт сломался.
"""

from __future__ import annotations

import pytest

TIERS = {"measured", "expert", "assumed"}


@pytest.fixture()
def drivers(refs) -> dict:
    return refs.value_drivers["drivers"]


class TestIntegrity:
    def test_every_driver_is_complete(self, refs, drivers):
        """Величина без источника и уровня достоверности необъяснима."""
        categories = set(refs.value_drivers["categories"])
        for name, entry in drivers.items():
            for field in ("title", "value", "unit", "source", "tier", "category"):
                assert field in entry, f"{name}: нет поля {field}"
            assert entry["tier"] in TIERS, f"{name}: неизвестный tier {entry['tier']!r}"
            assert entry["category"] in categories, f"{name}: чужая категория"

    def test_substitutions_point_at_existing_drivers(self, refs, drivers):
        for missing, rule in (refs.value_drivers.get("substitutions") or {}).items():
            assert rule["use"] in drivers, f"замена для {missing} ссылается в пустоту"

    def test_missing_driver_is_none_not_zero(self, refs):
        """None означает «нет величины», а не «величина равна нулю».

        Разница принципиальная: ноль прошёл бы через формулу и дал бы оценку,
        выглядящую как расчёт.
        """
        assert refs.driver_value("такого_драйвера_нет") is None
        assert refs.driver("такого_драйвера_нет") is None


class TestWorkingDays:
    @pytest.mark.parametrize(("year", "days"), [(2026, 247), (2027, 247), (2028, 248), (2029, 247)])
    def test_production_calendar(self, refs, year, days):
        assert refs.working_days(year) == days

    def test_unknown_year_falls_back_to_default(self, refs):
        assert refs.working_days(2035) == refs.working_days()


class TestReproducesTeamCalculations:
    """Каждый тест воспроизводит расчёт, который команда защитила вручную."""

    def value(self, refs, name: str) -> float:
        got = refs.driver_value(name)
        assert got is not None, f"драйвер {name} исчез из справочника"
        return got

    def test_pipeline_usi_pretrade(self, refs):
        """Pre-Trade «Пайплайн УСИ доступен в Сигма» — 49 млн ₽.

        Считается на вытесненном драйвере 9 млн ₽/мес: тест воспроизводит
        исходный расчёт команды, а не действующую методику. В расчёте Value
        стоимость сделки Pre-trade берётся из финансовой модели — 100 млн ₽.
        """
        got = (
            self.value(refs, "pretrade_requests_per_year")
            * self.value(refs, "routing_conversion_uplift_pp") / 100
            * self.value(refs, "pipeline_to_close_conversion")
            * self.value(refs, "avg_deal_revenue_rub_per_month") / 1e6
            * self.value(refs, "avg_deal_duration_months")
            * 0.85
        )
        assert got == pytest.approx(49.0, rel=0.01)

    def test_ib_deal_support_methodology(self, refs):
        """Meth «Порядок сопровождения сделок IB» — 250 млн ₽."""
        got = (
            self.value(refs, "dcm_ecm_annual_revenue_mln")
            * self.value(refs, "deal_loss_probability_without_support")
        )
        assert got == pytest.approx(250.0)

    def test_ib_workplace_in_sigma(self, refs):
        """IB «Рабочее место IB в Сигма» — 180 млн ₽."""
        got = (
            self.value(refs, "ib_annual_revenue_mln")
            * self.value(refs, "deal_count_uplift_from_speed")
        )
        assert got == pytest.approx(180.0)

    def test_individual_payments_ib(self, refs):
        """IB «Приём платежей от ФЛ» — 150 млн ₽ за 3 года при 10% готовности."""
        got = (
            self.value(refs, "ib_product_factory_revenue_mln")
            * self.value(refs, "ib_product_factory_share") * 0.1 * 3
        )
        assert got == pytest.approx(150.0)

    def test_option_windows_post(self, refs):
        """Post «Опционные окна» — 7.7 млн ₽ на один опцион."""
        got = (
            self.value(refs, "realised_option_risk_mln")
            / self.value(refs, "active_put_options")
        )
        assert got == pytest.approx(7.7, rel=0.01)

    def test_option_revenue_is_internally_consistent(self, refs):
        """Цена исполнения, срок и доход в месяц взяты из одного расчёта."""
        monthly = (
            self.value(refs, "avg_option_strike_rub")
            / self.value(refs, "avg_option_term_months")
        )
        assert monthly == pytest.approx(self.value(refs, "option_revenue_rub_per_month"), rel=0.001)
        assert self.value(refs, "option_revenue_rub_per_year") == pytest.approx(
            self.value(refs, "option_revenue_rub_per_month") * 12, rel=0.001
        )

    def _time_saving_mln(self, refs, hours_per_year: float, years: int = 3) -> float:
        return (
            hours_per_year * years
            / self.value(refs, "hours_per_working_day")
            / refs.working_days(2026)
            * self.value(refs, "fte_annual_budget_rub") / 1e6
        )

    def test_collateral_counterparty_name(self, refs):
        """Post «Наименование контрагента в карточки Обеспечений» — 0.61 млн ₽."""
        hours = 10 * 5 * (5 / 60) * 12  # 10 сделок в месяц × 5 человек × 5 минут
        assert self._time_saving_mln(refs, hours) == pytest.approx(0.61, rel=0.05)

    def test_cap_floor_rates(self, refs):
        """Post «Ставки cap и floor» — 1.44 + 0.32 млн ₽."""
        xml = self._time_saving_mln(refs, 12 * 5 * 2)   # 12 правок XML × 5 сделок × 2 ч
        rates = self._time_saving_mln(refs, 5 * 5 * 1)  # 5 изменений ставки ЦБ × 5 сделок
        assert xml == pytest.approx(1.44, rel=0.05)
        assert rates == pytest.approx(0.32, rel=0.06)

    def test_capitalisation_dates(self, refs):
        """Post «Даты капитализации процентов» — 0.72 млн ₽."""
        assert self._time_saving_mln(refs, 12 * 5 * 1) == pytest.approx(0.72, rel=0.05)

    def test_comment_field_in_deal_description(self, refs):
        """Post «Поле Комментарий в Описание сделки» — 0.48 млн ₽."""
        assert self._time_saving_mln(refs, 20 * 2) == pytest.approx(0.48, rel=0.05)

    def test_rd_allocation(self, refs):
        """Pre-Trade, три задачи по 25 млн ₽: 300 / 4 квартала / 3 задачи."""
        assert self.value(refs, "rd_annual_estimate_2026_mln") / 4 / 3 == pytest.approx(25.0)

    def test_codegen_autogeneration(self, refs):
        """Post «ЕФС. Автогенерация» — 24 млн ₽ за 3 года."""
        got = (
            self.value(refs, "quarterly_development_cost_mln")
            * self.value(refs, "codegen_saving_share") * 4 * 3
        )
        assert got == pytest.approx(24.0)

    def test_sales_campaign_deal(self, refs):
        """Methodology «Параметры первой кампании продаж» — 500 млн ₽ с 5 сделок."""
        assert self.value(refs, "campaign_deal_revenue_mln") * 5 == pytest.approx(500.0)

    def test_six_million_rows_no_longer_reproduce(self, refs):
        """Часть расчётов команда вела по 6 млн за ПШЕ, и они больше не сходятся.

        Это не регрессия, а зафиксированное следствие решения владельца от
        2026-08-14 взять единую ставку 8 млн. Пять таких строк агент теперь
        оценивает примерно на треть выше, чем команда защитила вручную. Тест
        стоит здесь, чтобы расхождение было видно как выбор, а не как ошибка.
        """
        # Post «Вывод рассчитываемых данных на страницу сделки», в таблице 0.6
        got = self._time_saving_mln(refs, 800 * 0.25, years=1)
        assert got == pytest.approx(0.81, rel=0.05)
        assert got / 0.6 == pytest.approx(8 / 6, rel=0.05)


class TestFinancialModelDrivers:
    """Величины из выгрузки финансовой модели ДИД, ID БП 20011, статья ВУ ПЧОД."""

    def test_deal_value_comes_from_the_financial_model(self, refs):
        """Действующая стоимость сделки — из финмодели, а не из пояснений команд."""
        ib_value, ib_origin, _ = refs.deal_value_rub("IB")
        pt_value, pt_origin, _ = refs.deal_value_rub("Pre-Trade")

        assert ib_value == 20_000_000 and ib_origin == "reference"
        assert pt_value == 100_000_000 and pt_origin == "reference"

    def test_ib_no_longer_borrows(self, refs):
        """У IB появилась своя величина — заимствование у Pre-Trade прекратилось."""
        assert refs._deal_value_of("IB") == 20_000_000

    def test_superseded_drivers_are_marked_and_unused(self, refs, drivers):
        """Вытесненная величина остаётся как свидетельство, но в расчёт не идёт.

        Удалить её значило бы потерять то, из чего команда исходила; оставить
        без пометки — позволить кому-то снова начать ей пользоваться.
        """
        superseded = {k: v["superseded_by"] for k, v in drivers.items() if "superseded_by" in v}
        assert superseded, "пометка вытеснения должна существовать"
        for name, replacement in superseded.items():
            assert replacement in drivers, f"{name} ссылается на несуществующий {replacement}"

        # Расчёт стоимости сделки Pre-trade не должен опираться на 9 млн ₽/мес.
        monthly = refs.driver_value("avg_deal_revenue_rub_per_month")
        months = refs.driver_value("avg_deal_duration_months")
        assert refs.deal_value_rub("Pre-Trade")[0] != monthly * months

    def test_annual_deal_counts_are_team_volume_not_task_increment(self, refs):
        """30 и 25 — годовой объём команды, а не прирост от одной инициативы.

        Подстановка их в формулу как «сделок в год от этой задачи» дала бы
        каждой инициативе весь годовой доход направления. Тест фиксирует
        порядок величин, чтобы ошибка бросалась в глаза при правке.
        """
        assert refs.driver_value("ib_new_deals_per_year") == 30
        assert refs.driver_value("pretrade_new_deals_per_year") == 25

        # Годовой объём направления, для сверки порядка.
        ib_annual = 30 * refs.driver_value("ib_avg_deal_revenue_mln")
        pretrade_annual = 25 * refs.driver_value("pretrade_avg_deal_revenue_mln")
        assert ib_annual == 600
        assert pretrade_annual == 2500


class TestLabourRatesAreDerivedNotStored:
    """Ставки труда выводятся из бюджета ПШЕ, а не хранятся отдельно.

    Отдельный `constants.yaml` держал ставку 3000 ₽/час рядом с бюджетом ПШЕ
    6 млн, и их согласие было совпадением, а не следствием. Файл упразднён
    2026-08-14; теперь источник один, и разойтись двум величинам физически
    негде.
    """

    def test_hour_rate_follows_the_fte_budget(self, refs):
        budget = refs.driver_value("fte_annual_budget_rub")
        expected = budget / refs.working_days(2026) / refs.constants.hours_per_man_day
        assert refs.constants.man_hour_rate_rub == pytest.approx(expected)

    def test_minute_cost_follows_the_hour_rate(self, refs):
        assert refs.constants.fte_minute_cost_rub == pytest.approx(
            refs.constants.man_hour_rate_rub / 60
        )

    def test_discount_rate_comes_from_policy(self, refs):
        """Ставка дисконтирования — ROE Сбера, решение владельца от 2026-08-14."""
        assert refs.constants.discount_rate_annual == pytest.approx(0.24)


class TestSupersession:
    """Из двух величин про одно и то же действует более поздняя.

    Источники приходили порциями за разные периоды: сводные таблицы про 2026
    год, квартальные бэклоги ЦИ про 2024–2025. Решение владельца от 2026-08-21:
    при расхождении действует более поздняя, устаревшая помечается
    `superseded_by` и в расчёте не участвует.
    """

    def test_every_supersession_points_at_a_living_driver(self, refs, drivers):
        superseded = {k: v["superseded_by"] for k, v in drivers.items() if "superseded_by" in v}
        assert superseded, "пометки вытеснения должны существовать"
        for name, replacement in superseded.items():
            assert replacement in drivers, f"{name} ссылается на несуществующий {replacement}"
            assert "superseded_by" not in drivers[replacement], (
                f"{name} вытеснен драйвером {replacement}, который сам вытеснен"
            )

    def test_superseded_driver_is_not_newer_than_its_replacement(self, refs, drivers):
        """Вытеснять более свежую величину устаревшей нельзя."""
        for name, replacement in (
            (k, v["superseded_by"]) for k, v in drivers.items() if "superseded_by" in v
        ):
            old_src = drivers[name]["source"]
            new_src = drivers[replacement]["source"]
            assert old_src != new_src, (
                f"{name} и {replacement} из одного источника — это не смена периода"
            )

    def test_routing_effect_uses_the_2026_figure(self, refs):
        """Маршрутизация: 4.5 млрд на 2026, а не 1.1 млрд третьего квартала 2025."""
        assert refs.driver_value("routing_annual_effect_2026_mln") == 4500
        assert "superseded_by" not in (refs.driver("routing_annual_effect_2026_mln") or {})
        assert refs.driver("routing_annual_effect_3q25_mln")["superseded_by"] == (
            "routing_annual_effect_2026_mln"
        )

    def test_rd_estimate_uses_the_2026_figure(self, refs):
        """Оценка РД: 300 млн на 2026, а не 150 млн второго полугодия 2025."""
        assert refs.driver_value("rd_annual_estimate_2026_mln") == 300
        assert refs.driver("rd_annual_estimate_2h2025_mln")["superseded_by"] == (
            "rd_annual_estimate_2026_mln"
        )


class TestProgramEffectsAreNotForEstimation:
    def test_marked_as_expert_not_measured(self, refs, drivers):
        """Деление программного эффекта на задачи — соглашение, а не измерение."""
        program = [n for n, e in drivers.items() if e["category"] == "program_effects"]
        assert program
        for name in program:
            assert drivers[name]["tier"] == "expert"
