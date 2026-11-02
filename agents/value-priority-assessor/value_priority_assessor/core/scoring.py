"""Приоритизация: семь факторов, взвешенная свёртка, овверрайды, шкала P1–P5.

`Priority Score = Σᵢ (wᵢ × Sᵢ × mᵢ)`, где Sᵢ ∈ [0, 1], Σᵢ wᵢ = 1, а множитель mᵢ
отличен от единицы только у F1 — там это уверенность в оценке Value.

Коды факторов идут подряд, F1–F7. Раньше нумерация шла от ТЗ и сохраняла дыру
на месте исключённого C/V; дыра оставляла в модели след фактора, которого нет,
и читателю приходилось объяснять её в каждом документе. Решение владельца от
2026-08-26: коды сброшены, соответствие старым записям восстанавливается по
версии методики в аудите ответа.

F1 (Value) нормализуется относительно всего бэклога, а не сам по себе, поэтому
расчёт одной задачи требует контекста: `ScoringContext` собирается один раз на
прогон и переиспользуется.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from typing import Any, Iterable

from value_priority_assessor.core.models import Task
from value_priority_assessor.core.references import ReferenceBundle, ReferenceError

PRIORITY_ORDER = ("P1", "P2", "P3", "P4", "P5")


@dataclass
class ScoringContext:
    """Величины, которые нельзя посчитать по одной задаче."""

    max_value_mln: float = 0.0
    today: dt.date = field(default_factory=dt.date.today)

    @classmethod
    def from_tasks(cls, tasks: Iterable[Task], today: dt.date | None = None) -> "ScoringContext":
        values = [t.value_internal_mln or 0.0 for t in tasks]
        return cls(
            max_value_mln=max(values, default=0.0),
            today=today or dt.date.today(),
        )


@dataclass
class ScoreResult:
    score: float
    priority: str
    factors: dict[str, float]
    multipliers: dict[str, float]
    contributions: dict[str, float]
    applied_overrides: list[dict[str, Any]]
    reason: str


# --- Отдельные факторы -------------------------------------------------------


def factor_value(task: Task, ctx: ScoringContext) -> float:
    """F1. Логарифмическая нормализация относительно максимума в бэклоге.

    Логарифм здесь принципиален: в бэклоге эффекты различаются на два порядка,
    и линейная шкала схлопнула бы все задачи кроме одной-двух в ноль.
    """
    value = task.value_internal_mln or 0.0
    if value <= 0 or ctx.max_value_mln <= 0:
        return 0.0
    return min(1.0, math.log1p(value) / math.log1p(ctx.max_value_mln))


def factor_customer_level(task: Task, refs: ReferenceBundle) -> float:
    """F2. Дискретный балл из справочника уровней заказчика."""
    level = refs.customer_level(task.customer, task.customer_division)
    return refs.customer_level_score(level)


def factor_urgency(task: Task, refs: ReferenceBundle, ctx: ScoringContext) -> float:
    """F3. Ступенчато по числу дней до дедлайна."""
    config = refs.normalisation.get("F3_urgency") or {}
    if task.deadline is None:
        return float(config.get("no_deadline", 0.1))
    days = (task.deadline - ctx.today).days
    if days < 0:
        # Просроченная задача не может быть менее срочной, чем задача на завтра.
        return 1.0
    for threshold, score in config.get("steps", []):
        if days <= threshold:
            return float(score)
    return float(config.get("fallback", 0.1))


def factor_effort(task: Task, refs: ReferenceBundle) -> float:
    """F4. Обратная нормализация трудозатрат, линейно между порогами."""
    config = refs.normalisation.get("F4_effort") or {}
    if task.effort_man_days is None:
        return float(config.get("unknown", 0.5))
    low = float(config.get("low_man_days", 5))
    high = float(config.get("high_man_days", 50))
    low_score = float(config.get("low_score", 1.0))
    high_score = float(config.get("high_score", 0.3))
    effort = task.effort_man_days
    if effort < low:
        return low_score
    if effort > high:
        return high_score
    if high == low:
        return high_score
    ratio = (effort - low) / (high - low)
    return low_score + ratio * (high_score - low_score)


def factor_strategy_fit(task: Task, refs: ReferenceBundle) -> float:
    """F5. Балл 1–10 от Strategy Decomposer → 0.1–1.0."""
    config = refs.normalisation.get("F5_strategy_fit") or {}
    raw_min = float(config.get("raw_min", 1))
    raw_max = float(config.get("raw_max", 10))
    out_min = float(config.get("out_min", 0.1))
    out_max = float(config.get("out_max", 1.0))
    if task.strategy_fit_raw is None:
        return (out_min + out_max) / 2
    raw = max(raw_min, min(raw_max, float(task.strategy_fit_raw)))
    if raw_max == raw_min:
        return out_max
    return out_min + (raw - raw_min) / (raw_max - raw_min) * (out_max - out_min)


def factor_dependencies(task: Task, refs: ReferenceBundle) -> float:
    """F6. Чем больше и жёстче зависимости, тем ниже балл.

    Если по задаче есть оценка субагента, берётся её балл: он учитывает тип
    связи, а не только число команд. Блокирующая поставка и три команды,
    которые достаточно уведомить, — разные по управляемости, и одинаковый штраф
    за них искажает ранжирование.

    Без оценки работает прежнее правило по счётчику вовлечённых команд.
    """
    if task.dependency_score is not None:
        return max(0.0, min(1.0, float(task.dependency_score)))

    config = refs.normalisation.get("F6_dependencies") or {}
    step = float(config.get("step", 0.2))
    floor = float(config.get("floor", 0.2))
    return max(floor, 1.0 - step * (task.involved_teams_count or 0))


def factor_task_type(task: Task, refs: ReferenceBundle) -> float:
    """F7. Дискретный коэффициент из справочника типов."""
    return refs.task_type_score(task.task_type)


def confidence_multiplier(task: Task, refs: ReferenceBundle) -> float:
    """Множитель к вкладу фактора F1 по уверенности в оценке Value.

    Уверенность — не самостоятельное свойство задачи, а свойство того,
    насколько хорошо мы знаем её Value. Слагаемым она вела себя неверно:
    задача с Value 0.1 млн ₽ и высокой уверенностью получала прибавку больше,
    чем задача с Value 3000 млн ₽ и низкой, — хотя вклад уверенности должен
    зависеть от того, что именно она подтверждает.

    Та же ошибка, что была у фактора C/V: величина, выведенная из другой,
    входила в модель отдельным слагаемым. Здесь она входит множителем, и
    ненадёжная оценка Value ослабляет собственный вклад, а не добавляет
    задаче балл со стороны.

    Решение владельца от 2026-08-21.
    """
    config = refs.normalisation.get("F1_confidence_multiplier") or {}
    mapping = {
        "high": float(config.get("high", 1.0)),
        "medium": float(config.get("medium", 0.7)),
        "low": float(config.get("low", 0.3)),
    }
    return mapping.get(task.value_confidence or "low", mapping["low"])


# C/V из факторов исключён: он равен Cost / Value, то есть целиком выводится из
# трудозатрат (F4) и Value (F1), и не приносит в модель ни одной новой вводной.
# Веса при этом лгали: объявленные 0.15 на Value и 0.08 на трудозатраты на деле
# работали как 0.22 и 0.13, потому что те же величины входили второй раз через
# C/V. Показатель остаётся в карточке задачи как диагностика — считается, но не
# оценивается. Разбор с числами — docs/DEVIATIONS-FROM-TZ.md.
FACTOR_TITLES = {
    "F1_value": "Value (внутренний)",
    "F2_customer_level": "Уровень бизнес-заказчика",
    "F3_urgency": "Срочность",
    "F4_effort": "Ресурсоёмкость",
    "F5_strategy_fit": "Стратегическое соответствие",
    "F6_dependencies": "Зависимость от команд",
    "F7_task_type": "Тип задачи",
}


def compute_factors(task: Task, refs: ReferenceBundle, ctx: ScoringContext) -> dict[str, float]:
    return {
        "F1_value": factor_value(task, ctx),
        "F2_customer_level": factor_customer_level(task, refs),
        "F3_urgency": factor_urgency(task, refs, ctx),
        "F4_effort": factor_effort(task, refs),
        "F5_strategy_fit": factor_strategy_fit(task, refs),
        "F6_dependencies": factor_dependencies(task, refs),
        "F7_task_type": factor_task_type(task, refs),
    }


# --- Овверрайды и шкала ------------------------------------------------------


def score_to_priority(score: float, refs: ReferenceBundle) -> str:
    """ТЗ Ф20."""
    bands = refs.priority_bands
    if score >= bands.get("P1", 0.8):
        return "P1"
    if score >= bands.get("P2", 0.6):
        return "P2"
    if score >= bands.get("P3", 0.4):
        return "P3"
    if score >= bands.get("P4", 0.2):
        return "P4"
    return "P5"


def _stronger(left: str, right: str) -> str:
    """Возвращает более высокий приоритет (P1 сильнее P2)."""
    return left if PRIORITY_ORDER.index(left) <= PRIORITY_ORDER.index(right) else right


def _rule_matches(rule: dict[str, Any], task: Task, refs: ReferenceBundle, ctx: ScoringContext) -> bool:
    when = rule.get("when") or {}

    if "is_regulatory" in when and bool(task.is_regulatory) != bool(when["is_regulatory"]):
        return False
    if "is_blocking" in when and bool(task.is_blocking) != bool(when["is_blocking"]):
        return False
    if "is_rnd" in when and bool(task.is_rnd) != bool(when["is_rnd"]):
        return False

    if "task_type_in" in when:
        if task.task_type not in (when.get("task_type_in") or []):
            return False

    if "team_in" in when:
        if task.team not in (when.get("team_in") or []):
            return False

    if "customer_level_in" in when:
        level = refs.customer_level(task.customer, task.customer_division)
        if level not in (when.get("customer_level_in") or []):
            return False

    if "days_to_deadline_lte" in when:
        if task.deadline is None:
            return False
        if (task.deadline - ctx.today).days > int(when["days_to_deadline_lte"]):
            return False

    return True


def apply_overrides(
    task: Task, refs: ReferenceBundle, ctx: ScoringContext, priority: str
) -> tuple[str, list[dict[str, Any]]]:
    """Применяет правила справочника. `set_priority` жёстче `min_priority`."""
    applied: list[dict[str, Any]] = []
    result = priority

    for rule in refs.override_rules:
        if not _rule_matches(rule, task, refs, ctx):
            continue
        then = rule.get("then") or {}
        before = result
        if "set_priority" in then:
            result = _stronger(result, str(then["set_priority"]))
        if "min_priority" in then:
            result = _stronger(result, str(then["min_priority"]))
        if result != before or "set_priority" in then or "min_priority" in then:
            applied.append(
                {
                    "id": rule.get("id"),
                    "title": rule.get("title"),
                    "reason": rule.get("reason"),
                    "priority_before": before,
                    "priority_after": result,
                }
            )

    # Уровень заказчика может задавать минимальный приоритет и вне списка правил.
    level = refs.customer_level(task.customer, task.customer_division)
    level_min = refs.customer_level_min_priority(level)
    if level_min:
        before = result
        result = _stronger(result, level_min)
        if result != before:
            applied.append(
                {
                    "id": f"customer_level:{level}",
                    "title": f"Уровень заказчика «{level}» задаёт минимум {level_min}",
                    "reason": "Справочник уровней бизнес-заказчика",
                    "priority_before": before,
                    "priority_after": result,
                }
            )

    return result, applied


def _explain(factors: dict[str, float], contributions: dict[str, float], overrides: list[dict[str, Any]]) -> str:
    """US-3: краткое объяснение, какие факторы дали наибольший вклад."""
    top = sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)[:3]
    parts = [
        f"{FACTOR_TITLES.get(code, code)} {contribution:.3f} (балл {factors[code]:.2f})"
        for code, contribution in top
    ]
    text = "Наибольший вклад: " + ", ".join(parts) + "."
    if overrides:
        text += " Сработали правила: " + "; ".join(
            str(o.get("title")) for o in overrides
        ) + "."
    return text


def check_weights_cover_factors(refs: ReferenceBundle) -> None:
    """Справочник весов и набор факторов обязаны совпадать один в один.

    Расхождение проявляется не ошибкой, а тихо заниженными приоритетами. Так
    случилось бы при обновлении установки, где в базе остался справочник с весом
    осиротевшего кода — например `F8_cost_value` от исключённого C/V: фактор не
    вычисляется, его 0.25 повисли бы никому не принадлежащими, и каждый скор
    упал бы на четверть — правдоподобно и незаметно.
    Поэтому падаем сразу и с именами ключей.
    """
    factors = set(FACTOR_TITLES)
    weights = set(refs.weights)
    orphan = weights - factors
    missing = factors - weights
    if orphan or missing:
        parts = []
        if orphan:
            parts.append(f"веса без факторов: {', '.join(sorted(orphan))}")
        if missing:
            parts.append(f"факторы без весов: {', '.join(sorted(missing))}")
        raise ReferenceError(
            "Справочник factor_weights разошёлся с набором факторов — "
            + "; ".join(parts)
            + ". Обновите справочник: python -m app.cli init --reset "
            "или PUT /admin/references/factor_weights."
        )


def compute_multipliers(task: Task, refs: ReferenceBundle) -> dict[str, float]:
    """Множители к вкладу факторов.

    Множитель нужен там, где величина не самостоятельна, а уточняет другую.
    Складывать такие величины с остальными факторами неверно: получается
    двойной счёт одной вводной в двух местах модели.
    """
    return {"F1_value": confidence_multiplier(task, refs)}


def score_task(task: Task, refs: ReferenceBundle, ctx: ScoringContext) -> ScoreResult:
    check_weights_cover_factors(refs)
    factors = compute_factors(task, refs, ctx)
    multipliers = compute_multipliers(task, refs)
    weights = refs.weights
    contributions = {
        code: weights[code] * value * multipliers.get(code, 1.0)
        for code, value in factors.items()
    }
    score = sum(contributions.values())

    priority = score_to_priority(score, refs)
    priority, applied = apply_overrides(task, refs, ctx, priority)

    return ScoreResult(
        score=round(score, 4),
        priority=priority,
        factors={k: round(v, 4) for k, v in factors.items()},
        multipliers={k: round(v, 4) for k, v in multipliers.items()},
        contributions={k: round(v, 4) for k, v in contributions.items()},
        applied_overrides=applied,
        reason=_explain(factors, contributions, applied),
    )
