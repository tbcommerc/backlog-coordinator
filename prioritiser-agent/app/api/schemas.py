"""Схемы запросов и ответов API."""

from __future__ import annotations

import datetime as dt
from typing import Any

from pydantic import BaseModel, Field


class TaskOut(BaseModel):
    task_key: str
    team: str | None = None
    title: str | None = None
    task_type: str | None = None
    customer: str | None = None
    status: str | None = None

    priority: str | None = None
    priority_score: float | None = None
    priority_original: str | None = None
    priority_reason: str | None = None

    value_internal_mln: float | None = None
    value_low_mln: float | None = None
    value_high_mln: float | None = None
    value_external_mln: float | None = None
    value_external_status: str | None = None
    value_source: str | None = None
    value_confidence: str | None = None
    value_hint: str | None = None

    cost_rub: float | None = None
    cost_to_value: float | None = None
    effort_man_days: float | None = None
    deadline: dt.date | None = None

    factor_scores: dict[str, float] = Field(default_factory=dict)
    factor_contributions: dict[str, float] = Field(default_factory=dict)
    applied_overrides: list[dict[str, Any]] = Field(default_factory=list)
    computed_at: dt.datetime | None = None


class TaskExternalOut(BaseModel):
    """Выгрузка для внешнего контура.

    US-7: наружу уходит только доходная методика. Поля value_internal и любых
    производных экономии времени в этой схеме нет физически — так ограничение
    руководства банка выполняется структурой API, а не дисциплиной выгружающего.
    """

    task_key: str
    team: str | None = None
    title: str | None = None
    priority: str | None = None
    value_external_mln: float | None = None
    value_external_status: str | None = None


class TaskUpdateIn(BaseModel):
    value_manual_mln: float | None = None
    effort_man_days: float | None = None
    deadline: dt.date | None = None
    customer: str | None = None
    task_type: str | None = None
    team: str | None = None
    title: str | None = None


class PriorityHistoryOut(BaseModel):
    created_at: dt.datetime
    old_priority: str | None = None
    new_priority: str | None = None
    old_score: float | None = None
    new_score: float | None = None
    reason: str
    actor: str


class RecomputeIn(BaseModel):
    use_llm: bool = True
    refresh_strategy: bool = False
    reason: str = "references_changed"


class RecomputeOut(BaseModel):
    ok: bool = True
    stats: dict[str, Any]


class ReferenceIn(BaseModel):
    payload: dict[str, Any]
    actor: str = "methodologist"


class ReferenceOut(BaseModel):
    name: str
    version: int
    payload: dict[str, Any]


class AttributionIn(BaseModel):
    period: str
    front_actual_revenue_mln: float
    actor: str = "methodologist"
    only_closed: bool = True


class RagQueryOut(BaseModel):
    query: str
    retrieval_mode: str
    corpus_size: int
    results: list[dict[str, Any]]
