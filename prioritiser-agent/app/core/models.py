"""Модель данных прототипа (SQLAlchemy 2.0).

Прототип живёт на SQLite; по ТЗ (НФ3) продовая версия работает на PostgreSQL 14+
и интегрируется с БД Единого бэклога. Схема специально не использует ничего
SQLite-специфичного, чтобы переезд свёлся к смене DSN.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Task(Base):
    """Инициатива Единого бэклога.

    Поля делятся на три группы: исходные атрибуты бэклога (as-is из экспорта),
    нормализованные производные и результат работы агента.
    """

    __tablename__ = "task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_key: Mapped[str] = mapped_column(String(64), index=True)  # «ID задачи»

    # --- Исходные атрибуты бэклога ------------------------------------------
    team: Mapped[str | None] = mapped_column(String(128), index=True)
    title: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str | None] = mapped_column(String(128), index=True)
    channel: Mapped[str | None] = mapped_column(String(128))
    customer: Mapped[str | None] = mapped_column(String(256))
    customer_division: Mapped[str | None] = mapped_column(String(256))
    project: Mapped[str | None] = mapped_column(String(256))
    status: Mapped[str | None] = mapped_column(String(128), index=True)
    assignee: Mapped[str | None] = mapped_column(String(256))
    backlog_priority_original: Mapped[str | None] = mapped_column(String(64))
    deadline_raw: Mapped[str | None] = mapped_column(String(256))
    involved_teams_raw: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # --- Нормализованные производные ----------------------------------------
    created_date: Mapped[dt.date | None] = mapped_column(Date)
    deadline: Mapped[dt.date | None] = mapped_column(Date, index=True)
    involved_teams_count: Mapped[int] = mapped_column(Integer, default=0)
    effort_man_days: Mapped[float | None] = mapped_column(Float)
    team_class: Mapped[str | None] = mapped_column(String(16))  # earning | serving

    # --- Value -------------------------------------------------------------
    value_manual_mln: Mapped[float | None] = mapped_column(Float)
    """Значение из поля «Фин. эффект», введённое человеком. Агент его не трогает (Ф1)."""

    value_internal_mln: Mapped[float | None] = mapped_column(Float)
    value_external_mln: Mapped[float | None] = mapped_column(Float)
    value_external_status: Mapped[str | None] = mapped_column(String(32))
    """`computed` | `tbd` — до первого запуска ex-post атрибуции (Ф9)."""

    value_source: Mapped[str | None] = mapped_column(String(32))
    """`manual` | `revenue` | `time_saving` | `zero`."""

    value_confidence: Mapped[str | None] = mapped_column(String(16))  # high | medium | low

    # Границы, внутри которых истинное значение оказывается в 95% случаев.
    # Множители откалиброваны на фактических ошибках, см. app/core/intervals.py.
    value_low_mln: Mapped[float | None] = mapped_column(Float)
    value_high_mln: Mapped[float | None] = mapped_column(Float)
    value_inputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    """Промежуточные вводные и формула — НФ19 требует хранить их для аудита."""

    value_hint: Mapped[str | None] = mapped_column(Text)
    """Подсказка под полем Value (Ф22): метод, вводные, уверенность, что уточнить."""

    zero_value_reason: Mapped[str | None] = mapped_column(String(32))  # regulatory | rnd

    # --- Cost и C/V ---------------------------------------------------------
    cost_rub: Mapped[float | None] = mapped_column(Float)
    cost_to_value: Mapped[float | None] = mapped_column(Float)

    # --- Результат приоритизации -------------------------------------------
    priority: Mapped[str | None] = mapped_column(String(8), index=True)
    priority_score: Mapped[float | None] = mapped_column(Float, index=True)
    priority_reason: Mapped[str | None] = mapped_column(Text)
    factor_scores: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    factor_contributions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    applied_overrides: Mapped[list[Any]] = mapped_column(JSON, default=list)

    is_regulatory: Mapped[bool] = mapped_column(Boolean, default=False)
    is_rnd: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocking: Mapped[bool] = mapped_column(Boolean, default=False)

    # F5: балл 1–10. Денормализован из активной оценки, чтобы функции факторов
    # оставались чистыми и не ходили в БД по каждой задаче.
    strategy_fit_raw: Mapped[float | None] = mapped_column(Float)
    strategy_fit_rationale: Mapped[str | None] = mapped_column(Text)
    strategy_fit_confidence: Mapped[str | None] = mapped_column(String(16))

    # F6: готовый балл 0–1 и разбор зависимостей. None означает, что оценки нет
    # и фактор считается по атрибуту «Другие вовлечённые команды».
    dependency_score: Mapped[float | None] = mapped_column(Float)
    dependency_teams: Mapped[list[Any]] = mapped_column(JSON, default=list)
    dependency_rationale: Mapped[str | None] = mapped_column(Text)

    computed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    history: Mapped[list["PriorityHistory"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    assessments: Mapped[list["FactorAssessment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("task_key", name="uq_task_key"),
        Index("ix_task_team_priority", "team", "priority"),
    )

    def __repr__(self) -> str:  # pragma: no cover - отладочное представление
        return f"<Task {self.task_key} {self.team} {self.priority}>"


class PriorityHistory(Base):
    """История изменений приоритета (ТЗ Ф21, НФ17 — откат в течение 30 дней)."""

    __tablename__ = "priority_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), index=True)

    old_priority: Mapped[str | None] = mapped_column(String(8))
    new_priority: Mapped[str | None] = mapped_column(String(8))
    old_score: Mapped[float | None] = mapped_column(Float)
    new_score: Mapped[float | None] = mapped_column(Float)

    reason: Mapped[str] = mapped_column(String(64))
    """attributes_changed | weights_changed | references_changed | manual_override | initial_load"""

    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor: Mapped[str] = mapped_column(String(128), default="agent")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    task: Mapped[Task] = relationship(back_populates="history")


class Reference(Base):
    """Справочник агента: веса, константы, уровни заказчиков, типы, овверрайды.

    Хранится документом JSON, чтобы админ-панель редактировала его целиком и
    каждое сохранение получало собственную версию (US-4: логирование автора и
    времени изменения).
    """

    __tablename__ = "reference"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor: Mapped[str] = mapped_column(String(128), default="seed")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (Index("ix_reference_name_active", "name", "is_active"),)


class LlmCall(Base):
    """Кэш и журнал обращений к LLM и Strategy Decomposer.

    НФ5 требует кэшировать ответы по хешу промпта, НФ18 — логировать токены,
    время и стоимость. Одна таблица закрывает оба требования.
    """

    __tablename__ = "llm_call"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model: Mapped[str | None] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(64), index=True)
    prompt_hash: Mapped[str] = mapped_column(String(64), index=True)
    prompt: Mapped[str | None] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)

    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    cost_rub: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        Index("ix_llm_cache_lookup", "provider", "purpose", "prompt_hash"),
    )


class FactorAssessment(Base):
    """Оценка фактора F5 или F6 с полным происхождением.

    Хранится не итоговый балл, а ответы по рубрике, обоснование и ссылки на
    найденные источники. Это даёт три вещи, которых не даёт число: оценку можно
    оспорить по конкретному критерию, пересчитать при изменении весов рубрики
    без повторного обращения к модели и показать методологу, на чём она стоит.

    Активная оценка одна на пару «задача + фактор»; предыдущие сохраняются
    неактивными, образуя историю суждений.
    """

    __tablename__ = "factor_assessment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), index=True)
    factor: Mapped[str] = mapped_column(String(32), index=True)  # F5_strategy_fit | F6_dependencies

    score: Mapped[float] = mapped_column(Float)
    """F5 — балл 1–10 по шкале ТЗ; F6 — готовый балл фактора 0–1."""

    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    rationale: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[list[Any]] = mapped_column(JSON, default=list)

    provider: Mapped[str] = mapped_column(String(32), index=True)
    """agent | stub | rest | manual — чем получена оценка."""

    actor: Mapped[str] = mapped_column(String(128), default="agent")
    model: Mapped[str | None] = mapped_column(String(64))
    confidence: Mapped[str | None] = mapped_column(String(16))
    rubric_version: Mapped[int] = mapped_column(Integer, default=1)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    task: Mapped[Task] = relationship(back_populates="assessments")

    __table_args__ = (
        Index("ix_assessment_lookup", "task_id", "factor", "is_active"),
    )


class AttributionRun(Base):
    """Запуск ex-post атрибуции value_external для обслуживающих команд (Ф8, US-6)."""

    __tablename__ = "attribution_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period: Mapped[str] = mapped_column(String(32))  # например «3Q 2026»
    front_actual_revenue_mln: Mapped[float] = mapped_column(Float)
    attributed_front_initiatives_mln: Mapped[float] = mapped_column(Float, default=0.0)
    residual_mln: Mapped[float] = mapped_column(Float, default=0.0)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor: Mapped[str] = mapped_column(String(128), default="methodologist")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AgentRequest(Base):
    """История запросов от Координатора бэклога.

    Нужна не для отчётности, а для требования повторяемости: одинаковые данные
    обязаны давать одинаковую цифру. Перед любым обращением к модели считается
    ключ по нормализованным атрибутам и ищется здесь; нашёлся — прежний ответ
    возвращается целиком, модель не вызывается.

    В ключ входят версии справочников и версия слепка: смена весов методологом
    обязана давать новый расчёт, а не выдачу прежнего из истории. Иначе правка
    справочника молча не применялась бы, и объяснить расхождение было бы нечем.
    """

    __tablename__ = "agent_request"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    request_type: Mapped[str] = mapped_column(String(16), index=True)
    task_key: Mapped[str] = mapped_column(String(64), index=True)

    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    response: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Решения модели, которые обязаны совпадать при повторе: метод расчёта и
    # набор драйверов. Хранятся отдельно от ответа, чтобы их можно было
    # переиспользовать при близком, но не точном совпадении атрибутов.
    method: Mapped[str | None] = mapped_column(String(32))
    drivers: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    snapshot_version: Mapped[str | None] = mapped_column(String(32))
    reference_versions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        Index("ix_agent_request_lookup", "request_type", "cache_key"),
    )
