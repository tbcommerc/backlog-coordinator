"""Нормализация грязных значений из экспорта Confluence."""

from __future__ import annotations

import datetime as dt

import pytest

from value_priority_assessor.core import normalise as nz


class TestCleanText:
    def test_strips_non_breaking_space(self):
        # Ровно тот случай из бэклога: 74 записи типа задачи приходят с \xa0.
        assert nz.clean_text("КВАРТАЛЬНАЯ/ГОДОВАЯ\xa0ЦЕЛЬ") == "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ"

    def test_collapses_whitespace(self):
        assert nz.clean_text("  Задача   с   пробелами \n") == "Задача с пробелами"

    def test_empty_becomes_none(self):
        assert nz.clean_text("   ") is None
        assert nz.clean_text(None) is None


class TestParseNumber:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("54.7", 54.7),
            ("54,7", 54.7),
            ("473.0", 473.0),
            ("355 млн руб.", 355.0),
            (26, 26.0),
            (None, None),
            ("нет данных", None),
        ],
    )
    def test_parse(self, raw, expected):
        assert nz.parse_number(raw) == expected


class TestParseDeadline:
    def test_takes_last_quarter_of_list(self):
        # Договорённость: из списка кварталов берём последний, дата — конец квартала.
        assert nz.parse_deadline("1Q 2026,2Q 2026,3Q 2026,4Q 2026") == dt.date(2026, 12, 31)

    def test_single_quarter(self):
        assert nz.parse_deadline("3Q 2026") == dt.date(2026, 9, 30)

    def test_quarter_prefix_form(self):
        assert nz.parse_deadline("Q1 2027") == dt.date(2027, 3, 31)

    def test_bare_year_is_end_of_year(self):
        assert nz.parse_deadline("2026") == dt.date(2026, 12, 31)

    def test_mixed_list_takes_latest(self):
        assert nz.parse_deadline("4Q 2026,2026") == dt.date(2026, 12, 31)

    def test_spaces_in_list(self):
        assert nz.parse_deadline("1Q 2026, 2Q 2026, 3Q 2026, 4Q 2026") == dt.date(2026, 12, 31)

    @pytest.mark.parametrize("raw", ["БЕЗ СРОКА", "", None, "—"])
    def test_no_deadline(self, raw):
        assert nz.parse_deadline(raw) is None


class TestParseDate:
    def test_russian_short_month(self):
        assert nz.parse_date("1 янв. 2026 г.") == dt.date(2026, 1, 1)

    def test_may_prefix_does_not_collide_with_march(self):
        assert nz.parse_date("15 мая 2026 г.") == dt.date(2026, 5, 15)
        assert nz.parse_date("15 мар. 2026 г.") == dt.date(2026, 3, 15)


class TestSplitTeams:
    def test_various_separators(self):
        assert nz.split_teams("Core, Finance; AI") == ["Core", "Finance", "AI"]

    def test_empty(self):
        assert nz.split_teams(None) == []
