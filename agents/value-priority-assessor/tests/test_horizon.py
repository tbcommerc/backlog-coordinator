"""Период получения дохода: три года со следующего периода после срока."""

from __future__ import annotations

import datetime as dt

import pytest

from value_priority_assessor.core.horizon import revenue_window
from value_priority_assessor.core.normalise import parse_deadline_period

TODAY = dt.date(2026, 8, 13)


@pytest.mark.parametrize(
    ("deadline", "start", "end"),
    [
        ("3Q 2026", dt.date(2026, 10, 1), dt.date(2029, 9, 30)),
        ("1Q 2026", dt.date(2026, 4, 1), dt.date(2029, 3, 31)),
        # Из списка кварталов берётся последний: работа закончена, когда закрыт
        # последний заявленный период.
        ("1Q 2026,2Q 2026", dt.date(2026, 7, 1), dt.date(2029, 6, 30)),
        # Годовой срок сдвигает окно на целый год, а не на квартал.
        ("2026", dt.date(2027, 1, 1), dt.date(2029, 12, 31)),
        # 4Q переносит начало на следующий год.
        ("4Q 2026", dt.date(2027, 1, 1), dt.date(2029, 12, 31)),
    ],
)
def test_window_follows_deadline_granularity(deadline, start, end):
    got_start, got_end, derived, warning = revenue_window(deadline, today=TODAY)
    assert (got_start, got_end) == (start, end)
    assert derived == deadline
    assert warning is None


def test_window_spans_exactly_three_years():
    start, end, _, _ = revenue_window("3Q 2026", today=TODAY)
    assert end + dt.timedelta(days=1) == start.replace(year=start.year + 3)


@pytest.mark.parametrize("deadline", ["БЕЗ СРОКА", "", None, "-"])
def test_missing_deadline_is_an_assumption_not_a_calculation(deadline):
    """Без срока окно строится, но пользователь обязан узнать, что это допущение."""
    start, end, derived, warning = revenue_window(deadline, today=TODAY)
    assert start == dt.date(2026, 10, 1)
    assert end == dt.date(2029, 9, 30)
    assert derived == "срок не указан"
    assert warning is not None and "допущение" in warning


def test_deadline_period_keeps_granularity():
    assert parse_deadline_period("3Q 2026") == (dt.date(2026, 9, 30), "quarter")
    assert parse_deadline_period("2026") == (dt.date(2026, 12, 31), "year")
    assert parse_deadline_period("БЕЗ СРОКА") is None
