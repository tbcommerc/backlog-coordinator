"""Вес доходного метода в итоговой оценке Value.

Итог всегда складывается из двух методов — доходного и сравнительного, —
меняется только их соотношение (решение владельца от 2026-08-20). Простое
среднее пополам было первой редакцией этого решения и оказалось плохим: оно
одинаково доверяло методу, собранному из измеренных величин, и методу,
собранному из подстановок.

Вес определяется двумя измеримыми вещами:

* **обоснованность доходного метода** — какая доля вводных пришла из атрибутов
  задачи и справочника, а какая подставлена типовым значением или занята у
  другой команды;
* **качество аналогов** — сколько их, насколько они похожи, из своей ли команды
  и насколько согласуются между собой их значения.

Чем лучше обоснован доходный метод, тем больше его вес; чем лучше аналоги, тем
меньше. Границы заданы владельцем: от 10% до 90%, когда аналоги есть, и ровно
100%, когда аналогов нет — сравнивать тогда не с чем.

**Почему аналоги отбирают вес только у необоснованной части.** Если доходный
метод целиком собран из измеренных величин, разбавлять его аналогией незачем,
как бы хороша она ни была: она воспроизводит прошлые оценки команд вместе с их
систематическими сдвигами, а расчёт по драйверам объясним и защитим. Поэтому
качество аналогов умножается на долю *неподтверждённых* вводных доходного
метода. При полностью обоснованном расчёте вес остаётся 90% независимо от того,
насколько удачные аналоги нашлись.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Границы веса доходного метода, когда аналоги есть.
WEIGHT_MIN = 0.10
WEIGHT_MAX = 0.90

# Вес доходного метода, когда аналогов нет: сравнивать не с чем.
WEIGHT_WITHOUT_ANALOGUES = 1.00

# Насколько сильно хорошие аналоги отбирают вес у необоснованной части
# доходного метода. 0.8 означает, что при полностью типовых вводных и отличных
# аналогах вес доходного метода падает почти до нижней границы.
ANALOGUE_PULL = 0.8

# Вклад вводной в обоснованность по её происхождению. Заимствованная у другой
# команды величина — половина: она измерена, но не у этой команды.
_ORIGIN_QUALITY = {
    "attribute": 1.0,      # из атрибутов самой задачи
    "constant": 1.0,       # из справочника драйверов
    "substitution": 0.5,   # занята у другой команды
    "llm": 0.0,            # догадка модели
    "typical": 0.0,        # типовое значение справочника, никем не измеренное
}

# Вводные, не относящиеся к самой задаче: они одинаковы для всех и об
# обоснованности расчёта ничего не говорят.
_METHODOLOGY_INPUTS = {"horizon_years", "discount_factor"}

# Схожесть, ниже которой аналог бесполезен, и выше которой он уже дословный.
_SIMILARITY_FLOOR = 0.90
_SIMILARITY_CEILING = 0.98


@dataclass
class MethodWeights:
    """Веса двух методов и разбор того, откуда они взялись."""

    drivers: float
    analogy: float
    driver_support: float
    analogue_quality: float
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "drivers": round(self.drivers, 3),
            "analogy": round(self.analogy, 3),
            "driver_support": round(self.driver_support, 3),
            "analogue_quality": round(self.analogue_quality, 3),
            "reasons": list(self.reasons),
        }


def driver_support(inputs: list[dict[str, Any]] | None) -> float:
    """Доля обоснованных вводных доходного метода, 0..1.

    Единица означает, что каждая величина взята из атрибутов задачи или из
    справочника. Ноль — что весь расчёт держится на типовых значениях, которые
    никем не измерены.
    """
    if not inputs:
        return 0.0
    scored = [
        _ORIGIN_QUALITY.get(item.get("origin"), 0.0)
        for item in inputs
        if item.get("name") not in _METHODOLOGY_INPUTS
    ]
    if not scored:
        return 0.0
    return sum(scored) / len(scored)


def analogue_quality(
    count: int,
    best_similarity: float,
    same_team: bool,
    value_spread: float,
) -> float:
    """Качество сравнительного метода, 0..1.

    Учитываются четыре вещи, и каждая может обнулить доверие к аналогии:
    сколько аналогов нашлось, насколько ближайший похож, своей ли он команды и
    насколько согласуются значения самих аналогов. Последнее важнее, чем
    кажется: три дословно похожие задачи со значениями 50, 200 и 400 млн ₽ дают
    медиану, но не дают основания ей верить.
    """
    if count <= 0:
        return 0.0

    span = _SIMILARITY_CEILING - _SIMILARITY_FLOOR
    similarity = min(max((best_similarity - _SIMILARITY_FLOOR) / span, 0.0), 1.0)

    count_factor = {1: 0.5, 2: 0.8}.get(count, 1.0)

    if value_spread >= 20.0:
        spread_factor = 0.3
    elif value_spread >= 5.0:
        spread_factor = 0.6
    else:
        spread_factor = 1.0

    team_factor = 1.0 if same_team else 0.85

    return similarity * count_factor * spread_factor * team_factor


def compute_weights(
    driver_inputs: list[dict[str, Any]] | None,
    analogy_available: bool,
    count: int = 0,
    best_similarity: float = 0.0,
    same_team: bool = False,
    value_spread: float = 1.0,
) -> MethodWeights:
    """Веса доходного и сравнительного методов для одной задачи."""
    support = driver_support(driver_inputs)

    if not analogy_available:
        return MethodWeights(
            drivers=WEIGHT_WITHOUT_ANALOGUES,
            analogy=0.0,
            driver_support=support,
            analogue_quality=0.0,
            reasons=[
                "Похожих задач с человеческим Value не нашлось — сравнительный "
                "метод провести не на чем, весь вес у доходного."
            ],
        )

    quality = analogue_quality(count, best_similarity, same_team, value_spread)

    # Аналоги отбирают вес только у той части доходного метода, которая не
    # подтверждена: обоснованный расчёт разбавлять незачем.
    weight = WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * support
    weight -= ANALOGUE_PULL * quality * (1.0 - support) * (WEIGHT_MAX - WEIGHT_MIN)
    weight = min(max(weight, WEIGHT_MIN), WEIGHT_MAX)

    reasons = [
        f"Обоснованность доходного метода: {support:.0%} вводных из атрибутов "
        f"задачи и справочника.",
        f"Качество аналогов: {quality:.0%} — {count} шт., схожесть "
        f"{best_similarity:.2f}, разброс значений {value_spread:g}×"
        + (", своя команда." if same_team else ", чужая команда."),
    ]
    if support >= 0.999:
        reasons.append(
            "Доходный метод обоснован полностью, поэтому аналоги вес у него не "
            "отбирают: расчёт по драйверам объясним, аналогия лишь повторяет "
            "прошлые оценки команд."
        )

    return MethodWeights(
        drivers=round(weight, 3),
        analogy=round(1.0 - weight, 3),
        driver_support=support,
        analogue_quality=quality,
        reasons=reasons,
    )
