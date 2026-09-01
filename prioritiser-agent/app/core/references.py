"""Справочники агента: загрузка из YAML, хранение в БД, доступ из расчётов.

YAML в `data/references/` — это seed. Действующая версия живёт в таблице
`reference`: методолог правит её через админ-панель, каждое сохранение создаёт
новую версию со своим автором и временем (US-4). Расчёт всегда читает активную
версию из БД, а если БД ещё не проинициализирована — падает обратно на YAML,
чтобы формулы можно было считать без базы (это нужно тестам и CLI).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import REFERENCES_DIR
from app.core.models import Reference

# Латиница, подставленная вместо кириллицы при вводе: в бэклоге «C. Фидаров»
# встречается и с латинской C, и с кириллической С. Без приведения это два
# разных заказчика, и методологу пришлось бы заполнять оба написания.
#
# Приведение применяется ТОЛЬКО к инициалу перед кириллической фамилией. Ко
# всей строке его применять нельзя: подразделения `IB`, `M&A`, `RE` и `L2P`
# латинские по существу, и перевод превратил бы их в `IВ`, `М&А`, `RЕ`, `L2Р`,
# которых нет ни в одном справочнике.
_HOMOGLYPHS = str.maketrans("ABCEHKMOPTXY", "АВСЕНКМОРТХУ")

# ФИО в формате бэклога: инициал, точка, фамилия. Одна строка может содержать
# несколько таких групп подряд, без всяких разделителей.
_PERSON_RE = re.compile(r"([A-ZА-ЯЁ])\.\s*([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)")


def _persons(value: str | None) -> list[str]:
    """Все ФИО в строке. Пустой список означает, что значение не персональное."""
    if not value or not value.strip():
        return []
    return [
        f"{initial.translate(_HOMOGLYPHS)}. {surname}"
        for initial, surname in _PERSON_RE.findall(value)
    ]


def _split_divisions(value: str | None) -> list[str]:
    """«ЦР, РД, ОД, УСИ» → четыре подразделения."""
    if not value or not value.strip():
        return []
    return [part.strip() for part in re.split(r"[,/]", value) if part.strip()]

REFERENCE_NAMES = (
    "teams",
    "customer_levels",
    "task_types",
    "factor_weights",
    "overrides",
    "value_defaults",
    "strategy_rubric",
    "value_intervals",
    "value_drivers",
)


class ReferenceError(RuntimeError):
    pass


@lru_cache(maxsize=None)
def load_yaml_reference(name: str) -> dict[str, Any]:
    path = REFERENCES_DIR / f"{name}.yaml"
    if not path.exists():
        raise ReferenceError(f"справочник не найден: {path}")
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def seed_references(session: Session, actor: str = "seed", force: bool = False) -> list[str]:
    """Заливает YAML-справочники в БД. Существующие не трогает, если не force."""
    seeded: list[str] = []
    for name in REFERENCE_NAMES:
        existing = session.scalar(
            select(Reference).where(Reference.name == name, Reference.is_active.is_(True))
        )
        if existing is not None and not force:
            continue
        if existing is not None:
            existing.is_active = False
        payload = load_yaml_reference(name)
        version = (existing.version + 1) if existing is not None else 1
        session.add(
            Reference(name=name, version=version, is_active=True, payload=payload, actor=actor)
        )
        seeded.append(name)
    return seeded


def get_reference(session: Session | None, name: str) -> dict[str, Any]:
    return get_reference_with_version(session, name)[0]


def get_reference_with_version(session: Session | None, name: str) -> tuple[dict[str, Any], int]:
    """Содержимое справочника и его действующая версия.

    Версию надо брать из строки таблицы, а не из поля `version` внутри YAML:
    первая растёт при каждом сохранении методологом, второе меняется только
    когда кто-то правит файл в репозитории. Перепутать их — значит не заметить
    правку через админ-панель: ключ кэша не изменится, и запрос вернёт ответ,
    посчитанный по прежним весам.
    """
    if session is not None:
        row = session.scalar(
            select(Reference).where(Reference.name == name, Reference.is_active.is_(True))
        )
        if row is not None:
            return row.payload, int(row.version)
    payload = load_yaml_reference(name)
    return payload, int(payload.get("version", 0))


def save_reference(
    session: Session, name: str, payload: dict[str, Any], actor: str
) -> Reference:
    """Сохраняет новую версию справочника, деактивируя предыдущую."""
    if name not in REFERENCE_NAMES:
        raise ReferenceError(f"неизвестный справочник: {name}")
    if name == "factor_weights":
        validate_weights(payload)
    if name == "strategy_rubric":
        from app.strategy.rubric import RubricError, validate_strategy_rubric

        try:
            validate_strategy_rubric(payload)
        except RubricError as exc:
            raise ReferenceError(str(exc)) from exc

    current = session.scalar(
        select(Reference).where(Reference.name == name, Reference.is_active.is_(True))
    )
    version = (current.version + 1) if current is not None else 1
    if current is not None:
        current.is_active = False
    row = Reference(name=name, version=version, is_active=True, payload=payload, actor=actor)
    session.add(row)
    return row


def validate_weights(payload: dict[str, Any], tolerance: float = 1e-6) -> None:
    """ТЗ Ф17: сумма весов обязана равняться 1."""
    weights = payload.get("weights") or {}
    if not weights:
        raise ReferenceError("в справочнике весов пустой раздел weights")
    total = sum(float(v) for v in weights.values())
    if abs(total - 1.0) > tolerance:
        raise ReferenceError(f"сумма весов должна быть равна 1, получено {total:.6f}")


@dataclass(frozen=True)
class Constants:
    """Параметры методики в виде, удобном для формул.

    Источник — раздел `policy` и драйверы из `value_drivers.yaml`. Отдельного
    `constants.yaml` больше нет: файл содержал числа, происхождение которых
    подтвердить не удалось, и по решению владельца от 2026-08-14 упразднён.

    Ставки труда здесь **выводятся**, а не хранятся: стоимость часа и минуты
    считаются из годового бюджета ПШЕ и производственного календаря. Второй
    источник правды для одной и той же величины неизбежно расходится с первым —
    в старом файле стояло 3000 ₽/час при бюджете ПШЕ 6 млн, и совпадение
    держалось только на удаче.
    """

    fte_annual_budget_rub: float
    hours_per_man_day: float
    working_days_per_year: int
    discount_rate_annual: float
    horizon_years: int
    discounting_enabled: bool

    @property
    def man_hour_rate_rub(self) -> float:
        """Ставка человеко-часа. Выводится из бюджета ПШЕ."""
        return self.fte_annual_budget_rub / self.working_days_per_year / self.hours_per_man_day

    @property
    def fte_minute_cost_rub(self) -> float:
        """Стоимость минуты ПШЕ. Выводится из того же бюджета."""
        return self.man_hour_rate_rub / 60.0

    @classmethod
    def from_drivers(cls, payload: dict[str, Any]) -> "Constants":
        policy = payload.get("policy") or {}
        drivers = payload.get("drivers") or {}
        calendar = payload.get("working_days_per_year") or {}

        def policy_value(key: str, default: Any) -> Any:
            entry = policy.get(key)
            return entry.get("value", default) if isinstance(entry, dict) else default

        def driver_value(key: str, default: Any) -> Any:
            entry = drivers.get(key)
            return entry.get("value", default) if isinstance(entry, dict) else default

        return cls(
            fte_annual_budget_rub=float(driver_value("fte_annual_budget_rub", 6_000_000)),
            hours_per_man_day=float(driver_value("hours_per_working_day", 8)),
            working_days_per_year=int(calendar.get("default", 247)),
            discount_rate_annual=float(policy_value("discount_rate_annual", 0.24)),
            horizon_years=int(policy_value("horizon_years", 3)),
            discounting_enabled=bool(policy_value("discounting_enabled", True)),
        )

    def discount_factor(self) -> float:
        """Аннуитетный множитель: эффект приходит равными долями horizon_years лет.

        Считаем именно так, а не дисконтированием одной суммы на конец горизонта:
        экономия времени и дополнительные сделки возникают в течение всего срока,
        а не разом в последний год.
        """
        if not self.discounting_enabled or self.horizon_years <= 0:
            return 1.0
        rate = self.discount_rate_annual
        if rate <= 0:
            return 1.0
        factors = [1.0 / ((1.0 + rate) ** year) for year in range(1, self.horizon_years + 1)]
        return sum(factors) / self.horizon_years


class ReferenceBundle:
    """Все справочники, прочитанные один раз на прогон расчёта."""

    def __init__(self, session: Session | None = None) -> None:
        loaded = {name: get_reference_with_version(session, name) for name in REFERENCE_NAMES}
        self.raw = {name: payload for name, (payload, _) in loaded.items()}
        self._versions = {name: version for name, (_, version) in loaded.items()}
        self.constants = Constants.from_drivers(self.raw["value_drivers"])

    def versions(self) -> dict[str, int]:
        """Действующие версии всех справочников.

        Уходят в ответ Координатору и входят в ключ кэша: без них расхождение
        двух оценок одной задачи необъяснимо — непонятно, агент передумал или
        методолог поменял веса.
        """
        return dict(self._versions)

    # --- teams --------------------------------------------------------------
    def team_class(self, team: str | None) -> str:
        payload = self.raw["teams"]
        default = payload.get("default_class", "serving")
        if not team:
            return default
        for entry in payload.get("teams", []):
            if entry.get("name") == team:
                return entry.get("class", default)
        return default

    # --- customers ----------------------------------------------------------
    def customer_level(self, customer: str | None, division: str | None = None) -> str:
        """Уровень заказчика по ФИО, коллективному имени или подразделению.

        Поле «Бизнес-заказчик» в бэклоге редко содержит ровно одного человека:
        встречаются «В. Баклушин, Д. Козлов», «Д. Кулюкин / С. Фидаров» и
        «М. Первак Д. Фомин Д. Козлов Ю. Шилов». Требовать от методолога
        заполнить каждую такую комбинацию отдельной строкой значило бы просить
        41 человека расписать 55 раз, и любая новая пара снова осталась бы
        неизвестной. Поэтому ФИО извлекаются из строки, ищутся поодиночке, и
        берётся самый высокий найденный уровень: заявка, под которой стоит
        директор, не становится менее весомой оттого, что рядом расписались
        ещё трое.
        """
        payload = self.raw["customer_levels"]
        default = str(payload.get("default_level", "unknown"))

        names = _persons(customer)
        if names:
            level = self._strongest_level(names, payload.get("customers") or {}, default)
            if level != default:
                return level
        else:
            # Значение не персональное: коллективный заказчик вроде «УСИ (общая)».
            # Устаревшая раскладка держала таких в `customers`, поэтому смотрим оба.
            key = (customer or "").strip()
            for section in ("groups", "customers"):
                level = str((payload.get(section) or {}).get(key, default))
                if key and level != default:
                    return level

        parts = _split_divisions(division)
        if parts:
            return self._strongest_level(parts, payload.get("divisions") or {}, default)
        return default

    def _strongest_level(
        self, keys: list[str], mapping: dict[str, Any], default: str
    ) -> str:
        """Самый высокий по баллу уровень среди найденных ключей.

        Значения, равные `default`, отбрасываются: «не знаю» не должно
        побеждать проставленный уровень команды только потому, что его
        нейтральный балл 0.5 численно выше, чем 0.2 у `team`.
        """
        found = [str(mapping[k]) for k in keys if k in mapping and str(mapping[k]) != default]
        if not found:
            return default
        return max(found, key=self.customer_level_score)

    def customer_level_score(self, level: str) -> float:
        levels = self.raw["customer_levels"].get("levels") or {}
        entry = levels.get(level) or {}
        return float(entry.get("score", 0.5))

    def customer_level_min_priority(self, level: str) -> str | None:
        levels = self.raw["customer_levels"].get("levels") or {}
        entry = levels.get(level) or {}
        return entry.get("min_priority")

    # --- task types ---------------------------------------------------------
    def task_type_score(self, task_type: str | None) -> float:
        payload = self.raw["task_types"]
        default = float(payload.get("default_score", 0.5))
        if not task_type:
            return default
        entry = (payload.get("types") or {}).get(task_type)
        if isinstance(entry, dict):
            return float(entry.get("score", default))
        return default

    # --- weights ------------------------------------------------------------
    @property
    def weights(self) -> dict[str, float]:
        return {k: float(v) for k, v in (self.raw["factor_weights"].get("weights") or {}).items()}

    @property
    def priority_bands(self) -> dict[str, float]:
        return {
            k: float(v)
            for k, v in (self.raw["factor_weights"].get("priority_bands") or {}).items()
        }

    @property
    def normalisation(self) -> dict[str, Any]:
        return self.raw["factor_weights"].get("normalisation") or {}

    # --- overrides ----------------------------------------------------------
    @property
    def override_rules(self) -> list[dict[str, Any]]:
        return [r for r in (self.raw["overrides"].get("rules") or []) if r.get("enabled")]

    @property
    def detection(self) -> dict[str, list[str]]:
        return self.raw["overrides"].get("detection") or {}

    # --- value defaults -----------------------------------------------------
    @property
    def value_defaults(self) -> dict[str, Any]:
        return self.raw["value_defaults"]

    # --- драйверы расчёта ---------------------------------------------------
    @property
    def value_drivers(self) -> dict[str, Any]:
        return self.raw["value_drivers"]

    def driver(self, name: str) -> dict[str, Any] | None:
        """Драйвер по имени. None означает «нет», а не «ноль»."""
        return (self.value_drivers.get("drivers") or {}).get(name)

    def driver_value(self, name: str) -> float | None:
        """Значение драйвера. None — драйвера нет, подставлять нечего."""
        entry = self.driver(name)
        return float(entry["value"]) if entry and "value" in entry else None

    def driver_applies_to(self, name: str, team: str | None) -> bool:
        """Годится ли драйвер для этой команды.

        Драйвер без `applies_to` универсален. С перечнем команд — только для
        них: средний доход на сделку Pre-Trade нельзя молча применить к IB, у
        которого другой масштаб сделки на два порядка.
        """
        entry = self.driver(name)
        if entry is None:
            return False
        teams = (entry.get("applies_to") or {}).get("teams")
        return True if not teams else team in teams

    def deal_value_rub(self, team: str | None) -> tuple[float, str, str | None] | None:
        """Стоимость одной сделки для команды.

        Возвращает `(значение, происхождение, чья величина)` либо None, если
        взять её негде совсем. Происхождение — `reference`, когда драйвер
        отнесён к самой команде, и `substitution`, когда пришлось занять у
        соседней зарабатывающей команды.

        Единой константы «одна сделка = 50 млн» больше нет: её происхождение
        подтвердить не удалось, а обоснования команд ей противоречат. Pre-Trade
        считает сделку как средний доход в месяц за средний срок, то есть
        27 млн; у IB своей величины нет, потому что команда оценивает эффект от
        годового дохода и прироста, а не поштучно.

        Отказываться от расчёта в таком случае мы не будем (решение владельца от
        2026-08-18): оценка на заимствованной величине с понижённой уверенностью
        полезнее пустоты, а насколько она годится, видно из перекрёстной
        проверки с аналогией.
        """
        own = self._deal_value_of(team)
        if own is not None:
            return own, "reference", team

        rule = (self.value_drivers.get("team_substitutions") or {}).get("deal_value") or {}
        donor = rule.get("default_source_team")
        if not donor or donor == team:
            return None
        borrowed = self._deal_value_of(donor)
        if borrowed is None:
            return None
        return borrowed, "substitution", donor

    # Прямые величины финансовой модели: средний доход по одной сделке. У них
    # есть привязка к статьям учёта, поэтому они приоритетнее величин,
    # выведенных из пояснений команд, где числа были рабочими допущениями.
    _DEAL_VALUE_DRIVERS = ("ib_avg_deal_revenue_mln", "pretrade_avg_deal_revenue_mln")

    def _deal_value_of(self, team: str | None) -> float | None:
        """Стоимость сделки, отнесённая именно к этой команде. Без замен."""
        for name in self._DEAL_VALUE_DRIVERS:
            if self.driver_applies_to(name, team):
                value = self.driver_value(name)
                if value is not None:
                    return value * 1_000_000  # драйвер в млн ₽, наружу — рубли

        # Запасной путь: доход за месяц × срок сделки. Так считала команда
        # Pre-Trade до появления выгрузки из финансовой модели.
        if not (
            self.driver_applies_to("avg_deal_revenue_rub_per_month", team)
            and self.driver_applies_to("avg_deal_duration_months", team)
        ):
            return None
        monthly = self.driver_value("avg_deal_revenue_rub_per_month")
        months = self.driver_value("avg_deal_duration_months")
        if monthly is None or months is None:
            return None
        return monthly * months

    def working_days(self, year: int | None = None) -> int:
        """Рабочих дней в году по производственному календарю.

        Усреднённое значение здесь не годится: на горизонте в три года разница
        между 247 и 252 днями сдвигает оценку экономии времени примерно на 2%,
        а сам календарь меняется от года к году и известен точно.
        """
        payload = self.value_drivers.get("working_days_per_year") or {}
        default = int(payload.get("default", 247))
        if year is None:
            return default

        # Ключ ищется и числом, и строкой. Справочник хранится в JSON-колонке, а
        # в JSON ключи объекта всегда строковые: из YAML год приходит как 2028,
        # из базы — как "2028". Поиск только по одному виду молча возвращал бы
        # значение по умолчанию, и подмена была бы незаметна.
        by_year = payload.get("by_year") or {}
        for key in (year, str(year)):
            if key in by_year:
                return int(by_year[key])
        return default

    # --- калибровка интервала Value -----------------------------------------
    @property
    def value_intervals(self) -> dict[str, Any]:
        return self.raw["value_intervals"]

    # --- рубрики F5 и F6 ----------------------------------------------------
    @property
    def strategy_rubric(self) -> dict[str, Any]:
        return self.raw["strategy_rubric"]

    @property
    def team_names(self) -> list[str]:
        return [str(entry.get("name")) for entry in (self.raw["teams"].get("teams") or [])]
