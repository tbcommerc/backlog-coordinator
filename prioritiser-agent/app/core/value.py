"""Расчёт Value (внутренний контур), Cost и C/V.

Методика зафиксирована ТЗ v2.0, разделы 3.1.1 и 3.1.4, и не пересматривается
без явного решения владельца:

* Value — сырая доходная величина в млн ₽, не NPV и не PI. Дисконтирование
  включается флагом, горизонт 3 года.
* Метод зависит от класса команды: зарабатывающие считают доход от сделок,
  обслуживающие — экономию времени во внутреннем контуре.
* Экономия времени существует ТОЛЬКО во внутреннем контуре. `value_external`
  обслуживающих команд ex-ante не считается вовсе — это прямое ограничение
  руководства банка, а не техническое упрощение (см. docs/METHODOLOGY.md).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.core.intervals import compute_interval
from app.core.models import Task
from app.core.references import ReferenceBundle

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

SOURCE_MANUAL = "manual"
SOURCE_ANALOGY = "analogy"
SOURCE_REVENUE = "revenue"
SOURCE_TIME_SAVING = "time_saving"
SOURCE_ZERO = "zero"
SOURCE_BLENDED = "blended"

STATUS_TBD = "tbd"
STATUS_COMPUTED = "computed"

# Числа в тексте задачи: «5 сделок», «на 30 пользователей», «2 раза в неделю».
_DEALS_RE = re.compile(r"(\d+)\s*(?:сдел|доп\.?\s*сдел)", re.IGNORECASE)
_USERS_RE = re.compile(r"(\d+)\s*(?:пользовател|сотрудник|ПШЕ|человек)", re.IGNORECASE)
_MINUTES_RE = re.compile(r"(\d+)\s*(?:мин)", re.IGNORECASE)
_HOURS_RE = re.compile(r"(\d+)\s*(?:час)", re.IGNORECASE)


@dataclass
class ValueInput:
    """Одна вводная расчёта: значение, откуда взято и явно ли задано."""

    name: str
    value: float
    unit: str
    origin: str  # attribute | llm | constant | substitution
    explicit: bool


@dataclass
class ValueResult:
    value_internal_mln: float | None
    value_external_mln: float | None
    value_external_status: str
    source: str
    confidence: str
    zero_value_reason: str | None
    inputs: dict[str, Any] = field(default_factory=dict)
    hint: str = ""
    missing: list[str] = field(default_factory=list)
    interval: Any | None = None

    # Методы, из которых сложился ответ. В бэклог уходит одно число, но
    # слагаемые обязаны дойти до Координатора: расхождение между ними — главный
    # признак того, можно ли доверять итогу.
    components: list[Any] = field(default_factory=list)
    alternative_unavailable: str | None = None


def _first_number(pattern: re.Pattern[str], text: str | None) -> float | None:
    if not text:
        return None
    match = pattern.search(text)
    return float(match.group(1)) if match else None


def _confidence_from(inputs: list[ValueInput], llm_confident: bool) -> str:
    """ТЗ Ф5. Уверенность зависит от доли фактических вводных."""
    if not inputs:
        return CONFIDENCE_LOW
    explicit = sum(1 for i in inputs if i.explicit)
    ratio = explicit / len(inputs)
    if ratio == 1.0:
        return CONFIDENCE_HIGH
    if ratio >= 0.5 and llm_confident:
        return CONFIDENCE_MEDIUM
    if ratio > 0:
        return CONFIDENCE_MEDIUM if llm_confident else CONFIDENCE_LOW
    return CONFIDENCE_LOW


def _format_hint(
    method_title: str,
    formula: str,
    result_mln: float,
    confidence: str,
    missing: list[str],
    discounted: bool,
    horizon: int,
) -> str:
    """Ф22–Ф23: читаемый текст без диалога и интерактивных элементов."""
    confidence_ru = {
        CONFIDENCE_HIGH: "Высокий",
        CONFIDENCE_MEDIUM: "Средний",
        CONFIDENCE_LOW: "Низкий",
    }[confidence]
    lines = [
        f"Метод расчёта: {method_title}.",
        f"Расчёт: {formula} = {result_mln:,.1f} млн ₽".replace(",", " "),
    ]
    if discounted:
        lines.append(f"Значение дисконтировано на горизонте {horizon} года.")
    lines.append(f"Уверенность в оценке: {confidence_ru}.")
    if missing:
        lines.append("Уточнение повысит точность: " + "; ".join(missing) + ".")
    return "\n".join(lines)


def compute_value(
    task: Task,
    refs: ReferenceBundle,
    llm_hints: dict[str, Any] | None = None,
    analogy_index: Any | None = None,
) -> ValueResult:
    """Считает Value и приклеивает к нему интервал.

    Интервал добавляется здесь, а не в каждой ветке расчёта: методов четыре,
    и забыть его в одной из них означало бы показать точечную оценку без
    признака неопределённости — ровно то, ради чего интервал и вводился.
    """
    result = _compute_value_core(task, refs, llm_hints, analogy_index)

    interval = compute_interval(
        result.value_internal_mln, result.source, result.confidence, refs.value_intervals
    )
    if interval is None:
        return result

    result.interval = interval
    if not interval.is_exact:
        result.hint = _append_interval(result.hint, interval)
    return result


def _append_interval(hint: str, interval: Any) -> str:
    """Дописывает диапазон в подсказку сразу после строки с оценкой."""
    line = (
        f"Диапазон ({interval.coverage:.0%} вероятности): {interval.format_range()}."
    )
    if not interval.calibrated:
        line += (
            " Множители унаследованы от более широкого уровня уверенности — "
            "наблюдений для собственной калибровки пока мало."
        )
    return f"{hint}\n{line}" if hint else line


def _compute_value_core(
    task: Task,
    refs: ReferenceBundle,
    llm_hints: dict[str, Any] | None = None,
    analogy_index: Any | None = None,
) -> ValueResult:
    """Считает value_internal и сопровождающие атрибуты для одной задачи.

    Порядок методов: ручное значение → ноль для регуляторки и RnD → аналогия с
    задачами, где Value заполнил человек → формула только по фактическим
    атрибутам задачи и числам, возвращённым настроенной моделью.

    Аналогия стоит выше формулы не по вкусу: на 192 задачах с известным ответом
    она попадает в двукратную окрестность в 69% случаев против 14% у формулы.
    Формула при этом считается всё равно и уходит в перекрёстную проверку.
    """
    constants = refs.constants
    hints = llm_hints or {}
    text = " ".join(filter(None, [task.title, task.project, task.comment]))

    # --- Ф1: ручное значение приоритетнее любого расчёта --------------------
    if task.value_manual_mln is not None:
        external = task.value_manual_mln if task.team_class == "earning" else None
        return ValueResult(
            value_internal_mln=task.value_manual_mln,
            value_external_mln=external,
            value_external_status=STATUS_COMPUTED if external is not None else STATUS_TBD,
            source=SOURCE_MANUAL,
            confidence=CONFIDENCE_HIGH,
            zero_value_reason=None,
            inputs={"manual_value_mln": task.value_manual_mln},
            hint=(
                "Значение введено вручную — агент его не пересчитывает.\n"
                f"Value = {task.value_manual_mln:,.1f} млн ₽.".replace(",", " ")
            ),
        )

    # --- Ф2: регуляторка и RnD/L2P имеют нулевой Value ----------------------
    if task.is_regulatory or task.is_rnd:
        reason = "regulatory" if task.is_regulatory else "rnd"
        reason_ru = "регуляторная задача" if task.is_regulatory else "исследование / RnD / L2P"
        return ValueResult(
            value_internal_mln=0.0,
            value_external_mln=0.0 if task.team_class == "earning" else None,
            value_external_status=STATUS_COMPUTED if task.team_class == "earning" else STATUS_TBD,
            source=SOURCE_ZERO,
            confidence=CONFIDENCE_HIGH,
            zero_value_reason=reason,
            inputs={"zero_value_reason": reason},
            hint=(
                f"Метод расчёта: не применяется ({reason_ru}).\n"
                "Value = 0 млн ₽ по методике: прямой финансовый эффект не монетизируется.\n"
                "В приоритет задача входит не через Value и C/V, а через правила-овверрайды."
            ),
        )

    discount = constants.discount_factor()
    horizon = constants.horizon_years

    if task.team_class == "earning":
        formula = _compute_revenue(task, refs, hints, text, discount, horizon)
    else:
        formula = _compute_time_saving(task, refs, hints, text, discount, horizon)

    if analogy_index is None:
        return formula

    result = _apply_analogy(task, formula, analogy_index)
    if result.source != SOURCE_ANALOGY:
        # Аналогов не нашлось — ответом остаётся формула, усреднять не с чем.
        return result
    return _blend(analogy=result, formula=formula)


def _blend(analogy: ValueResult, formula: ValueResult) -> ValueResult:
    """Итоговое Value — взвешенная сумма доходной и сравнительной оценок.

    Оба метода участвуют всегда, меняется только соотношение (решение владельца
    от 2026-08-20). Вес считается в `app/core/weights.py` по обоснованности
    вводных доходного метода и качеству найденных аналогов; границы 10–90% при
    наличии аналогов и 100% при их отсутствии заданы там же.

    Прежняя редакция усредняла пополам. Это оказалось хуже: расчёт из
    измеренных величин получал ровно столько же доверия, сколько слабый
    формульный расчёт, а хорошие аналоги весили не больше плохих.
    """
    from app.core.weights import compute_weights

    a, f = analogy.value_internal_mln, formula.value_internal_mln
    if a is None or f is None:
        # Один из методов не дал числа — взвешивать не с чем, но показать его
        # причину всё равно нужно.
        answer = analogy if a is not None else formula
        answer.components = [analogy, formula]
        return answer

    estimate = analogy.inputs or {}
    weights = compute_weights(
        driver_inputs=(formula.inputs or {}).get("components"),
        analogy_available=True,
        count=len(estimate.get("analogues") or []),
        best_similarity=float(estimate.get("best_similarity") or 0.0),
        same_team=bool(estimate.get("same_team")),
        value_spread=float(estimate.get("value_spread") or 1.0),
    )

    blended = weights.drivers * f + weights.analogy * a
    divergence = max(a + 0.5, 0.5) / max(min(a, f) + 0.5, 0.5)

    # Уверенность берётся у метода, который весит больше: раньше бралась худшая
    # из двух, и поскольку доходный метод почти всегда низкой уверенности, итог
    # был низким всегда — диапазон становился бесполезно широким.
    dominant = formula if weights.drivers >= weights.analogy else analogy
    confidence = dominant.confidence
    if divergence >= 3.0:
        # Среднее двух несогласных оценок не надёжнее ни одной из них.
        confidence = _lower_confidence(confidence)

    external = blended if formula.value_external_status == STATUS_COMPUTED else None
    lines = [
        "Метод расчёта: взвешенная сумма доходной и сравнительной оценок.",
        f"Доходный метод: {f:,.1f} млн ₽, вес {weights.drivers:.0%}.".replace(",", " "),
        f"Сравнительный метод (аналогия): {a:,.1f} млн ₽, вес {weights.analogy:.0%}.".replace(",", " "),
        f"Итог: {f:,.1f} × {weights.drivers:.2f} + {a:,.1f} × {weights.analogy:.2f} "
        f"= {blended:,.1f} млн ₽.".replace(",", " "),
        "",
        "Как определён вес:",
    ]
    lines.extend(f"  • {reason}" for reason in weights.reasons)

    if divergence >= 3.0:
        lines.append(
            f"Методы расходятся в {divergence:.1f} раза — уверенность понижена: "
            "среднее двух несогласных оценок не надёжнее ни одной из них."
        )

    missing = list(dict.fromkeys([*formula.missing, *analogy.missing]))
    if missing:
        lines.append("Уточнение повысит точность: " + "; ".join(missing) + ".")

    result = ValueResult(
        value_internal_mln=round(blended, 2),
        value_external_mln=round(external, 2) if external is not None else None,
        value_external_status=formula.value_external_status,
        source=SOURCE_BLENDED,
        confidence=confidence,
        zero_value_reason=None,
        inputs={
            "method": SOURCE_BLENDED,
            "analogy_mln": a,
            "formula_mln": f,
            "divergence": round(divergence, 2),
            "weights": weights.as_dict(),
            "formula": (
                f"{f:g} × {weights.drivers:.2f} + {a:g} × {weights.analogy:.2f} "
                f"= {blended:g} млн ₽"
            ),
        },
        hint="\n".join(lines),
        missing=missing,
    )
    result.components = [analogy, formula]
    return result


def _worse_confidence(first: str, second: str) -> str:
    """Худшая из двух уверенностей: итог не бывает надёжнее слабейшего слагаемого."""
    ladder = [CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, CONFIDENCE_LOW]
    return ladder[max(ladder.index(first), ladder.index(second))]


def _apply_analogy(task: Task, formula: ValueResult, analogy_index: Any) -> ValueResult:
    """Аналогия становится ответом, формула остаётся рядом как второй метод."""
    from app.core.analogy import estimate_by_analogy

    estimate = estimate_by_analogy(task, analogy_index, formula.value_internal_mln)
    if estimate is None:
        formula.alternative_unavailable = (
            "Похожих задач с человеческим Value не нашлось — сравнивать не с чем."
        )
        return formula

    external = estimate.value_mln if task.team_class == "earning" else None
    lines = [
        "Метод расчёта: аналогия с задачами, где Value заполнил человек.",
        f"Оценка: {estimate.value_mln:,.1f} млн ₽ — медиана по {len(estimate.analogues)} "
        f"похожим задачам{' той же команды' if estimate.same_team else ''}.".replace(",", " "),
        "Аналоги:",
    ]
    for analogue in estimate.analogues:
        lines.append(
            f"  • {analogue.task_key} ({analogue.value_mln:g} млн ₽, "
            f"схожесть {analogue.similarity:.2f}): {analogue.title[:80]}"
        )
    if estimate.value_spread >= 5.0:
        lines.append(
            f"Значения аналогов расходятся в {estimate.value_spread:.0f} раз — "
            "команда заполняла Value непоследовательно."
        )
    if estimate.cross_check_note:
        lines.append(estimate.cross_check_note + ".")

    confidence_ru = {"high": "Высокий", "medium": "Средний", "low": "Низкий"}[estimate.confidence]
    lines.append(f"Уверенность в оценке: {confidence_ru}.")
    if estimate.confidence != "high":
        lines.append(
            "Уточнение повысит точность: заполнить Value вручную — "
            "введённое человеком значение агент не пересчитывает."
        )

    result = ValueResult(
        value_internal_mln=estimate.value_mln,
        value_external_mln=external,
        value_external_status=STATUS_COMPUTED if external is not None else STATUS_TBD,
        source=SOURCE_ANALOGY,
        confidence=estimate.confidence,
        zero_value_reason=None,
        inputs={
            **estimate.as_dict(),
            # Формула остаётся в аудите: НФ19 требует хранить промежуточные
            # вводные, а расхождение двух методов — полезный сигнал методологу.
            "formula_cross_check": {
                "method": formula.source,
                "value_mln": formula.value_internal_mln,
                "formula": (formula.inputs or {}).get("formula"),
            },
        },
        hint="\n".join(lines),
        missing=[] if estimate.confidence == "high" else ["уточнить Value вручную"],
    )
    return result




def _lower_confidence(level: str) -> str:
    """Понижает уверенность на ступень. Ниже низкой не бывает."""
    ladder = [CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, CONFIDENCE_LOW]
    index = ladder.index(level) if level in ladder else len(ladder) - 1
    return ladder[min(index + 1, len(ladder) - 1)]


def _no_driver_result(
    task: Task,
    missing_driver: str,
    hint_lines: list[str],
    missing: list[str],
) -> ValueResult:
    """Отказ от формульной оценки: нужного драйвера в справочнике нет.

    Value остаётся `None`, а не нулём. Ноль прошёл бы дальше как посчитанная
    величина: фактор F1 получил бы законный балл, задача — правдоподобный
    приоритет, и отсутствие вводной стало бы невидимым. `None` заставляет
    расчёт сказать, чего не хватает.
    """
    return ValueResult(
        value_internal_mln=None,
        value_external_mln=None,
        value_external_status=STATUS_TBD,
        source=SOURCE_REVENUE,
        confidence=CONFIDENCE_LOW,
        zero_value_reason=None,
        inputs={"missing_driver": missing_driver, "components": []},
        hint="\n".join([*hint_lines, "Что уточнить: " + "; ".join(missing) + "."]),
        missing=missing,
    )


def _compute_revenue(
    task: Task,
    refs: ReferenceBundle,
    hints: dict[str, Any],
    text: str,
    discount: float,
    horizon: int,
) -> ValueResult:
    """Доходный метод зарабатывающих команд (IB, Pre-Trade)."""
    constants = refs.constants
    explicit_deals = _first_number(_DEALS_RE, text)
    llm_deals = hints.get("deals_per_year")

    if explicit_deals is not None:
        deals_per_year, origin, explicit = explicit_deals, "attribute", True
    elif llm_deals is not None:
        deals_per_year, origin, explicit = float(llm_deals), "llm", False
    else:
        return _no_driver_result(
            task,
            missing_driver="число дополнительных сделок в год",
            hint_lines=[
                "Метод расчёта: доходный — применить не удалось.",
                "Ни в постановке задачи, ни в ответе модели нет числа дополнительных сделок.",
            ],
            missing=["указать ожидаемое число дополнительных сделок в год"],
        )

    # Стоимость сделки разрешается по команде. Своей нет — берётся у соседней
    # зарабатывающей команды с понижением уверенности: единой константы «одна
    # сделка = столько-то» больше нет, но и отказываться от расчёта не нужно.
    resolved = refs.deal_value_rub(task.team)

    if resolved is None:
        return _no_driver_result(
            task,
            missing_driver="стоимость одной сделки",
            hint_lines=[
                "Метод расчёта: доходный — применить не удалось.",
                "Стоимости сделки нет ни у команды, ни у той, у которой её "
                "разрешено занять.",
            ],
            missing=[
                f"внести стоимость сделки для команды «{task.team}» "
                "в data/references/value_drivers.yaml",
                "либо заполнить Value вручную",
            ],
        )

    deal_value_rub, deal_value_origin, donor_team = resolved
    substituted = deal_value_origin == "substitution"

    inputs = [
        ValueInput("deals_per_year", deals_per_year, "сделок/год", origin, explicit),
        ValueInput("horizon_years", horizon, "лет", "constant", True),
        ValueInput(
            "deal_value_rub",
            deal_value_rub,
            "₽",
            "substitution" if substituted else "constant",
            not substituted,
        ),
    ]

    total_deals = deals_per_year * horizon
    value_rub = total_deals * deal_value_rub * discount
    value_mln = value_rub / 1_000_000

    missing: list[str] = []
    if not explicit:
        missing.append("указать ожидаемое число дополнительных сделок в год")
    if substituted:
        missing.append(
            f"внести стоимость сделки для команды «{task.team}» — "
            f"сейчас взята у «{donor_team}»"
        )

    confidence = _confidence_from(inputs, llm_confident=bool(hints.get("confident")))
    if substituted:
        # Заимствованная величина стоит ступени уверенности: масштаб сделки у
        # зарабатывающих команд различается, и равенство здесь — допущение.
        confidence = _lower_confidence(confidence)

    formula = (
        f"{total_deals:g} сделок за {horizon} года × "
        f"{deal_value_rub / 1_000_000:g} млн ₽ × дисконт {discount:.3f}"
    )
    if substituted:
        formula += f" (стоимость сделки взята у «{donor_team}»)"

    return ValueResult(
        value_internal_mln=round(value_mln, 2),
        # Ф6: у зарабатывающих команд внешний контур совпадает с внутренним.
        value_external_mln=round(value_mln, 2),
        value_external_status=STATUS_COMPUTED,
        source=SOURCE_REVENUE,
        confidence=confidence,
        zero_value_reason=None,
        inputs={
            "method": SOURCE_REVENUE,
            "discount_factor": round(discount, 4),
            "components": [i.__dict__ for i in inputs],
            "formula": formula,
        },
        hint=_format_hint(
            "доходный (число сделок × стоимость сделки)",
            formula,
            value_mln,
            confidence,
            missing,
            constants.discounting_enabled,
            horizon,
        ),
        missing=missing,
    )


def _compute_time_saving(
    task: Task,
    refs: ReferenceBundle,
    hints: dict[str, Any],
    text: str,
    discount: float,
    horizon: int,
) -> ValueResult:
    """Метод экономии времени обслуживающих команд, внутренний контур."""
    constants = refs.constants
    def pick(name: str, explicit_value: float | None) -> ValueInput | None:
        if explicit_value is not None:
            return ValueInput(name, explicit_value, "", "attribute", True)
        if hints.get(name) is not None:
            return ValueInput(name, float(hints[name]), "", "llm", False)
        return None

    explicit_minutes = _first_number(_MINUTES_RE, text)
    if explicit_minutes is None:
        hours = _first_number(_HOURS_RE, text)
        explicit_minutes = hours * 60 if hours is not None else None

    users = pick("users", _first_number(_USERS_RE, text))
    minutes = pick("minutes_per_operation", explicit_minutes)
    frequency = pick("operations_per_year", None)

    missing_by_name = {
        "users": "уточнить число пользователей процесса или витрины",
        "minutes_per_operation": "уточнить длительность одной операции в минутах",
        "operations_per_year": "уточнить частоту выполнения операции за год",
    }
    absent = [
        missing_by_name[name]
        for name, value in (
            ("users", users),
            ("minutes_per_operation", minutes),
            ("operations_per_year", frequency),
        )
        if value is None
    ]
    if absent:
        return _no_driver_result(
            task,
            missing_driver="вводные экономии времени",
            hint_lines=[
                "Метод расчёта: экономия времени — применить не удалось.",
                "Ни постановка задачи, ни ответ модели не содержат всех числовых драйверов.",
            ],
            missing=absent,
        )

    assert users is not None and minutes is not None and frequency is not None

    users.unit, minutes.unit, frequency.unit = "польз.", "мин", "раз/год"
    inputs = [users, minutes, frequency]

    value_rub = (
        users.value
        * minutes.value
        * frequency.value
        * constants.fte_minute_cost_rub
        * horizon
        * discount
    )
    value_mln = value_rub / 1_000_000

    missing = [
        missing_by_name[i.name]
        for i in inputs
        if not i.explicit
    ]

    confidence = _confidence_from(inputs, llm_confident=bool(hints.get("confident")))
    formula = (
        f"{users.value:g} польз. × {minutes.value:g} мин × {frequency.value:g} раз/год × "
        f"{constants.fte_minute_cost_rub:g} ₽/мин × {horizon} года × дисконт {discount:.3f}"
    )

    return ValueResult(
        value_internal_mln=round(value_mln, 2),
        # Ф7/Ф9: у обслуживающих команд внешний контур ex-ante не считается.
        value_external_mln=None,
        value_external_status=STATUS_TBD,
        source=SOURCE_TIME_SAVING,
        confidence=confidence,
        zero_value_reason=None,
        inputs={
            "method": SOURCE_TIME_SAVING,
            "discount_factor": round(discount, 4),
            "components": [i.__dict__ for i in inputs],
            "formula": formula,
        },
        hint=_format_hint(
            "экономия времени во внутреннем контуре",
            formula,
            value_mln,
            confidence,
            missing,
            constants.discounting_enabled,
            horizon,
        ),
        missing=missing,
    )


def compute_cost(task: Task, refs: ReferenceBundle) -> float | None:
    """Cost_₽ = Cost_ч/д × часов_в_дне × ставка_ч/ч (ТЗ 4.3)."""
    if task.effort_man_days is None:
        return None
    constants = refs.constants
    return task.effort_man_days * constants.hours_per_man_day * constants.man_hour_rate_rub


def compute_cost_to_value(cost_rub: float | None, value_internal_mln: float | None) -> float | None:
    """C/V = Cost_₽ / value_internal_₽.

    Возвращает None, когда отношение не определено: нет оценки трудозатрат либо
    Value равен нулю. Нейтральный балл фактора подставляется в scoring.py — так
    «не посчитано» и «посчитано и вышло нейтрально» не смешиваются в одном числе.
    """
    if cost_rub is None or not value_internal_mln:
        return None
    return cost_rub / (value_internal_mln * 1_000_000)
