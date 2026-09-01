"""Разрешение уровня бизнес-заказчика — фактор F2.

Поле «Бизнес-заказчик» в бэклоге редко содержит ровно одного человека: из 55
различных значений 41 — это отдельные люди, остальное комбинации и коллективные
заказчики. Поэтому уровень ищется не точным совпадением строки, а разбором.
"""

from __future__ import annotations

import pytest

from app.core.references import ReferenceBundle


@pytest.fixture()
def filled(refs) -> ReferenceBundle:
    """Справочник с проставленными уровнями — как после работы методолога."""
    payload = refs.raw["customer_levels"]
    payload["customers"].update(
        {
            "М. Первак": "team",
            "Д. Фомин": "director",
            "Д. Козлов": "head",
            "Ю. Шилов": "team",
            "С. Фидаров": "head",
            "Д. Андреев": "tribe_leader",
        }
    )
    payload["groups"]["УСИ (общая)"] = "director"
    payload["divisions"].update({"ЦИ": "head", "РЕГ. ДИРЕКТОРЫ": "director"})
    return refs


class TestCompositeCustomers:
    def test_strongest_level_wins(self, filled):
        """Заявка не становится менее весомой оттого, что рядом расписались ещё трое."""
        assert filled.customer_level("М. Первак Д. Фомин Д. Козлов Ю. Шилов") == "director"

    def test_comma_separated(self, filled):
        assert filled.customer_level("В. Баклушин, Д. Козлов") == "head"

    def test_slash_separated(self, filled):
        assert filled.customer_level("Д. Кулюкин / С. Фидаров") == "head"

    def test_single_name_still_works(self, filled):
        assert filled.customer_level("Д. Андреев") == "tribe_leader"

    def test_unfilled_person_stays_default(self, filled):
        """Незаполненный уровень — честное «не знаю», а не ошибка."""
        assert filled.customer_level("И. Ипатьев") == "unknown"


class TestHomoglyphs:
    def test_latin_c_matches_cyrillic(self, filled):
        """В бэклоге «C. Фидаров» встречается и с латинской C, и с кириллической.

        Без приведения это два разных заказчика, и заполнять пришлось бы оба.
        """
        latin = filled.customer_level("Д. Кулюкин / C. Фидаров")
        cyrillic = filled.customer_level("Д. Кулюкин / С. Фидаров")
        assert latin == cyrillic == "head"


class TestFallbackOrder:
    def test_group_used_when_no_person_in_string(self, filled):
        assert filled.customer_level("УСИ (общая)") == "director"

    def test_division_used_when_customer_unrecognised(self, filled):
        """«AD-HOC» в поле заказчика — ошибка ввода; подразделение спасает оценку."""
        assert filled.customer_level("AD-HOC", "ЦИ") == "head"

    def test_composite_division_takes_strongest(self, filled):
        assert filled.customer_level(None, "ЦР,РЕГ. ДИРЕКТОРЫ") == "director"

    def test_person_beats_division(self, filled):
        """ФИО точнее подразделения, поэтому проверяется первым."""
        assert filled.customer_level("Д. Андреев", "ЦИ") == "tribe_leader"

    def test_unknown_person_falls_through_to_division(self, filled):
        """Человек есть в строке, но уровень не проставлен — подразделение ещё в игре."""
        assert filled.customer_level("И. Ипатьев", "ЦИ") == "head"

    def test_nothing_known_is_default(self, filled):
        assert filled.customer_level(None, None) == "unknown"
        assert filled.customer_level("Неизвестный Человек", "НЕТ ТАКОГО") == "unknown"


class TestDefaultNeverBeatsRealLevel:
    def test_team_wins_over_unknown(self, filled):
        """`unknown` даёт 0.5, а `team` — 0.2, но «не знаю» не должно побеждать
        проставленный уровень только из-за численно большего нейтрального балла."""
        filled.raw["customer_levels"]["customers"]["Я. Гончаров"] = "team"
        assert filled.customer_level("Я. Гончаров, И. Ипатьев") == "team"


class TestReferenceCoversTheSnapshot:
    def test_every_customer_in_the_snapshot_is_listed(self, refs):
        """Справочник должен перечислять всех, кто реально встречается в слепке.

        Пропущенный заказчик молча получает нейтральный балл, и методолог не
        узнает, что его забыли внести — именно так справочник и разошёлся с
        данными: в нём было 21 имя из 55 встречающихся.
        """
        import json

        from app.core.loader import DEFAULT_SEED
        from app.core.normalise import clean_text
        from app.core.references import _persons

        payload = refs.raw["customer_levels"]
        listed = set(payload["customers"]) | set(payload["groups"])

        missing: set[str] = set()
        for row in json.loads(DEFAULT_SEED.read_text(encoding="utf-8")):
            raw = clean_text(row.get("Бизнес-заказчик"))
            if not raw:
                continue
            people = _persons(raw)
            missing |= {p for p in people if p not in listed}
            if not people and raw not in listed:
                missing.add(raw)
        assert not missing, f"нет в справочнике: {sorted(missing)}"

    def test_every_division_in_the_snapshot_is_listed(self, refs):
        import json

        from app.core.loader import DEFAULT_SEED
        from app.core.normalise import clean_text
        from app.core.references import _split_divisions

        listed = set(refs.raw["customer_levels"]["divisions"])
        missing: set[str] = set()
        for row in json.loads(DEFAULT_SEED.read_text(encoding="utf-8")):
            raw = clean_text(row.get("Подразделение Бизнес-заказчика"))
            missing |= {d for d in _split_divisions(raw) if d not in listed}
        assert not missing, f"нет в справочнике: {sorted(missing)}"

    def test_all_levels_are_valid(self, refs):
        levels = set(refs.raw["customer_levels"]["levels"])
        payload = refs.raw["customer_levels"]
        for section in ("customers", "groups", "divisions"):
            for name, level in (payload.get(section) or {}).items():
                assert level in levels, f"{section}/{name}: неизвестный уровень {level!r}"
