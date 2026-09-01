"""FastAPI-приложение приоритизатора.

Эндпоинты делятся на три группы:

* бэклог — чтение и правка задач, пересчёт (И1);
* админ — справочники и ex-post атрибуция, доступ методолога (US-4, US-6);
* служебные — RAG и здоровье сервиса.

Аутентификация в прототипе не реализована: по ТЗ (И4) это корпоративный
AD/OIDC, подключать который вне контура банка бессмысленно. Точка расширения —
зависимость `require_methodologist`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas import (
    AttributionIn,
    PriorityHistoryOut,
    RagQueryOut,
    RecomputeIn,
    RecomputeOut,
    ReferenceIn,
    ReferenceOut,
    TaskExternalOut,
    TaskOut,
    TaskUpdateIn,
)
from app.api.contract import (
    AgentResponse,
    CoordinatorPriorityOut,
    CoordinatorValueOut,
    ErrorResponse,
    PriorityRequest,
    ValueRequest,
    to_coordinator,
    to_coordinator_priority,
)
from app.config import get_settings
from app.core.attribution import AttributionError, run_attribution
from app.core.db import get_session_factory, init_db
from app.core.models import PriorityHistory, Reference, Task
from app.core.references import (
    REFERENCE_NAMES,
    ReferenceError,
    get_reference,
    save_reference,
)
from app.core.scoring import PRIORITY_ORDER
from app.core.service import (
    REASON_MANUAL,
    REASON_REFERENCES,
    recompute_all,
    recompute_task,
)
from app.rag.search import reset_index, search_corpus
from app.service import handle_request
from app.snapshot import get_snapshot

app = FastAPI(
    title="Агент-приоритизатор инициатив трайба",
    version="0.1.0",
    description=(
        "Вычисляет приоритет P1–P5 и Value для задач Единого бэклога "
        "по единой методике (ТЗ v2.0)."
    ),
)


def get_db() -> Session:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


DbSession = Annotated[Session, Depends(get_db)]


def require_methodologist() -> str:
    """Заглушка авторизации методолога.

    В контуре банка сюда подключается AD/OIDC (И4). Оставлено отдельной
    зависимостью, чтобы админ-эндпоинты закрывались одной правкой.
    """
    return "methodologist"


Methodologist = Annotated[str, Depends(require_methodologist)]


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _get_task(session: Session, task_key: str) -> Task:
    task = session.scalar(select(Task).where(Task.task_key == task_key))
    if task is None:
        raise HTTPException(status_code=404, detail=f"задача {task_key} не найдена")
    return task


# --- бэклог ------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ok": True,
        "llm_provider": settings.llm_provider,
        "strategy_provider": settings.strategy_provider,
    }


@app.get("/backlog", response_model=list[TaskOut])
def get_backlog(
    session: DbSession,
    sort: str = Query("priority", pattern="^(priority|value|cv|key)$"),
    team: str | None = None,
    priority: str | None = Query(None, pattern="^P[1-5]$"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[Task]:
    query = select(Task)
    if team:
        query = query.where(Task.team == team)
    if priority:
        query = query.where(Task.priority == priority)

    if sort == "priority":
        # Вторичная сортировка по сырому скору обязательна: овверрайды сгоняют
        # в P1 много задач, и без неё их порядок был бы произвольным.
        query = query.order_by(Task.priority.asc(), Task.priority_score.desc())
    elif sort == "value":
        query = query.order_by(Task.value_internal_mln.desc().nulls_last())
    elif sort == "cv":
        query = query.order_by(Task.cost_to_value.asc().nulls_last())
    else:
        query = query.order_by(Task.task_key.asc())

    return list(session.scalars(query.offset(offset).limit(limit)).all())


@app.get("/backlog/external", response_model=list[TaskExternalOut])
def get_backlog_external(
    session: DbSession,
    limit: int = Query(1000, ge=1, le=5000),
) -> list[Task]:
    """Выгрузка для Стратком и внешней отчётности (US-7): только value_external."""
    query = select(Task).order_by(Task.value_external_mln.desc().nulls_last()).limit(limit)
    return list(session.scalars(query).all())


@app.get("/tasks/{task_key}", response_model=TaskOut)
def get_task(task_key: str, session: DbSession) -> Task:
    return _get_task(session, task_key)


@app.get("/tasks/{task_key}/history", response_model=list[PriorityHistoryOut])
def get_task_history(task_key: str, session: DbSession) -> list[PriorityHistory]:
    task = _get_task(session, task_key)
    return sorted(task.history, key=lambda h: h.id)


@app.patch("/tasks/{task_key}", response_model=TaskOut)
def update_task(task_key: str, payload: TaskUpdateIn, session: DbSession) -> Task:
    """Правка атрибутов с немедленным пересчётом (Ф25, US-2)."""
    task = _get_task(session, task_key)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    session.flush()
    recompute_task(session, task, reason=REASON_MANUAL)
    return task


@app.post("/tasks/{task_key}/recompute", response_model=TaskOut)
def recompute_one(
    task_key: str,
    session: DbSession,
    use_llm: bool = True,
    refresh_strategy: bool = False,
) -> Task:
    task = _get_task(session, task_key)
    recompute_task(
        session, task, use_llm=use_llm, refresh_strategy=refresh_strategy
    )
    return task


@app.post("/recompute-all", response_model=RecomputeOut)
def recompute_everything(payload: RecomputeIn, session: DbSession) -> RecomputeOut:
    stats = recompute_all(
        session,
        reason=payload.reason,
        use_llm=payload.use_llm,
        refresh_strategy=payload.refresh_strategy,
    )
    reset_index()
    return RecomputeOut(stats=stats.as_dict())


@app.get("/stats")
def get_stats(session: DbSession) -> dict[str, Any]:
    total = session.scalar(select(func.count()).select_from(Task)) or 0
    by_priority = {p: 0 for p in PRIORITY_ORDER}
    for priority, count in session.execute(
        select(Task.priority, func.count()).group_by(Task.priority)
    ):
        if priority:
            by_priority[priority] = count

    by_confidence = {
        (confidence or "—"): count
        for confidence, count in session.execute(
            select(Task.value_confidence, func.count()).group_by(Task.value_confidence)
        )
    }
    by_team = {
        (team or "—"): count
        for team, count in session.execute(
            select(Task.team, func.count()).group_by(Task.team)
        )
    }
    return {
        "total": total,
        "by_priority": by_priority,
        "by_confidence": by_confidence,
        "by_team": by_team,
    }


@app.get("/reports/low-confidence", response_model=list[TaskOut])
def low_confidence_report(session: DbSession, limit: int = 200) -> list[Task]:
    """US-5: где качество оценки Value самое низкое."""
    query = (
        select(Task)
        .where(Task.value_confidence == "low")
        .order_by(Task.value_internal_mln.desc().nulls_last())
        .limit(limit)
    )
    return list(session.scalars(query).all())


# --- админ-панель ------------------------------------------------------------


@app.get("/admin/references/{name}", response_model=ReferenceOut)
def read_reference(name: str, session: DbSession, _: Methodologist) -> ReferenceOut:
    if name not in REFERENCE_NAMES:
        raise HTTPException(status_code=404, detail=f"неизвестный справочник: {name}")
    row = session.scalar(
        select(Reference).where(Reference.name == name, Reference.is_active.is_(True))
    )
    return ReferenceOut(
        name=name,
        version=row.version if row else 0,
        payload=get_reference(session, name),
    )


@app.put("/admin/references/{name}", response_model=ReferenceOut)
def write_reference(
    name: str, payload: ReferenceIn, session: DbSession, _: Methodologist
) -> ReferenceOut:
    """Сохраняет новую версию справочника и пересчитывает бэклог (US-4)."""
    try:
        row = save_reference(session, name, payload.payload, actor=payload.actor)
    except ReferenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session.flush()
    # Изменение справочника — триггер пересчёта (Ф25). Модель при этом не
    # опрашивается: классификация задач от весов и констант не зависит.
    recompute_all(session, reason=REASON_REFERENCES, use_llm=True)
    return ReferenceOut(name=row.name, version=row.version, payload=row.payload)


@app.post("/admin/attribution")
def post_attribution(
    payload: AttributionIn, session: DbSession, _: Methodologist
) -> dict[str, Any]:
    try:
        return run_attribution(
            session,
            period=payload.period,
            front_actual_revenue_mln=payload.front_actual_revenue_mln,
            actor=payload.actor,
            only_closed=payload.only_closed,
        )
    except AttributionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- служебные ---------------------------------------------------------------


@app.get("/rag/search", response_model=RagQueryOut)
def rag_search(
    q: str,
    top_k: int = Query(5, ge=1, le=20),
    layer: str | None = Query(None, pattern="^(knowledge|backlog|methodology)$"),
) -> dict[str, Any]:
    return search_corpus(q, top_k=top_k, layer=layer)


# --- сервис для Координатора бэклога -----------------------------------------
#
# Точка входа обоих сценариев. В отличие от эндпоинтов выше, эти не читают
# бэклог: атрибуты задачи приходят в теле запроса, аналоги и шкала F1 — из
# зашитого слепка. Контракт — docs/COORDINATOR-CONTRACT.md.


@app.post(
    "/agent/value",
    response_model=CoordinatorValueOut | ErrorResponse,
    summary="Рассчитай Value(internal) по инициативе",
)
def agent_value(request: ValueRequest, session: DbSession):
    """Только Value. Приоритет здесь не считается — на него отдельный запрос."""
    response = handle_request(request.task, "value", session)
    if isinstance(response, ErrorResponse) or response.value is None:
        return response
    return to_coordinator(response.value)


@app.post(
    "/agent/value/full",
    response_model=AgentResponse | ErrorResponse,
    summary="То же, но с разбором по методам, драйверами и аудитом",
)
def agent_value_full(request: ValueRequest, session: DbSession):
    """Подробный ответ для отладки и для интерфейса методолога."""
    return handle_request(request.task, "value", session)


@app.post(
    "/agent/priority",
    response_model=CoordinatorPriorityOut | ErrorResponse,
    summary="Определи приоритет по инициативе",
)
def agent_priority(request: PriorityRequest, session: DbSession):
    response = handle_request(request.task, "priority", session)
    if isinstance(response, ErrorResponse) or response.priority is None:
        return response
    return to_coordinator_priority(response.priority, response.value)


@app.post(
    "/agent/priority/full",
    response_model=AgentResponse | ErrorResponse,
    summary="То же, но с разбором по факторам, овверрайдами и аудитом",
)
def agent_priority_full(request: PriorityRequest, session: DbSession):
    """Подробный ответ для отладки и для интерфейса методолога."""
    return handle_request(request.task, "priority", session)


@app.get("/agent/snapshot", summary="Версия зашитого слепка исторических Value")
def agent_snapshot() -> dict[str, Any]:
    return get_snapshot().describe()
