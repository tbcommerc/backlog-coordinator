"""Хранение оценок факторов F5 и F6.

Активная оценка одна на пару «задача + фактор». Новая делает предыдущую
неактивной, а не затирает её: история суждений нужна, когда методолог
спрашивает, почему у задачи изменился приоритет.

Денормализация в поля `Task` сделана намеренно. Функции факторов в
`value_priority_assessor/core/scoring.py` не имеют доступа к сессии и не должны его иметь: они
чистые, и это то, что позволяет прогонять их в тестах на голых объектах и
пересчитывать 440 задач за доли секунды.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from value_priority_assessor.core.models import FactorAssessment, Task
from value_priority_assessor.strategy.rubric import (
    FACTOR_DEPENDENCIES,
    FACTOR_STRATEGY,
    DependencyAssessment,
    StrategyAssessment,
)


def get_active(session: Session, task_id: int, factor: str) -> FactorAssessment | None:
    return session.scalar(
        select(FactorAssessment)
        .where(
            FactorAssessment.task_id == task_id,
            FactorAssessment.factor == factor,
            FactorAssessment.is_active.is_(True),
        )
        .order_by(FactorAssessment.id.desc())
    )


def _deactivate(session: Session, task_id: int, factor: str) -> None:
    for row in session.scalars(
        select(FactorAssessment).where(
            FactorAssessment.task_id == task_id,
            FactorAssessment.factor == factor,
            FactorAssessment.is_active.is_(True),
        )
    ).all():
        row.is_active = False


def save_strategy(
    session: Session,
    task: Task,
    assessment: StrategyAssessment,
    provider: str,
    actor: str = "agent",
    model: str | None = None,
) -> FactorAssessment:
    _deactivate(session, task.id, FACTOR_STRATEGY)
    row = FactorAssessment(
        task_id=task.id,
        factor=FACTOR_STRATEGY,
        score=assessment.raw_score,
        payload=assessment.as_dict(),
        rationale=assessment.rationale,
        evidence=assessment.evidence,
        provider=provider,
        actor=actor,
        model=model,
        confidence=assessment.confidence,
        rubric_version=assessment.rubric_version,
    )
    session.add(row)
    apply_strategy_to_task(task, assessment)
    return row


def save_dependencies(
    session: Session,
    task: Task,
    assessment: DependencyAssessment,
    provider: str,
    actor: str = "agent",
    model: str | None = None,
) -> FactorAssessment:
    _deactivate(session, task.id, FACTOR_DEPENDENCIES)
    row = FactorAssessment(
        task_id=task.id,
        factor=FACTOR_DEPENDENCIES,
        score=assessment.score,
        payload=assessment.as_dict(),
        rationale=assessment.rationale,
        evidence=assessment.evidence,
        provider=provider,
        actor=actor,
        model=model,
        rubric_version=assessment.rubric_version,
    )
    session.add(row)
    apply_dependencies_to_task(task, assessment)
    return row


def apply_strategy_to_task(task: Task, assessment: StrategyAssessment) -> None:
    task.strategy_fit_raw = assessment.raw_score
    task.strategy_fit_rationale = assessment.rationale or None
    task.strategy_fit_confidence = assessment.confidence


def apply_dependencies_to_task(task: Task, assessment: DependencyAssessment) -> None:
    task.dependency_score = assessment.score
    task.dependency_teams = assessment.teams
    task.dependency_rationale = assessment.rationale or None
    # Счётчик остаётся в синхроне: на него смотрят выгрузки и старые отчёты.
    task.involved_teams_count = len(assessment.teams)


def hydrate_task(session: Session, task: Task) -> None:
    """Переносит активные оценки в поля задачи перед расчётом приоритета."""
    strategy = get_active(session, task.id, FACTOR_STRATEGY)
    if strategy is not None:
        task.strategy_fit_raw = strategy.score
        task.strategy_fit_rationale = strategy.rationale
        task.strategy_fit_confidence = strategy.confidence

    dependencies = get_active(session, task.id, FACTOR_DEPENDENCIES)
    if dependencies is not None:
        task.dependency_score = dependencies.score
        task.dependency_teams = (dependencies.payload or {}).get("teams") or []
        task.dependency_rationale = dependencies.rationale


def assessment_summary(session: Session, task: Task) -> dict[str, Any]:
    """Сводка оценок для карточки задачи и инструментов агента."""
    summary: dict[str, Any] = {}
    for factor in (FACTOR_STRATEGY, FACTOR_DEPENDENCIES):
        row = get_active(session, task.id, factor)
        summary[factor] = (
            None
            if row is None
            else {
                "score": row.score,
                "provider": row.provider,
                "actor": row.actor,
                "model": row.model,
                "confidence": row.confidence,
                "rubric_version": row.rubric_version,
                "rationale": row.rationale,
                "evidence": row.evidence,
                "created_at": row.created_at,
                "payload": row.payload,
            }
        )
    return summary
