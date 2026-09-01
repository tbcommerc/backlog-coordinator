"""Два сценария Координатора бэклога: расчёт Value и расчёт приоритета.

Агент вызывается точечно и **без доступа к базе**: атрибуты одной задачи
приходят в запросе, остального бэклога он не видит. То, что расчёту всё же
нужно от бэклога — аналоги и шкала фактора F1, — берётся из зашитого слепка
(`app/snapshot.py`).

Порядок шагов повторяет полный прогон (`app/core/service.py`), чтобы цифра,
выданная Координатору, совпадала с цифрой из пересчёта бэклога. Разница
только в источнике данных: там строка таблицы, здесь тело запроса.

Задача-носитель (`Task`) собирается в памяти и **не сохраняется**: она нужна
как переносчик атрибутов между функциями ядра, которые все принимают `Task`.
Дублировать ради этого расчёт Value и свёртку было бы хуже — две реализации
одной методики неизбежно разъезжаются.
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.contract import (
    AgentResponse,
    Analogue as AnalogueOut,
    DriverUsed,
    ErrorResponse,
    FactorResult,
    Horizon,
    MethodResult,
    OverrideApplied,
    PriorityResult,
    ResponseAudit,
    TaskAttributes,
    ValueRange,
    ValueResult,
    cache_key,
    check_required,
)
from app.config import get_settings
from app.core import normalise as nz
from app.core.analogy import AnalogyIndex
from app.core.horizon import revenue_window
from app.core.models import Task
from app.core.references import ReferenceBundle
from app.core.scoring import FACTOR_TITLES, ScoringContext, score_task
from app.core.value import compute_cost, compute_cost_to_value, compute_value
from app.service.history import find_previous, new_request_id, remember
from app.snapshot import ValueSnapshot, get_snapshot

# Соответствие метода расчёта из ядра методу в контракте. Ядро различает
# доходный метод и экономию времени, Координатору эта разница не нужна: для
# него важно, посчитано ли по драйверам или по аналогии.
_METHOD_MAP = {
    "manual": "manual",
    "analogy": "analogy",
    "revenue": "drivers",
    "time_saving": "drivers",
    "blended": "blended",
    "zero": "zero",
}

# Индекс аналогий тяжёл в постройке (прогон текстов через модель эмбеддингов),
# поэтому строится один раз на процесс. Слепок между запросами не меняется.
_ANALOGY_INDEX: AnalogyIndex | None = None


def _analogy_index(snapshot: ValueSnapshot) -> AnalogyIndex | None:
    global _ANALOGY_INDEX
    if not get_settings().value_analogy or not snapshot.available:
        return None
    if _ANALOGY_INDEX is None:
        _ANALOGY_INDEX = AnalogyIndex.from_snapshot(snapshot)
    return _ANALOGY_INDEX


def reset_analogy_index() -> None:
    """Сбрасывает индекс — нужно после обновления слепка."""
    global _ANALOGY_INDEX
    _ANALOGY_INDEX = None


# --- сборка задачи-носителя --------------------------------------------------


def build_task(attrs: TaskAttributes, refs: ReferenceBundle) -> Task:
    """Атрибуты запроса → объект `Task` в памяти, без записи в базу.

    Признаки регуляторности, RnD и блокирующей задачи определяются так же, как
    при загрузке слепка: отдельных полей под них в бэклоге нет, они ищутся по
    ключевым словам в названии, проекте и типе.
    """
    detection = refs.detection
    haystack = " ".join(
        filter(None, [attrs.title, attrs.project, attrs.task_type, attrs.description])
    )

    is_rnd = nz.contains_any(haystack, detection.get("rnd_keywords", []))
    if attrs.task_type and attrs.task_type.strip().upper() == "ИССЛЕДОВАНИЕ":
        is_rnd = True

    involved = nz.split_teams(attrs.involved_teams)

    return Task(
        task_key=attrs.task_id,
        team=nz.clean_text(attrs.team),
        title=nz.clean_text(attrs.title),
        task_type=nz.clean_text(attrs.task_type),
        customer=nz.clean_text(attrs.business_customer),
        customer_division=nz.clean_text(attrs.customer_division),
        project=nz.clean_text(attrs.project),
        comment=nz.clean_text(attrs.description),
        deadline_raw=nz.clean_text(attrs.deadline),
        involved_teams_raw=nz.clean_text(attrs.involved_teams),
        created_date=attrs.created_date,
        deadline=nz.parse_deadline(attrs.deadline),
        involved_teams_count=len(involved),
        effort_man_days=attrs.effort_man_days,
        team_class=refs.team_class(attrs.team),
        value_manual_mln=attrs.value_internal_mln,
        is_regulatory=nz.contains_any(haystack, detection.get("regulatory_keywords", [])),
        is_rnd=is_rnd,
        is_blocking=nz.contains_any(haystack, detection.get("blocking_keywords", [])),
    )


# --- преобразование результатов ядра в контракт -------------------------------


# Происхождение вводной в терминах ядра → в терминах контракта. `typical` и
# `llm` оба становятся `assumption`: и типовое значение справочника, и догадка
# модели — предположения, а не измеренные величины, и уверенность они понижают
# одинаково.
_ORIGIN_MAP = {
    "attribute": "attribute",
    "constant": "reference",
    "typical": "assumption",
    "llm": "assumption",
}


def _drivers_from_inputs(inputs: dict[str, Any]) -> list[DriverUsed]:
    """Вводные расчёта → драйверы контракта с указанием происхождения."""
    out: list[DriverUsed] = []
    for item in inputs.get("components") or []:
        origin = _ORIGIN_MAP.get(item.get("origin"), "assumption")
        out.append(
            DriverUsed(
                name=item.get("name", ""),
                title=item.get("name", ""),
                value=float(item.get("value", 0.0)),
                unit=item.get("unit", ""),
                origin=origin,  # type: ignore[arg-type]
                tier="measured" if origin == "reference" else "assumed",
                source="value_drivers.yaml" if origin == "reference" else None,
            )
        )
    return out


def _analogues_from_inputs(inputs: dict[str, Any]) -> list[AnalogueOut]:
    return [
        AnalogueOut(
            task_id=a.get("task_key", ""),
            title=a.get("title", ""),
            team=a.get("team"),
            project=a.get("project"),
            value_mln=float(a.get("value_mln", 0.0)),
            similarity=float(a.get("similarity", 0.0)),
        )
        for a in (inputs.get("analogues") or [])
    ]


def _calculation(inputs: dict[str, Any], method: str) -> str | None:
    """Строка расчёта. У формулы она готова, у аналогии её нужно собрать.

    В строке аналогии стоят номера задач, а не одни числа: «медиана(200; 50;
    400)» не проверяема, а «медиана(TASK-300-032: 200; …)» проверяема.
    """
    if method == "analogy":
        parts = [
            f"{a.get('task_key')}: {a.get('value_mln'):g}"
            for a in (inputs.get("analogues") or [])
        ]
        if not parts:
            return None
        return f"медиана({'; '.join(parts)}) = {inputs.get('value_mln'):g} млн ₽"
    return inputs.get("formula")


_METHOD_TITLES = {
    "manual": "Значение, заполненное человеком",
    "analogy": "Аналогия с похожими задачами",
    "drivers": "Доходный метод по драйверам",
    "blended": "Среднее доходного и сравнительного методов",
    "zero": "Нулевой эффект по методике",
}


def _method_result(core, method: str) -> MethodResult:
    """Один метод в виде, пригодном для показа рядом с другим."""
    inputs = core.inputs or {}
    return MethodResult(
        method=method,  # type: ignore[arg-type]
        title=_METHOD_TITLES.get(method, method),
        value_mln=round(core.value_internal_mln, 2)
        if core.value_internal_mln is not None
        else None,
        confidence=core.confidence,
        calculation=_calculation(inputs, method),
        drivers=_drivers_from_inputs(inputs),
        analogues=_analogues_from_inputs(inputs),
        missing_inputs=list(core.missing or []),
        unavailable_reason=inputs.get("missing_driver"),
    )


def _all_methods(core) -> tuple[list[MethodResult], float | None]:
    """Методы, из которых сложился ответ, и то, насколько они разошлись.

    В бэклог уходит одно число, но слагаемые обязаны дойти до Координатора:
    расхождение между ними — главный признак того, можно ли доверять итогу.
    """
    components = getattr(core, "components", None) or []
    if components:
        methods = [
            _method_result(c, _METHOD_MAP.get(c.source, "drivers")) for c in components
        ]
    else:
        methods = [_method_result(core, _METHOD_MAP.get(core.source, "drivers"))]

    values = [m.value_mln for m in methods if m.value_mln]
    divergence = None
    if len(values) > 1:
        divergence = round(max(values) / min(values), 2)
    return methods, divergence


def _value_result(
    task: Task,
    core,
    attrs: TaskAttributes,
    warnings: list[str],
) -> ValueResult:
    """Ответ сценария Value: одно число, диапазон и текст пояснения."""
    method = _METHOD_MAP.get(core.source, "drivers")

    horizon = None
    if method != "zero":
        start_date, end_date, derived, warning = revenue_window(attrs.deadline)
        horizon = Horizon(start=start_date, end=end_date, derived_from=derived)
        if warning:
            warnings.append(warning)

    methods, divergence = _all_methods(core)
    if divergence is not None and divergence >= 3.0:
        warnings.append(
            f"Методы расходятся в {divergence:g} раза — доходный метод и аналогия "
            "дают разный порядок. Оценке нельзя доверять без проверки вводных."
        )

    value = core.value_internal_mln
    if value is None:
        # Расчёт не состоялся. Ноль тут был бы подлогом: «эффекта нет» и «не
        # смогли посчитать» — разные утверждения, и второе требует действий.
        warnings.append(
            "Value рассчитать не удалось: не хватает величины в справочнике "
            "или вводной в задаче. Подробности — в missing_inputs."
        )

    interval = core.interval
    value_range = None
    if interval is not None and value is not None and not interval.is_exact:
        value_range = ValueRange(
            low_mln=round(interval.low_mln, 2),
            high_mln=round(interval.high_mln, 2),
            coverage=float(interval.coverage),
            text=interval.format_range(),
            calibrated=bool(interval.calibrated),
        )

    return ValueResult(
        value_mln=round(value, 2) if value is not None else None,
        range=value_range,
        explanation=_explanation(core, methods, divergence, horizon, value_range),
        confidence=core.confidence,
        method=method,  # type: ignore[arg-type]
        horizon=horizon,
        calculation=_calculation(core.inputs or {}, method),
        missing_inputs=list(core.missing or []),
        zero_reason=core.zero_value_reason,
        methods=methods,
        method_divergence=divergence,
    )


def _explanation(core, methods, divergence, horizon, value_range) -> str:
    """Текст под полем Value: как получено число и чему в нём верить.

    Собирается здесь, а не в ядре, потому что это часть контракта с
    Координатором: подсказка ядра пишется для карточки задачи и не знает ни про
    период дохода, ни про то, что методов показывают несколько.
    """
    lines: list[str] = []
    if core.hint:
        lines.append(core.hint)

    if len(methods) > 1:
        lines.append("")
        lines.append("Оценки по методам:")
        for m in methods:
            if m.value_mln is None:
                reason = m.unavailable_reason or "нет данных"
                lines.append(f"  • {m.title}: не посчитан ({reason}).")
                continue
            line = f"  • {m.title}: {m.value_mln:,.1f} млн ₽".replace(",", " ")
            if m.calculation:
                line += f" — {m.calculation}"
            lines.append(line)

            # Номера задач-аналогов обязаны быть в пояснении: без них оценку
            # нельзя проверить. Человек должен иметь возможность открыть эти
            # задачи и увидеть, откуда взялось число.
            for a in m.analogues:
                title = a.title if len(a.title) <= 70 else a.title[:69] + "…"
                lines.append(
                    f"      {a.task_id}: {a.value_mln:g} млн ₽, "
                    f"схожесть {a.similarity:.2f}"
                    + (f", команда {a.team}" if a.team else "")
                    + f" — {title}"
                )
        if divergence is not None:
            lines.append(f"  Расхождение методов: {divergence:g}×.")

    if horizon is not None:
        lines.append("")
        lines.append(
            f"Период получения дохода: {horizon.start:%d.%m.%Y} — "
            f"{horizon.end:%d.%m.%Y} ({horizon.years} года, из срока «{horizon.derived_from}»)."
        )

    # Диапазон живёт здесь, а не в поле уверенности: там перечислимые «низкая,
    # средняя, высокая», и строка с числами сделала бы поле нефильтруемым.
    # Добавляем явно, а не надеемся на подсказку ядра: она пишется для карточки
    # задачи и может её не содержать.
    text = "\n".join(lines).strip()
    if value_range is not None and value_range.text not in text:
        text += (
            f"\nДиапазон ({value_range.coverage:.0%} вероятности): {value_range.text}."
        )
    if value_range is None:
        text += "\nЗначение точное, диапазона у него нет."
    elif not value_range.calibrated:
        text += (
            "\nМножители диапазона унаследованы от более широкого уровня "
            "уверенности — наблюдений для собственной калибровки пока мало."
        )

    return text.strip()


def _factor_source(code: str, task: Task, refs: ReferenceBundle) -> str:
    """Откуда взялся балл фактора — посчитан, оценён субагентом или нейтрален.

    Различие обязано быть видно в интерфейсе: балл 0.5 «потому что нейтрально»
    и балл 0.5 «потому что посчитали» — разные утверждения, и первое означает,
    что кто-то не заполнил поле.

    У уровня заказчика недостаточно проверить, что ФИО пришло: имя может быть
    указано, а уровень в справочнике не проставлен — балл всё равно нейтральный,
    и назвать его посчитанным значило бы скрыть незаполненный справочник.
    """
    if code in ("F5_strategy_fit", "F6_dependencies"):
        return "assessed"
    if code == "F2_customer_level":
        default_level = (refs.raw["customer_levels"] or {}).get("default_level", "unknown")
        level = refs.customer_level(task.customer, task.customer_division)
        return "default" if level == default_level else "computed"
    unfilled = {
        "F1_value": task.value_internal_mln is None,
        "F3_urgency": task.deadline is None,
        "F4_effort": task.effort_man_days is None,
    }
    return "default" if unfilled.get(code) else "computed"


def _factor_explanation(code: str, task: Task, score: float, refs: ReferenceBundle) -> str:
    """Как получился балл фактора — с правилом, а не только с исходным значением.

    «Трудозатраты 45 ч/д» не объясняет, почему балл 0.38; «45 ч/д между
    порогами 5 и 50, линейно от 1.0 до 0.3» — объясняет. Методолог должен
    видеть само правило, чтобы понимать, что менять в справочнике.
    """
    norm = refs.normalisation
    if code == "F1_value":
        if task.value_internal_mln is None:
            return "Value не рассчитан — балл 0"
        return (
            f"Value {task.value_internal_mln:g} млн ₽. Логарифмическая нормализация "
            f"по максимуму бэклога: ln(1+{task.value_internal_mln:g}) / ln(1+макс.). "
            "Логарифм принципиален — эффекты различаются на два порядка. "
            f"Вклад умножен на уверенность в оценке Value "
            f"({task.value_confidence or 'не определена'}): уверенность уточняет "
            "сам Value, а не является отдельным свойством задачи"
        )
    if code == "F2_customer_level":
        who = task.customer or task.customer_division or "не указан"
        level = refs.customer_level(task.customer, task.customer_division)
        default = (refs.raw["customer_levels"] or {}).get("default_level", "unknown")
        if level == default:
            return (
                f"Заказчик «{who}», уровень в справочнике не проставлен ({level}) — "
                "нейтральный балл. Это не оценка, а отсутствие данных"
            )
        return f"Заказчик «{who}», уровень {level} — дискретный балл из справочника"
    if code == "F3_urgency":
        if task.deadline is None:
            return "Срок не указан — минимальный балл по правилу «нет дедлайна»"
        days = (task.deadline - dt.date.today()).days
        steps = (norm.get("F3_urgency") or {}).get("steps") or []
        rule = ", ".join(f"≤{int(th)} дн. → {sc:g}" for th, sc in steps)
        if days < 0:
            return (
                f"Срок {task.deadline.isoformat()} просрочен на {-days} дн. — "
                "максимальный балл: просроченная задача не может быть менее срочной, "
                "чем задача со сроком завтра"
            )
        return (
            f"Срок {task.deadline.isoformat()}, до него {days} дн. "
            f"Ступени: {rule}, дальше минимум"
        )
    if code == "F4_effort":
        if task.effort_man_days is None:
            return "Трудозатраты не заполнены — нейтральный балл, а не оценка"
        cfg = norm.get("F4_effort") or {}
        low, high = cfg.get("low_man_days", 5), cfg.get("high_man_days", 50)
        return (
            f"Трудозатраты {task.effort_man_days:g} ч/д. Обратная шкала: "
            f"меньше {low:g} ч/д → {cfg.get('low_score', 1.0):g}, "
            f"больше {high:g} ч/д → {cfg.get('high_score', 0.3):g}, между ними линейно"
        )
    if code == "F5_strategy_fit":
        base = task.strategy_fit_rationale or "оценка стратегического соответствия"
        raw = task.strategy_fit_raw
        if raw is not None:
            return f"Балл рубрики {raw:g} из 10 → шкала 0.1–1.0. {base}"
        return base
    if code == "F6_dependencies":
        base = task.dependency_rationale or "оценка зависимостей между командами"
        return f"{base} Штраф зависит от типа связи, пол балла 0.2"
    if code == "F7_task_type":
        return (
            f"Тип «{task.task_type or 'не указан'}» — дискретный балл "
            "из справочника типов задач"
        )
    return f"Балл {score:.2f}"


def _priority_result(task: Task, refs: ReferenceBundle, scored) -> PriorityResult:
    weights = refs.weights
    factors = [
        FactorResult(
            code=code.split("_")[0],
            title=FACTOR_TITLES[code],
            weight=round(weights[code], 4),
            score=round(value, 4),
            multiplier=round(scored.multipliers.get(code, 1.0), 4),
            contribution=round(scored.contributions[code], 4),
            explanation=_factor_explanation(code, task, value, refs),
            source=_factor_source(code, task, refs),
        )
        for code, value in scored.factors.items()
    ]
    factors.sort(key=lambda f: f.contribution, reverse=True)

    return PriorityResult(
        priority=scored.priority,
        score=round(scored.score, 4),
        factors=factors,
        overrides=[
            OverrideApplied(
                rule_id=str(o.get("id")),
                title=str(o.get("title") or ""),
                reason=str(o.get("reason") or ""),
                priority_before=str(o.get("priority_before")),
                priority_after=str(o.get("priority_after")),
            )
            for o in scored.applied_overrides
        ],
        rationale=scored.reason,
        cost_rub=task.cost_rub,
        cost_to_value=round(task.cost_to_value, 4) if task.cost_to_value is not None else None,
        bands=refs.priority_bands,
    )


# --- сценарии ----------------------------------------------------------------


def handle_value(
    attrs: TaskAttributes, session: Session | None = None
) -> AgentResponse | ErrorResponse:
    return handle_request(attrs, "value", session)


def handle_priority(
    attrs: TaskAttributes, session: Session | None = None
) -> AgentResponse | ErrorResponse:
    return handle_request(attrs, "priority", session)


def handle_request(
    attrs: TaskAttributes,
    request_type: str,
    session: Session | None = None,
) -> AgentResponse | ErrorResponse:
    """Единая точка входа обоих сценариев."""
    started = time.monotonic()

    missing = check_required(attrs, request_type)
    if missing:
        return ErrorResponse(
            task_id=attrs.task_id,
            request_type=request_type,  # type: ignore[arg-type]
            status="insufficient_data",
            error="Не заполнены обязательные атрибуты",
            missing_attributes=missing,
        )

    refs = ReferenceBundle(session)
    snapshot = get_snapshot()
    versions = refs.versions()
    key = cache_key(
        attrs,
        request_type,
        reference_versions=versions,
        snapshot_version=snapshot.version,
    )

    # Проверка совпадения атрибутов — до обращения к модели, а не после.
    previous = find_previous(session, key, request_type)
    restored = _restore(previous)
    if restored is not None:
        restored.audit.cached = True
        restored.audit.reused_from_request_id = previous.request_id
        restored.audit.request_id = new_request_id()
        restored.audit.duration_ms = int((time.monotonic() - started) * 1000)
        return restored

    warnings: list[str] = []
    if not snapshot.available:
        warnings.append(
            "Слепок исторических Value отсутствует: оценка по аналогии недоступна, "
            "расчёт идёт по формуле и заметно менее точен."
        )

    task = build_task(attrs, refs)
    try:
        response = _compute(
            task, attrs, request_type, refs, snapshot, session, warnings, key, started
        )
    except LLMExecutionError:
        return ErrorResponse(
            task_id=attrs.task_id,
            request_type=request_type,  # type: ignore[arg-type]
            status="error",
            error="LLM недоступна. Расчёт не выполнен.",
        )

    remember(
        session,
        request_id=response.audit.request_id,
        cache_key=key,
        request_type=request_type,
        task_key=attrs.task_id,
        attributes=attrs.model_dump(mode="json", exclude_none=True),
        response=response.model_dump(mode="json"),
        method=response.value.method if response.value else None,
        drivers={
            "methods": [m.model_dump(mode="json") for m in response.value.methods]
        }
        if response.value
        else {},
        snapshot_version=snapshot.version,
        reference_versions=versions,
        llm_calls=response.audit.llm_calls,
        duration_ms=response.audit.duration_ms,
    )
    return response



def _restore(previous) -> AgentResponse | None:
    """Прежний ответ из истории. None — считаем заново.

    Ответ мог быть сохранён под прежней версией контракта: поля переименованы,
    добавлены обязательные. Разбирать такой ответ нельзя, но и падать нельзя —
    правка контракта не должна ронять сервис на всех задачах, посчитанных до
    неё. Непрочитанная запись просто считается промахом кэша.
    """
    if previous is None:
        return None
    try:
        return AgentResponse.model_validate(previous.response)
    except ValidationError:
        return None


class LLMExecutionError(RuntimeError):
    """Настроенная модель не выполнила обязательную часть расчёта."""


def _compute(
    task: Task,
    attrs: TaskAttributes,
    request_type: str,
    refs: ReferenceBundle,
    snapshot: ValueSnapshot,
    session: Session | None,
    warnings: list[str],
    key: str,
    started: float,
) -> AgentResponse:
    from app.llm.factory import classify_with_cache, get_adapter
    from app.strategy.analysts import get_dependency_analyst, get_strategy_analyst
    from app.strategy.store import apply_dependencies_to_task, apply_strategy_to_task

    llm_calls = 0
    settings = get_settings()

    # --- Value ---------------------------------------------------------------
    hints: dict[str, Any] = {}
    if task.value_manual_mln is None and not (task.is_regulatory or task.is_rnd):
        text = " ".join(filter(None, [task.title, task.project, task.comment]))
        try:
            classified = classify_with_cache(
                get_adapter(), text, task.team, task.team_class, session
            )
            hints = classified.as_dict()
            llm_calls += 1
            if classified.kind == "regulatory":
                task.is_regulatory = True
            elif classified.kind == "rnd":
                task.is_rnd = True
        except Exception as exc:  # noqa: BLE001
            raise LLMExecutionError("Не выполнена классификация задачи") from exc

    core = compute_value(task, refs, hints, _analogy_index(snapshot))
    task.value_internal_mln = core.value_internal_mln
    task.value_source = core.source
    task.value_confidence = core.confidence
    task.value_inputs = core.inputs
    task.value_hint = core.hint
    task.zero_value_reason = core.zero_value_reason
    task.value_low_mln = core.interval.low_mln if core.interval else None
    task.value_high_mln = core.interval.high_mln if core.interval else None
    task.cost_rub = compute_cost(task, refs)
    task.cost_to_value = compute_cost_to_value(task.cost_rub, task.value_internal_mln)

    value_out = _value_result(task, core, attrs, warnings)

    if request_type == "value":
        return AgentResponse(
            task_id=attrs.task_id,
            request_type="value",
            status="ok" if value_out.value_mln is not None else "insufficient_data",
            value=value_out,
            warnings=warnings,
            audit=_audit(key, snapshot, refs, llm_calls, started),
        )

    # --- Приоритет -----------------------------------------------------------
    text = " ".join(filter(None, [task.title, task.project, task.comment]))

    # Проект по гранулярности ближе к стратегии, чем название задачи, поэтому
    # он идёт первым: оценщик читает его как основной сигнал.
    strategy_text = " ".join(filter(None, [task.project, task.title, task.comment]))
    try:
        assessment = get_strategy_analyst().assess(strategy_text, task.team, refs.strategy_rubric)
        if assessment is not None:
            apply_strategy_to_task(task, assessment)
            if settings.strategy_provider != "stub":
                llm_calls += 1
    except Exception as exc:  # noqa: BLE001
        raise LLMExecutionError("Не выполнена оценка стратегического соответствия") from exc

    # Субагент зависимостей нужен, только когда команды не перечислены человеком:
    # заполненное поле точнее любого вывода модели.
    if task.involved_teams_raw:
        analyst = get_dependency_analyst("declared")
    else:
        analyst = get_dependency_analyst()
    try:
        assessment = analyst.assess(
            text, task.team, task.involved_teams_raw, refs.team_names, refs.strategy_rubric
        )
        if assessment is not None:
            apply_dependencies_to_task(task, assessment)
            if not task.involved_teams_raw and settings.dependency_provider != "declared":
                llm_calls += 1
    except Exception as exc:  # noqa: BLE001
        raise LLMExecutionError("Не выполнена оценка зависимостей") from exc

    # Шкала F1 берётся из слепка: без неё Value этой задачи считался бы в
    # другой шкале, чем у соседей по бэклогу.
    ctx = ScoringContext(
        max_value_mln=max(snapshot.max_value_mln, task.value_internal_mln or 0.0),
        today=dt.date.today(),
    )
    if not snapshot.available:
        warnings.append(
            "Шкала фактора «Value» построена по одной задаче: без слепка "
            "максимум по бэклогу неизвестен, и балл несопоставим с соседями."
        )

    scored = score_task(task, refs, ctx)
    task.priority = scored.priority
    task.priority_score = scored.score

    return AgentResponse(
        task_id=attrs.task_id,
        request_type="priority",
        value=value_out if attrs.value_internal_mln is None else None,
        priority=_priority_result(task, refs, scored),
        warnings=warnings,
        audit=_audit(key, snapshot, refs, llm_calls, started),
    )


def _audit(
    key: str,
    snapshot: ValueSnapshot,
    refs: ReferenceBundle,
    llm_calls: int,
    started: float,
) -> ResponseAudit:
    settings = get_settings()
    return ResponseAudit(
        request_id=new_request_id(),
        cache_key=key,
        cached=False,
        reference_versions=refs.versions(),
        snapshot_version=snapshot.version,
        llm_calls=llm_calls,
        model=settings.llm_provider,
        duration_ms=int((time.monotonic() - started) * 1000),
        computed_at=dt.datetime.now(dt.timezone.utc),
    )
