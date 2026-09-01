"""Контракт обмена с Координатором бэклога.

Агент вызывается точечно: Координатор присылает атрибуты одной задачи и
формулирует задание. Доступа к БД Единого бэклога у агента нет — всё, что он
знает об остальных задачах, зашито в него слепком и обновляется отдельной
процедурой переиндексации.

Два сценария:

* `value`    — «Рассчитай Value(internal) по инициативе с описанием ниже»;
* `priority` — «Определи приоритет по инициативе с описанием ниже».

Схемы намеренно строгие (`extra="forbid"`): молча проглоченное лишнее поле в
запросе означает, что Координатор считает, будто передал данные, а расчёт их не
увидел. Лучше явная ошибка на границе.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.normalise import clean_text

# --- Вход --------------------------------------------------------------------


class TaskAttributes(BaseModel):
    """Атрибуты задачи, приходящие из Координатора.

    Имена соответствуют колонкам Единого бэклога; сопоставление —
    в `docs/COORDINATOR-CONTRACT.md`.
    """

    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(description="ID задачи, например TASK-100-011")
    task_type: str = Field(description="Тип задачи: цель, AD-HOC, исследование, техдолг")
    team: str = Field(description="Ответственная команда или кластер")
    title: str = Field(description="Наименование задачи / краткая постановка")

    description: str | None = Field(
        default=None, description="Описание задачи. Заполняется редко"
    )
    created_date: dt.date | None = Field(default=None, description="Дата поступления задачи")
    customer_division: str | None = Field(default=None, description="Подразделение бизнес-заказчика")
    project: str | None = Field(
        default=None,
        description="Проект. По гранулярности ближе к стратегии, чем задача, "
        "поэтому весомее при оценке стратегического соответствия",
    )
    deadline: str | None = Field(
        default=None, description="Срок выполнения в исходном виде: «3Q 2026», «2026», «БЕЗ СРОКА»"
    )
    involved_teams: str | None = Field(
        default=None, description="Другие вовлечённые команды. Если пусто — определяет субагент"
    )

    # Приходят только в сценарии приоритета и обязательны в нём.
    effort_man_days: float | None = Field(
        default=None, description="Оценка трудозатрат, ч/д. Нужна для Cost и C/V"
    )
    business_customer: str | None = Field(
        default=None, description="ФИО бизнес-заказчика. Нужно для уровня заказчика"
    )

    # Если человек уже заполнил Value, он считается истиной и не пересчитывается.
    value_internal_mln: float | None = Field(
        default=None, description="Value, заполненный человеком. Истина, уверенность 100%"
    )


class ValueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_type: Literal["value"] = "value"
    task: TaskAttributes
    prompt: str | None = Field(
        default=None, description="Формулировка задания из Координатора; на расчёт не влияет"
    )


class PriorityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_type: Literal["priority"] = "priority"
    task: TaskAttributes
    prompt: str | None = None


# --- Выход: общее ------------------------------------------------------------


class DriverUsed(BaseModel):
    """Величина, использованная в расчёте, и то, откуда она взялась."""

    name: str
    title: str
    value: float
    unit: str
    origin: Literal["reference", "substitution", "assumption", "attribute"] = Field(
        description="reference — из справочника; substitution — разрешённая замена; "
        "assumption — предположение из здравого смысла; attribute — из атрибутов задачи"
    )
    tier: Literal["measured", "expert", "assumed"] | None = None
    substituted_for: str | None = Field(
        default=None, description="Какой драйвер заменён, если origin=substitution"
    )
    source: str | None = None


class Analogue(BaseModel):
    """Задача с человеческим Value, использованная как аналог."""

    task_id: str
    title: str
    team: str | None = None
    project: str | None = None
    value_mln: float
    similarity: float


class Horizon(BaseModel):
    """Период получения дохода: три года начиная со следующего после срока."""

    start: dt.date
    end: dt.date
    years: int = 3
    derived_from: str = Field(description="Исходное значение срока выполнения")


class MethodResult(BaseModel):
    """Результат одного метода расчёта.

    Оба метода считаются на каждой задаче и возвращаются оба. Раньше наружу
    уходил только победивший, а проигравший оставался в аудите — из-за этого
    нельзя было увидеть, насколько они расходятся, и понять, готов ли доходный
    метод стать основным.
    """

    method: Literal["manual", "analogy", "drivers", "blended", "zero"]
    title: str = Field(description="Название метода по-русски, для интерфейса")
    value_mln: float | None = Field(
        description="null — метод неприменим или не хватило величины"
    )
    confidence: Literal["high", "medium", "low"] | None = None
    calculation: str | None = None
    drivers: list["DriverUsed"] = Field(default_factory=list)
    analogues: list["Analogue"] = Field(default_factory=list)
    missing_inputs: list[str] = Field(default_factory=list)
    unavailable_reason: str | None = Field(
        default=None, description="Почему метод не дал числа"
    )


class ValueRange(BaseModel):
    """Диапазон, в который истинное значение попадает с заявленной вероятностью.

    Множители получены конформной калибровкой на фактических ошибках, отдельно
    для каждого метода и уровня уверенности, поэтому 95% — измеренная величина,
    а не обещание. Ширина диапазона и есть численное выражение уверенности.
    """

    low_mln: float
    high_mln: float
    coverage: float = Field(default=0.95, description="Доля попаданий истины в диапазон")
    text: str = Field(description="Готовая строка для интерфейса, например «88–1 180 млн ₽»")
    calibrated: bool = Field(
        default=True,
        description="false — множители унаследованы от более широкого уровня, "
        "наблюдений для собственной калибровки пока мало",
    )


class ValueResult(BaseModel):
    """Ответ сценария Value: три поля для Координатора плюс разбор.

    Координатор записывает в бэклог **одно** число — `value_mln`. Диапазон и
    пояснение показываются рядом с полем, но в него не пишутся.
    """

    # 1. Число, которое уходит в поле Value. `null`, а не 0: расчёт не
    #    состоялся — не хватило величины или вводной. Ноль был бы утверждением
    #    «эффекта нет», и отличить его от несостоявшегося расчёта стало бы нельзя.
    value_mln: float | None = Field(description="Значение для записи в поле Value, млн ₽")

    # 2. Диапазон оценки.
    range: ValueRange | None = Field(
        default=None, description="null у точных значений: ручного и нуля по методике"
    )

    # 3. Текстовое пояснение: как получено число, какими методами, чего не хватило.
    explanation: str = Field(description="Готовый текст для поля пояснения")

    confidence: Literal["high", "medium", "low"]
    method: Literal["manual", "analogy", "drivers", "blended", "zero"]
    currency: Literal["RUB"] = "RUB"

    horizon: Horizon | None = None
    calculation: str | None = Field(default=None, description="Формула расчёта строкой")
    missing_inputs: list[str] = Field(
        default_factory=list, description="Что уточнить, чтобы оценка стала надёжнее"
    )
    zero_reason: str | None = Field(
        default=None, description="Почему Value равен нулю: техдолг, исследование, регуляторка"
    )

    # Разбор по методам. В бэклог уходит одно число, но слагаемые обязаны
    # дойти до Координатора: расхождение между ними — главный признак того,
    # можно ли доверять итогу.
    methods: list[MethodResult] = Field(default_factory=list)
    method_divergence: float | None = Field(
        default=None,
        description="Во сколько раз расходятся методы, давшие число. "
        "Больше трёх — повод не доверять ни одному",
    )


CONFIDENCE_RU = {"high": "высокая", "medium": "средняя", "low": "низкая"}


class CoordinatorValueOut(BaseModel):
    """Ответ сценария Value в том виде, в каком его ждёт Координатор бэклога.

    Три поля шаблона и ничего больше: ответ уходит в чужую систему напрямую, и
    лишние ключи там либо игнорируются, либо ломают разбор. Подробный разбор по
    методам, драйверы и аудит остаются внутри агента — они нужны для истории
    запросов и для объяснения человеку, но в шаблон не входят.

    Приоритет здесь не считается никогда: на него приходит отдельный запрос.
    """

    model_config = ConfigDict(extra="forbid")

    value_internal: float | None = Field(
        description="Число для записи в поле Value, млн ₽. null — расчёт не состоялся"
    )
    value_internal_confidence: Literal["низкая", "средняя", "высокая"] = Field(
        description="Уровень уверенности одним словом. Диапазон — в value_internal_logic"
    )
    value_internal_logic: str = Field(
        description="Как получено число: методы, расчёты, период, чего не хватило"
    )


# Названия атрибутов по-русски: отказ читает человек, а не только программа.
ATTRIBUTE_RU = {
    "task_id": "ID задачи",
    "task_type": "Тип задачи",
    "team": "Ответственная команда",
    "title": "Наименование задачи",
    "deadline": "Срок выполнения",
    "effort_man_days": "Оценка трудозатрат, ч/д",
    "business_customer": "ФИО бизнес-заказчика",
}


def refusal_to_coordinator(
    error: "ErrorResponse", scenario: str
) -> "CoordinatorValueOut | CoordinatorPriorityOut":
    """Отказ в том же наборе полей, что и обычный ответ.

    Раньше при нехватке атрибутов наружу уходила другая структура — с ключами
    `status`, `error`, `missing_attributes`. Координатор, разбирающий три поля,
    на ней ломался бы: у ответа и отказа обязана быть одна схема, иначе
    обрабатывать надо два формата, и о втором легко забыть.

    Значение — `null`, а не ноль: расчёт не состоялся. Причина и список
    недостающих полей уходят в поле логики, уверенность — низкая.
    """
    missing = [ATTRIBUTE_RU.get(name, name) for name in error.missing_attributes]
    lines = [f"РАСЧЁТ НЕ ВЫПОЛНЕН: {error.error}."]
    if missing:
        lines.append("")
        lines.append("Не заполнены обязательные атрибуты:")
        lines.extend(f"  • {name}" for name in missing)
        lines.append("")
        lines.append(
            "Это правильный ответ, а не сбой. Посчитать на нейтральных значениях "
            "означало бы выдать правдоподобное число, по которому примут решение."
        )
    logic = "\n".join(lines)

    if scenario == "value":
        return CoordinatorValueOut(
            value_internal=None,
            value_internal_confidence="низкая",
            value_internal_logic=logic,
        )
    return CoordinatorPriorityOut(
        priority_score=None,
        priority_score_confidence="низкая",
        priority_score_logic=logic,
    )


def to_coordinator_priority(
    priority: "PriorityResult",
    value: "ValueResult | None" = None,
) -> CoordinatorPriorityOut:
    """Разворачивает приоритет в три поля шаблона.

    В `priority_score` уходит полоса P1–P5, а не сырой скор: именно по ней
    принимают решения. Сырой скор нужен для сортировки внутри полосы и
    остаётся в тексте пояснения.

    Пояснение строится в два слоя. Сначала формула целиком — все веса, все
    баллы, произведения и сумма: по ней результат проверяется арифметически,
    без доверия к агенту. Ниже — обоснование каждого балла: откуда он взялся и
    по какому правилу нормализован. Разделять эти слои важно, потому что
    вопросы к ним разные: «правильно ли сложили» и «правильно ли оценили».
    """
    level, backing = priority_confidence(priority, value.confidence if value else None)
    ordered = sorted(priority.factors, key=lambda f: f.contribution, reverse=True)

    lines = [f"ПРИОРИТЕТ {priority.priority}, скор {priority.score:.4f}", ""]

    # --- Слой 1: формула ----------------------------------------------------
    lines.append("ФОРМУЛА: скор = Σ (вес × балл × множитель)")
    lines.append("")
    width = max(len(f"{f.code} {f.title}") for f in ordered)
    for factor in ordered:
        name = f"{factor.code} {factor.title}".ljust(width)
        line = f"  {name}  {factor.weight:>5.2f} × {factor.score:>5.2f}"
        if abs(factor.multiplier - 1.0) > 1e-9:
            line += f" × {factor.multiplier:>4.2f}"
        lines.append(f"{line} = {factor.contribution:.4f}")
    lines.append(f"  {'ИТОГО':<{width}}  {'':>5}   {'':>5}   {priority.score:.4f}")

    if priority.bands:
        scale = ", ".join(
            f"{band} ≥ {threshold:g}"
            for band, threshold in sorted(
                priority.bands.items(), key=lambda kv: kv[1], reverse=True
            )
        )
        lines.append("")
        lines.append(f"  Шкала: {scale}, ниже — P5. Скор {priority.score:.4f} → {priority.priority}")

    if priority.overrides:
        lines.append("")
        lines.append("  Правила-овверрайды действуют вне зависимости от скора:")
        for rule in priority.overrides:
            lines.append(
                f"    • {rule.title}: {rule.priority_before} → {rule.priority_after}. {rule.reason}"
            )

    # --- Слой 2: откуда взялся каждый балл ----------------------------------
    source_ru = {
        "computed": "посчитан по атрибутам задачи",
        "assessed": "суждение субагента",
        "default": "нейтральное значение, данных не было",
    }
    lines.append("")
    lines.append("ОБОСНОВАНИЕ БАЛЛОВ")
    for factor in ordered:
        lines.append("")
        lines.append(
            f"  {factor.code} {factor.title} — балл {factor.score:.2f}, "
            f"вес {factor.weight:g} ({source_ru.get(factor.source, factor.source)})"
        )
        lines.append(f"    {factor.explanation}")

    # --- Чего не хватило ----------------------------------------------------
    unbacked = [f for f in priority.factors if f.source == "default"]
    if unbacked:
        share = sum(f.weight for f in unbacked)
        lines.append("")
        lines.append(
            f"НЕ ОБЕСПЕЧЕНО ДАННЫМИ {share:.0%} веса модели: "
            + "; ".join(f"{f.code} {f.title}" for f in unbacked)
            + ". Заполнение этих полей сузит разброс приоритетов сильнее, "
            "чем любая перенастройка весов."
        )

    if value is not None:
        lines.append("")
        lines.append(
            f"VALUE ДЛЯ ФАКТОРА F1: {value.value_mln} млн ₽, уверенность "
            f"{CONFIDENCE_RU.get(value.confidence, value.confidence)}. "
            "Полный расчёт — в ответе сценария Value."
        )

    lines.append("")
    lines.append(
        f"УВЕРЕННОСТЬ: {level}. Данными обеспечено {backing:.0%} веса модели — "
        "вес каждого фактора умножен на то, откуда взялся его балл, а вклад F1 "
        "дополнительно масштабирован уверенностью в оценке Value."
    )

    if priority.cost_rub is not None:
        cost = f"{priority.cost_rub:,.0f}".replace(",", " ")
        cv = f", C/V {priority.cost_to_value:.4f}" if priority.cost_to_value is not None else ""
        lines.append(
            f"ЗАТРАТЫ: {cost} ₽{cv}. В приоритет не входят — показатель выводится "
            "из Value и трудозатрат, уже учтённых факторами F1 и F4."
        )

    return CoordinatorPriorityOut(
        priority_score=priority.priority,
        priority_score_confidence=level,  # type: ignore[arg-type]
        priority_score_logic="\n".join(lines).strip(),
    )


def to_coordinator(value: "ValueResult") -> CoordinatorValueOut:
    """Разворачивает подробный результат в три поля шаблона.

    Уверенность — одно слово из трёх. Диапазон в это поле не кладётся: он
    относится к логике расчёта и живёт в `value_internal_logic`, иначе поле
    перестало бы быть перечислимым и Координатор не смог бы по нему
    фильтровать или красить.
    """
    return CoordinatorValueOut(
        value_internal=value.value_mln,
        value_internal_confidence=CONFIDENCE_RU[value.confidence],  # type: ignore[arg-type]
        value_internal_logic=value.explanation,
    )


# Насколько балл фактора опирается на данные. Суждение субагента ниже
# измерения, но выше нейтральной подстановки: оно хотя бы про эту задачу.
FACTOR_BACKING = {"computed": 1.0, "assessed": 0.8, "default": 0.3}

# Уверенность в оценке Value умножает вклад фактора F1 — он самый весомый и
# целиком стоит на этой оценке.
VALUE_CONFIDENCE_BACKING = {"high": 1.0, "medium": 0.7, "low": 0.4}

# Пороги перевода обеспеченности в три слова.
PRIORITY_CONFIDENCE_HIGH = 0.80
PRIORITY_CONFIDENCE_MEDIUM = 0.55


class CoordinatorPriorityOut(BaseModel):
    """Ответ сценария приоритета в том виде, в каком его ждёт Координатор.

    Три поля шаблона и ничего больше — ответ уходит в чужую систему напрямую.
    Разбор по факторам, овверрайды и аудит остаются внутри агента.
    """

    model_config = ConfigDict(extra="forbid")

    priority_score: Literal["P1", "P2", "P3", "P4", "P5"] | None = Field(
        description="Приоритет для записи в бэклог. null — расчёт не состоялся"
    )
    priority_score_confidence: Literal["низкая", "средняя", "высокая"] = Field(
        description="Уровень уверенности одним словом. Разбор — в logic"
    )
    priority_score_logic: str = Field(
        description="Как получен приоритет: вклад факторов, овверрайды, чего не хватило"
    )


def priority_confidence(priority: "PriorityResult", value_confidence: str | None) -> tuple[str, float]:
    """Уверенность в приоритете и доля веса, обеспеченная данными.

    Приоритет — свёртка восьми факторов, и надёжен он ровно настолько,
    насколько эти факторы посчитаны, а не подставлены нейтральным значением.
    Поэтому считается взвешенная доля обеспеченности: вес каждого фактора
    умножается на то, откуда взялся его балл.

    Фактор F1 дополнительно масштабируется уверенностью в Value: он весит
    больше всех и целиком стоит на оценке, которая сама может быть шаткой.
    Без этого задача с Value, посчитанным на подставленных драйверах,
    получала бы такой же уверенный приоритет, как задача с ручной оценкой.
    """
    backing = 0.0
    for factor in priority.factors:
        share = FACTOR_BACKING.get(factor.source, 0.3)
        if factor.code == "F1" and value_confidence:
            share *= VALUE_CONFIDENCE_BACKING.get(value_confidence, 0.4)
        backing += factor.weight * share

    if backing >= PRIORITY_CONFIDENCE_HIGH:
        level = "высокая"
    elif backing >= PRIORITY_CONFIDENCE_MEDIUM:
        level = "средняя"
    else:
        level = "низкая"
    return level, backing


class FactorResult(BaseModel):
    """Один фактор приоритизации в табличном виде для Координатора."""

    code: str
    title: str
    weight: float
    score: float = Field(description="Нормализованный балл 0–1")
    multiplier: float = Field(
        default=1.0,
        description="Множитель к вкладу. У F1 это уверенность в оценке Value: "
        "она уточняет Value, а не является самостоятельным свойством задачи",
    )
    contribution: float = Field(description="weight × score × multiplier")
    explanation: str = Field(description="Почему такое значение")
    source: Literal["computed", "assessed", "default"] = Field(
        description="computed — из атрибутов; assessed — суждение субагента; "
        "default — нейтральное значение, данных не было"
    )


class OverrideApplied(BaseModel):
    rule_id: str
    title: str
    reason: str
    priority_before: str
    priority_after: str


class PriorityResult(BaseModel):
    priority: Literal["P1", "P2", "P3", "P4", "P5"]
    score: float = Field(description="Сырой скор 0–1; нужен для сортировки внутри одного P")
    factors: list[FactorResult]
    overrides: list[OverrideApplied] = Field(default_factory=list)
    rationale: str

    # Затраты и их отношение к эффекту — диагностика для карточки задачи, а не
    # факторы. C/V выводится из Value и трудозатрат, которые уже учтены F1 и F4,
    # поэтому в скор он не входит: см. docs/DEVIATIONS-FROM-TZ.md, раздел 3.
    cost_rub: float | None = Field(default=None, description="Трудозатраты × ставка ч/ч")
    cost_to_value: float | None = Field(
        default=None, description="Cost / Value. Меньше — лучше. В приоритет не входит"
    )

    # Пороги полос. Без них по скору нельзя проверить, почему вышла именно эта
    # буква: 0.5872 само по себе не говорит, что P2 начинается с 0.60.
    bands: dict[str, float] = Field(default_factory=dict)


# --- Выход: конверт ----------------------------------------------------------


class ResponseAudit(BaseModel):
    """След расчёта. Нужен, чтобы результат можно было воспроизвести и оспорить."""

    request_id: str
    cache_key: str = Field(description="Хеш нормализованных атрибутов")
    cached: bool = Field(description="Ответ отдан из истории без обращения к модели")
    reused_from_request_id: str | None = None

    reference_versions: dict[str, int] = Field(
        default_factory=dict, description="Версии справочников, на которых считалось"
    )
    snapshot_version: str | None = Field(
        default=None, description="Версия зашитого слепка бэклога для поиска аналогов"
    )
    llm_calls: int = 0
    model: str | None = None
    duration_ms: int | None = None
    computed_at: dt.datetime


class AgentResponse(BaseModel):
    """Единый конверт ответа для обоих сценариев."""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    request_type: Literal["value", "priority"]
    status: Literal["ok", "insufficient_data", "error"] = "ok"

    value: ValueResult | None = Field(
        default=None,
        description="Для сценария value — всегда. Для priority — только если Value "
        "не был заполнен человеком и агент рассчитал его сам",
    )
    priority: PriorityResult | None = None

    warnings: list[str] = Field(
        default_factory=list, description="Что мешало посчитать точнее, но не остановило расчёт"
    )
    error: str | None = None
    audit: ResponseAudit


class ErrorResponse(BaseModel):
    """Отказ от расчёта: не хватило данных или сбой."""

    model_config = ConfigDict(extra="forbid")

    task_id: str | None = None
    request_type: Literal["value", "priority"] | None = None
    status: Literal["insufficient_data", "error"]
    error: str
    missing_attributes: list[str] = Field(default_factory=list)


# --- Обязательность атрибутов ------------------------------------------------

# Координатор проверяет полноту у себя, но агент проверяет повторно: он не может
# полагаться на то, что вызывающая сторона всегда права, а посчитать приоритет
# без трудозатрат означает молча выдать результат, в котором 33% веса заменено
# нейтральными значениями.
REQUIRED_FOR_VALUE = ("task_id", "task_type", "team", "title")
REQUIRED_FOR_PRIORITY = (
    "task_id",
    "task_type",
    "team",
    "title",
    "effort_man_days",
    "business_customer",
    "deadline",
)


def check_required(task: TaskAttributes, request_type: str) -> list[str]:
    """Возвращает список незаполненных обязательных атрибутов."""
    required = REQUIRED_FOR_PRIORITY if request_type == "priority" else REQUIRED_FOR_VALUE
    missing = []
    for name in required:
        value = getattr(task, name, None)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(name)
    return missing


def cache_key_payload(task: TaskAttributes, request_type: str) -> dict[str, Any]:
    """Нормализованные атрибуты, по которым считается ключ кэша.

    В ключ входит только то, что влияет на результат. `prompt` не входит:
    переформулировка задания Координатором не должна менять цифру.

    Тексты нормализуются — схлопывание пробелов, неразрывный пробел, регистр.
    Иначе лишний пробел в названии, вставленный при копировании, даст промах
    кэша и новое обращение к модели, а требование «те же данные — та же цифра»
    перестанет выполняться на ровном месте.
    """
    payload: dict[str, Any] = {}
    for name, value in task.model_dump(mode="json", exclude_none=True).items():
        if isinstance(value, str):
            cleaned = clean_text(value)
            payload[name] = cleaned.casefold() if cleaned else None
        else:
            payload[name] = value

    return {"request_type": request_type, **payload}


# Версия методики расчёта. Поднимается вручную при любом изменении, которое
# меняет цифру: формулы, порядка методов, весов, правил уверенности.
#
# Без неё правка методики молча не применялась бы: ключ кэша учитывает версии
# справочников и слепка, но не код, и запрос с теми же атрибутами возвращал бы
# число, посчитанное по прежним правилам. Ровно это и случилось 2026-08-20 при
# переходе от среднего пополам к взвешенной сумме.
#
# История:
#   1 — исходная методика, аналогия поверх формулы
#   2 — среднее двух методов пополам
#   3 — взвешенная сумма, вес доходного метода 10–90% (100% без аналогов)
#   4 — номера задач-аналогов в пояснении
#   5 — проект, тип и описание участвуют в подборе аналогов
#   6 — стоимость сделки из финансовой модели: IB 20 млн, Pre-trade 100 млн
#   7 — формула и обоснование баллов в пояснении приоритета
#   8 — уверенность стала множителем при факторе Value, её вес передан ему
#        (0.31 → 0.34)
#   9 — коды факторов сброшены и идут подряд, F1–F7: дыры на месте C/V больше нет
#  10 — ответы, полученные через аварийную MockAdapter-подмену, инвалидированы;
#       сбой настроенной LLM теперь останавливает расчёт и возвращает ошибку
CALCULATION_VERSION = 10


def cache_key(
    task: TaskAttributes,
    request_type: str,
    *,
    reference_versions: dict[str, int] | None = None,
    snapshot_version: str | None = None,
) -> str:
    """Отпечаток запроса. Совпал — отдаём прежний ответ, модель не трогаем.

    Версии справочников и слепка входят в ключ намеренно. Без них правка весов
    методологом не приводила бы к пересчёту: запрос с теми же атрибутами
    доставал бы из истории ответ, посчитанный по старым весам, и объяснить
    расхождение было бы нечем.
    """
    payload = json.dumps(
        {
            **cache_key_payload(task, request_type),
            "_references": dict(sorted((reference_versions or {}).items())),
            "_snapshot": snapshot_version,
            "_calculation": CALCULATION_VERSION,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
