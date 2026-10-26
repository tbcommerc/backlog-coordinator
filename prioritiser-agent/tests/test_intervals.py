"""Интервал оценки Value: применение множителей и заявленное покрытие."""

from __future__ import annotations

import pytest
import yaml

from app.config import REFERENCES_DIR
from app.core.intervals import compute_interval
from app.core.value import compute_value
from tests.conftest import make_task

CALIBRATION_PATH = REFERENCES_DIR / "value_intervals.yaml"


@pytest.fixture()
def calibration() -> dict:
    return yaml.safe_load(CALIBRATION_PATH.read_text(encoding="utf-8"))


class TestCalibrationFile:
    def test_declares_target_coverage(self, calibration):
        assert calibration["target_coverage"] == 0.95

    def test_every_calibrated_entry_meets_the_promise(self, calibration):
        """Главная проверка: обещанные 95% должны быть измерены, а не заявлены.

        Файл порождается `scripts/value_calibrate.py`; тест сторожит артефакт,
        который реально попадает в поставку.
        """
        target = calibration["target_coverage"]
        checked = 0
        for method, levels in calibration["methods"].items():
            for level, entry in levels.items():
                if not entry.get("calibrated"):
                    continue
                checked += 1
                assert entry["coverage"] >= target, (
                    f"{method}/{level}: покрытие {entry['coverage']} ниже цели {target}"
                )
        assert checked >= 2, "в справочнике нет ни одной откалиброванной группы"

    def test_uncalibrated_entries_declare_inheritance(self, calibration):
        """Группа без своей калибровки обязана честно сказать об этом."""
        for levels in calibration["methods"].values():
            for entry in levels.values():
                if entry.get("calibrated"):
                    continue
                assert entry["coverage"] is None
                assert entry.get("inherited_from")

    def test_lower_confidence_is_never_narrower(self, calibration):
        """Низкая уверенность не может давать более узкий интервал, чем средняя."""
        for method, levels in calibration["methods"].items():
            if "medium" not in levels or "low" not in levels:
                continue
            for factor in ("down_factor", "up_factor"):
                assert levels["low"][factor] >= levels["medium"][factor], (
                    f"{method}: у low множитель {factor} уже, чем у medium"
                )


class TestComputeInterval:
    def test_manual_value_has_no_interval(self, calibration):
        """Человеческое значение — истина; неопределённости вокруг него нет."""
        interval = compute_interval(42.0, "manual", "high", calibration)
        assert interval.is_exact
        assert interval.low_mln == interval.high_mln == 42.0
        assert interval.coverage == 1.0

    def test_zero_by_methodology_has_no_interval(self, calibration):
        interval = compute_interval(0.0, "zero", "high", calibration)
        assert interval.is_exact

    def test_interval_brackets_the_estimate(self, calibration):
        interval = compute_interval(100.0, "analogy", "medium", calibration)
        assert interval.low_mln < 100.0 < interval.high_mln

    def test_low_confidence_is_wider_than_medium(self, calibration):
        medium = compute_interval(100.0, "analogy", "medium", calibration)
        low = compute_interval(100.0, "analogy", "low", calibration)

        assert low.high_mln - low.low_mln > medium.high_mln - medium.low_mln

    def test_zero_estimate_gets_an_upper_bound(self, calibration):
        """Ноль по аналогии не означает «точно ноль» — делить его нельзя."""
        interval = compute_interval(0.0, "analogy", "low", calibration)
        assert interval.low_mln == 0.0
        assert interval.high_mln > 0.0

    def test_none_value_yields_no_interval(self, calibration):
        assert compute_interval(None, "analogy", "low", calibration) is None

    def test_unknown_confidence_falls_back_to_widest(self, calibration):
        """Неизвестный уровень не должен молча давать узкий интервал."""
        unknown = compute_interval(100.0, "analogy", "неведомый", calibration)
        low = compute_interval(100.0, "analogy", "low", calibration)
        assert unknown.high_mln == low.high_mln

    def test_formatting_is_readable(self, calibration):
        text = compute_interval(100.0, "analogy", "medium", calibration).format_range()
        assert "млн ₽" in text
        assert "–" in text


class TestIntegrationWithValue:
    def test_hint_shows_the_range(self, refs):
        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        result = compute_value(
            task,
            refs,
            {
                "users": 10,
                "minutes_per_operation": 15,
                "operations_per_year": 50,
                "confident": True,
            },
        )

        assert result.interval is not None
        assert "Диапазон" in result.hint
        assert "95%" in result.hint

    def test_manual_value_hint_has_no_range(self, refs):
        task = make_task(value_manual_mln=42.0, team="Core", team_class="serving")
        result = compute_value(task, refs)

        assert result.interval.is_exact
        assert "Диапазон" not in result.hint

    def test_estimate_lies_inside_its_own_interval(self, refs):
        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        result = compute_value(
            task,
            refs,
            {
                "users": 10,
                "minutes_per_operation": 15,
                "operations_per_year": 50,
                "confident": True,
            },
        )

        assert result.interval.low_mln <= result.value_internal_mln <= result.interval.high_mln

    def test_recompute_persists_the_bounds(self, session, refs, monkeypatch):
        from app.core import service

        task = make_task(team="Core", team_class="serving", title="Витрина отчётности")
        calculated = compute_value(
            task,
            refs,
            {
                "users": 10,
                "minutes_per_operation": 15,
                "operations_per_year": 50,
                "confident": True,
            },
        )
        monkeypatch.setattr(service, "compute_value", lambda *_args, **_kwargs: calculated)
        session.add(task)
        session.flush()

        service.recompute_task(session, task, use_llm=False)

        assert task.value_low_mln is not None
        assert task.value_high_mln is not None
        assert task.value_low_mln <= task.value_internal_mln <= task.value_high_mln
