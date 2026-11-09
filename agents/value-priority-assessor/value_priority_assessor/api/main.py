"""FastAPI-приложение приоритизатора.

Эндпоинты делятся на три группы:

* бэклог — чтение и правка задач, пересчёт (И1);
* админ — справочники и ex-post атрибуция, доступ методолога (US-4, US-6);
* служебные — RAG и здоровье сервиса.

Внутренний API защищён отдельным service secret Координатора, а операции
методолога — независимым capability secret. В банковском контуре эти
зависимости заменяются корпоративной identity (AD/OIDC) без изменения handlers.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Security, Header
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.security import APIKeyHeader
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from value_priority_assessor.api.schemas import (
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
from value_priority_assessor.api.contract import (
    AgentResponse,
    CoordinatorPriorityOut,
    CoordinatorValueOut,
    ErrorResponse,
    PriorityRequest,
    ValueRequest,
    to_coordinator,
    to_coordinator_priority,
)
from value_priority_assessor.config import get_settings
from value_priority_assessor.service_auth import verify_secret
from value_priority_assessor.core.attribution import AttributionError, run_attribution
from value_priority_assessor.core.db import get_engine, get_session_factory, init_db
from value_priority_assessor.core.models import PriorityHistory, Reference, Task
from value_priority_assessor.core.references import (
    REFERENCE_NAMES,
    ReferenceError,
    get_reference,
    save_reference,
)
from value_priority_assessor.core.scoring import PRIORITY_ORDER
from value_priority_assessor.core.service import (
    REASON_MANUAL,
    REASON_REFERENCES,
    recompute_all,
    recompute_task,
)
from value_priority_assessor.rag.search import reset_index, search_corpus
from value_priority_assessor.service import handle_request
from value_priority_assessor.snapshot import get_snapshot

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


service_secret_header = APIKeyHeader(
    name="X-Prioritiser-Secret",
    scheme_name="PrioritiserServiceSecret",
    auto_error=False,
)
methodologist_secret_header = APIKeyHeader(
    name="X-Methodologist-Secret",
    scheme_name="PrioritiserMethodologistSecret",
    auto_error=False,
)


def _verify_secret(provided: str | None, expected: str, capability: str) -> str:
    return verify_secret(provided, expected, capability, debug=get_settings().debug)


def require_service(
    secret: Annotated[str | None, Security(service_secret_header)],
) -> str:
    return _verify_secret(secret, get_settings().service_secret, "coordinator")


def require_methodologist(
    secret: Annotated[str | None, Security(methodologist_secret_header)],
) -> str:
    return _verify_secret(secret, get_settings().methodologist_secret, "methodologist")


Methodologist = Annotated[str, Depends(require_methodologist)]
ServiceCaller = Annotated[str, Depends(require_service)]


def _startup() -> None:
    get_settings().validate_service_runtime()
    if not get_settings().unit_test_mode:
        from dmb_agent_contracts.limiter import require_runtime_limiter
        require_runtime_limiter()
    init_db()
    if not get_settings().unit_test_mode:
        from dmb_agent_contracts.run_migration import validate as validate_run_schema
        from value_priority_assessor.core.models import Base
        validate_run_schema(get_engine(), allowed_existing=set(Base.metadata.tables) | {"alembic_version", "agent_runtime_bindings", "agent_runtime_migrations"})
        if get_settings().execution_backend == "opencode":
            from dmb_agent_contracts.runtime_records import validate as validate_runtime_bindings
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            validate_runtime_bindings(get_engine())
            RemoteProfile.from_settings(get_settings()).preflight()
    settings = get_settings()
    if settings.rag_vector or settings.value_analogy:
        from value_priority_assessor.rag.embeddings import start_encoder_warmup

        start_encoder_warmup(settings.rag_embedding_model)
    if (
        settings.value_analogy
        or (
            settings.strategy_use_rag
            and (
                settings.strategy_provider == "agent"
                or settings.dependency_provider == "agent"
            )
        )
    ):
        from value_priority_assessor.service.warmup import start_runtime_warmup

        start_runtime_warmup()


def _shutdown() -> None:
    from value_priority_assessor.llm.openai_compat import close_http_client
    from value_priority_assessor.service.scenarios import close_assessment_executor

    close_http_client()
    close_assessment_executor()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _startup()
    from value_priority_assessor.runs import worker
    if not get_settings().unit_test_mode:
        worker.start()
    try:
        yield
    finally:
        worker.stop()
        _shutdown()


app = FastAPI(
    title="Агент-приоритизатор инициатив трайба",
    version="0.1.0",
    description=(
        "Вычисляет приоритет P1–P5 и Value для задач Единого бэклога "
        "по единой методике (ТЗ v2.0)."
    ),
    lifespan=lifespan,
)


from value_priority_assessor.runs import api as run_api
from dmb_agent_contracts.run_api import install_error_handlers
from dmb_agent_contracts.body_limit import BodyLimit
app.include_router(run_api)
install_error_handlers(app)
app.add_middleware(BodyLimit)


def _get_task(session: Session, task_key: str) -> Task:
    task = session.scalar(select(Task).where(Task.task_key == task_key))
    if task is None:
        raise HTTPException(status_code=404, detail=f"задача {task_key} не найдена")
    return task


# --- бэклог ------------------------------------------------------------------


@app.get("/health/live")
@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True}


@app.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def metrics(_: ServiceCaller) -> str:
    from value_priority_assessor.service.metrics import render_prometheus

    return render_prometheus()


@app.get("/health/ready")
@app.get("/ready")
def ready() -> JSONResponse:
    """Check persistence, provider configuration and local RAG artifacts."""
    settings = get_settings()
    checks: dict[str, str] = {}
    is_ready = True
    try:
        settings.validate_service_runtime()
        checks["profile"] = "ok"
    except Exception:
        is_ready = False
        checks["profile"] = "configuration_invalid"
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT id FROM agent_runs LIMIT 1"))
            connection.execute(text("SELECT run_id FROM agent_run_events LIMIT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        is_ready = False
        checks["database"] = f"error:{type(exc).__name__}"

    provider = settings.llm_provider.strip().lower()
    if provider == "mock" and not settings.debug:
        is_ready = False
        checks["llm"] = "mock_forbidden"
    elif provider == "openai_compat" and not settings.openai_api_key:
        is_ready = False
        checks["llm"] = "credentials_missing"
    elif provider == "anthropic" and not settings.anthropic_api_key:
        is_ready = False
        checks["llm"] = "credentials_missing"
    elif provider == "gigachat" and not settings.gigachat_credentials:
        is_ready = False
        checks["llm"] = "credentials_missing"
    elif provider == "gigacode" and not settings.gigacode_base_url:
        is_ready = False
        checks["llm"] = "endpoint_missing"
    elif provider not in {"mock", "openai_compat", "anthropic", "gigachat", "gigacode"}:
        is_ready = False
        checks["llm"] = "provider_unsupported"
    else:
        checks["llm"] = "configured"

    if settings.strategy_provider == "rest" and not settings.strategy_decomposer_url:
        is_ready = False
        checks["strategy_provider"] = "endpoint_missing"
    else:
        checks["strategy_provider"] = "configured"

    if settings.rag_vector or settings.value_analogy:
        from value_priority_assessor.rag.embeddings import get_encoder_status, start_encoder_warmup

        start_encoder_warmup(settings.rag_embedding_model)
        embedding_status = get_encoder_status(settings.rag_embedding_model)
        checks["embedding_model"] = embedding_status
        if embedding_status != "ok":
            is_ready = False
    else:
        checks["embedding_model"] = "disabled"

    if (
        settings.value_analogy
        or (
            settings.strategy_use_rag
            and (
                settings.strategy_provider == "agent"
                or settings.dependency_provider == "agent"
            )
        )
    ):
        from value_priority_assessor.service.warmup import get_runtime_warmup_status, start_runtime_warmup

        start_runtime_warmup()
        runtime_status = get_runtime_warmup_status()
        checks["runtime_indexes"] = runtime_status
        if runtime_status != "ok":
            is_ready = False
    else:
        checks["runtime_indexes"] = "disabled"

    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "not_ready"},
    )


@app.get("/backlog", response_model=list[TaskOut])
def get_backlog(
    session: DbSession,
    _: ServiceCaller,
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
    _: ServiceCaller,
    limit: int = Query(1000, ge=1, le=5000),
) -> list[Task]:
    """Выгрузка для Стратком и внешней отчётности (US-7): только value_external."""
    query = select(Task).order_by(Task.value_external_mln.desc().nulls_last()).limit(limit)
    return list(session.scalars(query).all())


@app.get("/tasks/{task_key}", response_model=TaskOut)
def get_task(task_key: str, session: DbSession, _: ServiceCaller) -> Task:
    return _get_task(session, task_key)


@app.get("/tasks/{task_key}/history", response_model=list[PriorityHistoryOut])
def get_task_history(
    task_key: str, session: DbSession, _: ServiceCaller
) -> list[PriorityHistory]:
    task = _get_task(session, task_key)
    return sorted(task.history, key=lambda h: h.id)


@app.patch("/tasks/{task_key}", response_model=TaskOut)
def update_task(
    task_key: str, payload: TaskUpdateIn, session: DbSession, _: ServiceCaller
) -> Task:
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
    _: ServiceCaller,
    use_llm: bool = True,
    refresh_strategy: bool = False,
) -> Task:
    task = _get_task(session, task_key)
    recompute_task(
        session, task, use_llm=use_llm, refresh_strategy=refresh_strategy
    )
    return task


@app.post("/recompute-all", response_model=RecomputeOut)
def recompute_everything(
    payload: RecomputeIn, session: DbSession, _: ServiceCaller
) -> RecomputeOut:
    stats = recompute_all(
        session,
        reason=payload.reason,
        use_llm=payload.use_llm,
        refresh_strategy=payload.refresh_strategy,
    )
    reset_index()
    return RecomputeOut(stats=stats.as_dict())


@app.get("/stats")
def get_stats(session: DbSession, _: ServiceCaller) -> dict[str, Any]:
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
def low_confidence_report(
    session: DbSession, _: ServiceCaller, limit: int = 200
) -> list[Task]:
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
    recompute_all(session, reason=REASON_REFERENCES, use_llm=False)
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
            task_keys=payload.task_keys,
            actor=payload.actor,
            only_closed=payload.only_closed,
        )
    except AttributionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- служебные ---------------------------------------------------------------


@app.get("/rag/search", response_model=RagQueryOut)
def rag_search(
    _: ServiceCaller,
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




def _coordinator_request(task, kind, session, caller, actor, key, revision):
    if get_settings().unit_test_mode:
        return handle_request(task, kind, session)
    from value_priority_assessor.compatibility import estimate
    from pydantic import TypeAdapter
    return TypeAdapter(AgentResponse | ErrorResponse).validate_python(
        estimate(task,kind,caller=caller,actor=actor,key=key,revision=revision))


@app.post(
    "/agent/value",
    response_model=CoordinatorValueOut | ErrorResponse,
    summary="Рассчитай Value(internal) по инициативе",
)
def agent_value(request: ValueRequest, session: DbSession, _: ServiceCaller,
    x_agent_caller: str = Header(default=""), x_actor_ref: str = Header(default=""),
    idempotency_key: str = Header(default=""), x_source_revision: int = Header(default=0,ge=0)):
    """Только Value. Приоритет здесь не считается — на него отдельный запрос."""
    response = _coordinator_request(request.task, "value", session, x_agent_caller, x_actor_ref, idempotency_key, x_source_revision)
    if isinstance(response, ErrorResponse) or response.value is None:
        return response
    return to_coordinator(response.value)


@app.post(
    "/agent/value/full",
    response_model=AgentResponse | ErrorResponse,
    summary="То же, но с разбором по методам, драйверами и аудитом",
)
def agent_value_full(request: ValueRequest, session: DbSession, _: ServiceCaller,
    x_agent_caller: str = Header(default=""), x_actor_ref: str = Header(default=""),
    idempotency_key: str = Header(default=""), x_source_revision: int = Header(default=0,ge=0)):
    """Подробный ответ для отладки и для интерфейса методолога."""
    return _coordinator_request(request.task, "value", session, x_agent_caller, x_actor_ref, idempotency_key, x_source_revision)


@app.post(
    "/agent/priority",
    response_model=CoordinatorPriorityOut | ErrorResponse,
    summary="Определи приоритет по инициативе",
)
def agent_priority(request: PriorityRequest, session: DbSession, _: ServiceCaller,
    x_agent_caller: str = Header(default=""), x_actor_ref: str = Header(default=""),
    idempotency_key: str = Header(default=""), x_source_revision: int = Header(default=0,ge=0)):
    response = _coordinator_request(request.task, "priority", session, x_agent_caller, x_actor_ref, idempotency_key, x_source_revision)
    if isinstance(response, ErrorResponse) or response.priority is None:
        return response
    return to_coordinator_priority(response.priority, response.value)


@app.post(
    "/agent/priority/full",
    response_model=AgentResponse | ErrorResponse,
    summary="То же, но с разбором по факторам, овверрайдами и аудитом",
)
def agent_priority_full(request: PriorityRequest, session: DbSession, _: ServiceCaller,
    x_agent_caller: str = Header(default=""), x_actor_ref: str = Header(default=""),
    idempotency_key: str = Header(default=""), x_source_revision: int = Header(default=0,ge=0)):
    """Подробный ответ для отладки и для интерфейса методолога."""
    return _coordinator_request(request.task, "priority", session, x_agent_caller, x_actor_ref, idempotency_key, x_source_revision)


@app.get("/agent/snapshot", summary="Версия зашитого слепка исторических Value")
def agent_snapshot(_: ServiceCaller) -> dict[str, Any]:
    return get_snapshot().describe()


# The tool token is deliberately independent from coordinator/admin credentials.
from value_priority_assessor.remote_tools import create_router as create_tool_router
app.include_router(create_tool_router(get_db, require_service))
