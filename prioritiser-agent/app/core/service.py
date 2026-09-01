"""Оркестрация расчёта: один прогон агента над задачей или всем бэклогом.

Порядок шагов важен и не переставляется произвольно:

1. Value, Cost и C/V — по каждой задаче отдельно. C/V показывается в карточке,
   но в приоритет не входит: он выводится из Value и трудозатрат, которые уже
   учтены факторами F1 и F4.
2. Контекст нормализации — по всему бэклогу (F1 нормализуется относительно
   максимума).
3. Свёртка в приоритет и запись истории изменений.

Поэтому «пересчитать одну задачу» всё равно читает агрегаты по бэклогу, иначе
задача получила бы балл в другой шкале, чем соседи.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.analogy import AnalogyIndex
from app.core.models import PriorityHistory, Task
from app.core.references import ReferenceBundle
from app.core.scoring import ScoringContext, score_task
from app.core.value import compute_cost, compute_cost_to_value, compute_value
from app.llm.factory import classify_with_cache, get_adapter
from app.strategy.analysts import get_dependency_analyst, get_strategy_analyst
from app.strategy.store import (
    apply_dependencies_to_task,
    apply_strategy_to_task,
    hydrate_task,
    save_dependencies,
    save_strategy,
)

REASON_INITIAL = "initial_load"
REASON_ATTRIBUTES = "attributes_changed"
REASON_WEIGHTS = "weights_changed"
REASON_REFERENCES = "references_changed"
REASON_MANUAL = "manual_override"


@dataclass
class RecomputeStats:
    total: int = 0
    priority_changed: int = 0
    value_computed: int = 0
    value_manual: int = 0
    zero_value: int = 0
    llm_errors: int = 0
    by_priority: dict[str, int] = field(default_factory=dict)
    by_confidence: dict[str, int] = field(default_factory=dict)
    duration_seconds: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "priority_changed": self.priority_changed,
            "value_computed": self.value_computed,
            "value_manual": self.value_manual,
            "zero_value": self.zero_value,
            "llm_errors": self.llm_errors,
            "by_priority": self.by_priority,
            "by_confidence": self.by_confidence,
            "duration_seconds": round(self.duration_seconds, 2),
        }


def _assess_factors(
    task: Task,
    refs: ReferenceBundle,
    text: str,
    strategy_analyst,
    dependency_analyst,
    session: Session | None,
    refresh: bool,
) -> None:
    """Оценки F5 и F6 субагентами, с сохранением и переиспользованием.

    Оценки не пересчитываются на каждом прогоне намеренно. Изменение весов
    факторов не меняет сути суждения «насколько задача стратегична», а
    обращение к модели по 440 задачам не укладывается в норматив НФ8. Поэтому
    сохранённая оценка переиспользуется, пока её явно не попросят обновить.
    """
    if session is not None and not refresh:
        hydrate_task(session, task)

    needs_strategy = refresh or task.strategy_fit_raw is None
    needs_dependencies = refresh or task.dependency_score is None

    if needs_strategy:
        assessment = strategy_analyst.assess(text, task.team, refs.strategy_rubric)
        if assessment is not None:
            if session is not None and task.id is not None:
                save_strategy(
                    session,
                    task,
                    assessment,
                    provider=strategy_analyst.name,
                    actor="recompute",
                    model=getattr(strategy_analyst, "model", None),
                )
            else:
                apply_strategy_to_task(task, assessment)

    if needs_dependencies:
        assessment = dependency_analyst.assess(
            text, task.team, task.involved_teams_raw, refs.team_names, refs.strategy_rubric
        )
        if assessment is not None:
            if session is not None and task.id is not None:
                save_dependencies(
                    session,
                    task,
                    assessment,
                    provider=dependency_analyst.name,
                    actor="recompute",
                    model=getattr(dependency_analyst, "model", None),
                )
            else:
                apply_dependencies_to_task(task, assessment)


def _prepare_task(
    task: Task,
    refs: ReferenceBundle,
    adapter,
    strategy_analyst,
    dependency_analyst,
    session: Session | None,
    use_llm: bool,
    refresh_strategy: bool,
    analogy_index=None,
) -> None:
    """Шаг 1: Value, Cost, C/V и вводные, не зависящие от остального бэклога."""
    task.team_class = refs.team_class(task.team)
    text = " ".join(filter(None, [task.title, task.project, task.comment]))

    _assess_factors(
        task, refs, text, strategy_analyst, dependency_analyst, session, refresh_strategy
    )

    hints: dict[str, Any] = {}
    if use_llm and task.value_manual_mln is None and not (task.is_regulatory or task.is_rnd):
        task_hints = classify_with_cache(adapter, text, task.team, task.team_class, session)
        hints = task_hints.as_dict()
        # Модель может распознать регуляторку или RnD там, где ключевых слов нет.
        if task_hints.kind == "regulatory":
            task.is_regulatory = True
        elif task_hints.kind == "rnd":
            task.is_rnd = True

    result = compute_value(task, refs, hints, analogy_index)
    task.value_internal_mln = result.value_internal_mln
    task.value_source = result.source
    task.value_confidence = result.confidence
    task.value_inputs = result.inputs
    task.value_hint = result.hint
    task.zero_value_reason = result.zero_value_reason
    task.value_low_mln = result.interval.low_mln if result.interval else None
    task.value_high_mln = result.interval.high_mln if result.interval else None

    # value_external обслуживающих команд ex-ante не считается — его выставляет
    # только ex-post атрибуция, поэтому уже посчитанное значение не затираем.
    if result.value_external_mln is not None:
        task.value_external_mln = result.value_external_mln
        task.value_external_status = result.value_external_status
    elif task.value_external_mln is None:
        task.value_external_status = result.value_external_status

    task.cost_rub = compute_cost(task, refs)
    task.cost_to_value = compute_cost_to_value(task.cost_rub, task.value_internal_mln)


def _apply_score(task: Task, refs: ReferenceBundle, ctx: ScoringContext, reason: str) -> bool:
    """Шаг 3: свёртка и история. Возвращает True, если приоритет изменился."""
    previous_priority = task.priority
    previous_score = task.priority_score

    result = score_task(task, refs, ctx)
    task.priority = result.priority
    task.priority_score = result.score
    task.factor_scores = result.factors
    task.factor_contributions = result.contributions
    task.applied_overrides = result.applied_overrides
    task.priority_reason = result.reason
    task.computed_at = dt.datetime.now(dt.timezone.utc)

    changed = previous_priority != result.priority
    if changed:
        task.history.append(
            PriorityHistory(
                old_priority=previous_priority,
                new_priority=result.priority,
                old_score=previous_score,
                new_score=result.score,
                reason=reason if previous_priority else REASON_INITIAL,
                detail={
                    "factors": result.factors,
                    "overrides": result.applied_overrides,
                },
            )
        )
    return changed


def recompute_all(
    session: Session,
    reason: str = REASON_ATTRIBUTES,
    use_llm: bool = True,
    refresh_strategy: bool = False,
    today: dt.date | None = None,
) -> RecomputeStats:
    """Пересчитывает Value и приоритет для всего бэклога.

    НФ8: норматив — не более 60 секунд на 100 задач. Он выполним только потому,
    что ответы модели берутся из кэша, а внешний агент не опрашивается заново
    при изменении справочников.
    """
    import time

    started = time.perf_counter()
    refs = ReferenceBundle(session)
    adapter = get_adapter()
    strategy_analyst = get_strategy_analyst(adapter=adapter)
    dependency_analyst = get_dependency_analyst(adapter=adapter)
    # Индекс аналогий строится один раз на прогон: почти двести текстов
    # через модель эмбеддингов на каждой задаче были бы недопустимы.
    analogy_index = AnalogyIndex(session) if get_settings().value_analogy else None

    tasks = list(session.scalars(select(Task)).all())
    stats = RecomputeStats(total=len(tasks))

    for task in tasks:
        _prepare_task(
            task, refs, adapter, strategy_analyst, dependency_analyst,
            session, use_llm, refresh_strategy, analogy_index,
        )
        if task.value_source == "manual":
            stats.value_manual += 1
        elif task.value_source == "zero":
            stats.zero_value += 1
        else:
            stats.value_computed += 1
        stats.by_confidence[task.value_confidence or "unknown"] = (
            stats.by_confidence.get(task.value_confidence or "unknown", 0) + 1
        )

    session.flush()
    ctx = ScoringContext.from_tasks(tasks, today=today)

    for task in tasks:
        if _apply_score(task, refs, ctx, reason):
            stats.priority_changed += 1
        stats.by_priority[task.priority] = stats.by_priority.get(task.priority, 0) + 1

    stats.duration_seconds = time.perf_counter() - started
    return stats


def recompute_task(
    session: Session,
    task: Task,
    reason: str = REASON_ATTRIBUTES,
    use_llm: bool = True,
    refresh_strategy: bool = False,
    today: dt.date | None = None,
) -> Task:
    """Пересчитывает одну задачу в шкале всего бэклога (Ф25)."""
    refs = ReferenceBundle(session)
    adapter = get_adapter()
    strategy_analyst = get_strategy_analyst(adapter=adapter)
    dependency_analyst = get_dependency_analyst(adapter=adapter)
    # Индекс аналогий строится один раз на прогон: почти двести текстов
    # через модель эмбеддингов на каждой задаче были бы недопустимы.
    analogy_index = AnalogyIndex(session) if get_settings().value_analogy else None

    _prepare_task(
        task, refs, adapter, strategy_analyst, dependency_analyst,
        session, use_llm, refresh_strategy, analogy_index,
    )
    session.flush()

    siblings: Iterable[Task] = session.scalars(select(Task)).all()
    ctx = ScoringContext.from_tasks(siblings, today=today)
    _apply_score(task, refs, ctx, reason)
    return task
