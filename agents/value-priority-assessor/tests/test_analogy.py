"""Оценка Value по аналогии с задачами, где его заполнил человек."""

from __future__ import annotations

import pytest

from value_priority_assessor.core.analogy import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    Analogue,
    AnalogyEstimate,
    estimate_by_analogy,
)
from value_priority_assessor.core.value import SOURCE_ANALOGY, SOURCE_MANUAL, SOURCE_ZERO, compute_value
from tests.conftest import make_task


class FakeIndex:
    """Подставной индекс: тесты рубрики не должны зависеть от модели эмбеддингов."""

    def __init__(self, analogues: list[Analogue], same_team: bool = True, size: int = 100):
        self._analogues = analogues
        self._same_team = same_team
        self.entries = [None] * size
        self.available = True

    def find(self, task, top_k=3):
        return self._analogues[:top_k], self._same_team


def analogue(key: str, value: float, similarity: float, team: str = "Core") -> Analogue:
    return Analogue(task_key=key, title=f"Задача {key}", team=team, value_mln=value,
                    similarity=similarity)


class TestEstimate:
    def test_takes_median_not_mean(self):
        """Медиана устойчива к одному выбросу; среднее по 1/2/111 дало бы 38."""
        index = FakeIndex([
            analogue("A", 1.0, 0.97),
            analogue("B", 2.0, 0.96),
            analogue("C", 111.0, 0.95),
        ])
        result = estimate_by_analogy(make_task(), index)
        assert result.value_mln == 2.0

    def test_no_analogues_returns_none(self):
        assert estimate_by_analogy(make_task(), FakeIndex([])) is None

    def test_confidence_follows_similarity(self):
        high = estimate_by_analogy(make_task(), FakeIndex([analogue("A", 10.0, 0.98)]))
        medium = estimate_by_analogy(make_task(), FakeIndex([analogue("A", 10.0, 0.94)]))
        low = estimate_by_analogy(make_task(), FakeIndex([analogue("A", 10.0, 0.80)]))

        assert high.confidence == CONFIDENCE_HIGH
        assert medium.confidence == CONFIDENCE_MEDIUM
        assert low.confidence == CONFIDENCE_LOW

    def test_foreign_team_analogue_is_weaker_evidence(self):
        result = estimate_by_analogy(
            make_task(), FakeIndex([analogue("A", 10.0, 0.99)], same_team=False)
        )
        assert result.confidence == CONFIDENCE_MEDIUM

    def test_spread_of_analogues_lowers_confidence(self):
        """Регрессия: похожие названия при расходящихся значениях давали «высокую».

        У реальной задачи TASK-200-007 нашлись три аналога со значениями
        0.5, 1.9 и 111 млн ₽ при схожести 0.98 — и оценка объявлялась надёжной,
        потому что учитывалась только близость текста.
        """
        index = FakeIndex([
            analogue("A", 111.0, 0.98),
            analogue("B", 0.5, 0.93),
            analogue("C", 1.9, 0.93),
        ])
        result = estimate_by_analogy(make_task(), index)

        assert result.value_spread > 20
        assert result.confidence == CONFIDENCE_LOW

    def test_moderate_spread_downgrades_high_to_medium(self):
        index = FakeIndex([
            analogue("A", 10.0, 0.98),
            analogue("B", 60.0, 0.97),
        ])
        result = estimate_by_analogy(make_task(), index)
        assert 5 <= result.value_spread < 20
        assert result.confidence == CONFIDENCE_MEDIUM

    def test_zero_values_do_not_break_the_ratio(self):
        """В бэклоге есть задачи с Value = 0 — деление должно оставаться определённым."""
        index = FakeIndex([analogue("A", 0.0, 0.97), analogue("B", 0.0, 0.96)])
        result = estimate_by_analogy(make_task(), index)
        assert result.value_mln == 0.0
        assert result.value_spread == 1.0

    def test_cross_check_with_formula_lowers_confidence(self):
        """Расхождение с формулой на порядок — сигнал, что одна из оценок неверна."""
        index = FakeIndex([analogue("A", 5.0, 0.98)])
        result = estimate_by_analogy(make_task(), index, formula_value_mln=500.0)

        assert result.cross_check_note is not None
        assert result.confidence != CONFIDENCE_HIGH

    def test_close_formula_keeps_confidence(self):
        index = FakeIndex([analogue("A", 100.0, 0.98)])
        result = estimate_by_analogy(make_task(), index, formula_value_mln=120.0)

        assert result.cross_check_note is None
        assert result.confidence == CONFIDENCE_HIGH


class TestIntegrationWithValue:
    @pytest.mark.xfail(reason="ожидается решение владельца методологии: analogy-wins или blended")
    def test_analogy_and_formula_are_blended(self, refs):
        """Ответ — взвешенная сумма обоих методов, а не победа одного из них.

        Прежде аналогия вытесняла формулу целиком. С 2026-08-20 оба метода
        участвуют всегда, меняется только вес: он считается по обоснованности
        вводных доходного метода и качеству аналогов.
        """
        from value_priority_assessor.core.value import SOURCE_BLENDED

        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        index = FakeIndex([analogue("A", 58.3, 0.97), analogue("B", 58.3, 0.96)])

        result = compute_value(task, refs, analogy_index=index)

        assert result.source == SOURCE_BLENDED
        weights = result.inputs["weights"]
        assert weights["drivers"] + weights["analogy"] == pytest.approx(1.0)

        # Итог лежит между оценками методов, а не совпадает с одной из них.
        analogy_value, formula_value = result.inputs["analogy_mln"], result.inputs["formula_mln"]
        assert min(analogy_value, formula_value) <= result.value_internal_mln
        assert result.value_internal_mln <= max(analogy_value, formula_value)

    @pytest.mark.xfail(reason="ожидается решение владельца методологии по типу formula component")
    def test_both_methods_reach_the_answer(self, refs):
        """НФ19: оба метода доходят до ответа со своими расчётами.

        Раньше проигравший оседал в аудите одной строкой `formula_cross_check`.
        Теперь оба лежат в `components` целиком — иначе нельзя показать
        Координатору, из чего сложилось число.
        """
        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        index = FakeIndex([analogue("A", 58.3, 0.97)])

        result = compute_value(task, refs, analogy_index=index)
        sources = {c.source for c in result.components}

        assert sources == {SOURCE_ANALOGY, "time_saving"}
        formula = next(c for c in result.components if c.source == "time_saving")
        assert formula.value_internal_mln is not None
        assert "мин" in (formula.inputs or {})["formula"]

    def test_hint_names_the_analogues(self, refs):
        """Оценка по аналогии бесполезна, если не видно, с чем сравнивали."""
        task = make_task(team="Core", team_class="serving", title="Витрина")
        index = FakeIndex([analogue("TASK-X", 58.3, 0.97)])

        result = compute_value(task, refs, analogy_index=index)
        analogy = next(c for c in result.components if c.source == SOURCE_ANALOGY)

        assert "аналогия" in analogy.hint.lower()
        assert "TASK-X" in analogy.hint
        assert "схожесть" in analogy.hint

    def test_manual_value_still_wins(self, refs):
        """Ф1: человеческое значение не пересчитывается никаким методом."""
        task = make_task(value_manual_mln=42.0, team="Core", team_class="serving")
        index = FakeIndex([analogue("A", 999.0, 0.99)])

        result = compute_value(task, refs, analogy_index=index)

        assert result.source == SOURCE_MANUAL
        assert result.value_internal_mln == 42.0

    def test_regulatory_zero_still_wins(self, refs):
        task = make_task(is_regulatory=True, team="Core", team_class="serving")
        index = FakeIndex([analogue("A", 999.0, 0.99)])

        result = compute_value(task, refs, analogy_index=index)

        assert result.source == SOURCE_ZERO
        assert result.value_internal_mln == 0.0

    @pytest.mark.xfail(reason="ожидается решение владельца методологии по выбору revenue/time-saving")
    def test_without_index_the_formula_is_used(self, refs):
        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        result = compute_value(task, refs, analogy_index=None)
        assert result.source == "time_saving"

    def test_external_value_rule_survives(self, refs):
        """US-7: экономия времени не уходит наружу и при оценке по аналогии."""
        serving = make_task(team="Core", team_class="serving", title="Витрина")
        earning = make_task(team="IB", team_class="earning", title="Сделки")
        index = FakeIndex([analogue("A", 50.0, 0.97)])

        assert compute_value(serving, refs, analogy_index=index).value_external_mln is None

        # У зарабатывающей команды внешний Value совпадает с внутренним, но это
        # уже взвешенная сумма двух методов, а не чистая аналогия.
        earning_result = compute_value(earning, refs, analogy_index=index)
        assert earning_result.value_external_mln == earning_result.value_internal_mln


class TestRealIndex:
    """Проверка на настоящем индексе — требует загруженного бэклога."""

    def test_index_excludes_the_task_itself(self, session):
        from value_priority_assessor.config import DATA_DIR, get_settings
        from value_priority_assessor.core.analogy import AnalogyIndex
        from value_priority_assessor.core.loader import load_backlog

        if not get_settings().rag_vector:
            pytest.skip("векторный слой отключён конфигурацией")

        seed = DATA_DIR / "backlog_seed.json"
        if not seed.exists():
            pytest.skip("нет слепка бэклога")

        load_backlog(session, seed, replace=True)
        session.flush()

        index = AnalogyIndex(session)
        if not index.available:
            pytest.skip("векторный слой недоступен")

        reference = next(e for e in index.entries)
        task = make_task(task_key=reference["task_key"], title=reference["title"],
                         team=reference["team"])
        analogues, _same_team = index.find(task)

        assert all(a.task_key != reference["task_key"] for a in analogues), (
            "задача не может быть аналогом самой себе"
        )
