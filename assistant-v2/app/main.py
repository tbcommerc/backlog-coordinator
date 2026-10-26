from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.orm.exc import StaleDataError

from app.api.errors import DomainError, domain_error_handler, stale_data_error_handler, validation_error_handler
from app.api.public import router as public_router
from app.config import ROOT_DIR, get_settings
from app.database import get_engine
from app.integrations.telemetry import monotonic, observe_http, render_prometheus


EXPECTED_MIGRATION_HEAD = "20260918_0001"


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().validate_runtime()
    yield


app = FastAPI(
    title="DMB AI Assistant V2",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_exception_handler(DomainError, domain_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(StaleDataError, stale_data_error_handler)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    started_at = monotonic()
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.trace_id = request.headers.get("X-Trace-ID") or request.state.request_id
    response = await call_next(request)
    route = request.scope.get("route")
    route_template = getattr(route, "path", "unmatched")
    observe_http(
        method=request.method,
        operation=route_template,
        status=response.status_code,
        elapsed_seconds=monotonic() - started_at,
    )
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Trace-ID"] = request.state.trace_id
    return response


@app.get("/health")
def health():
    return {"status": "ok", "service": get_settings().OTEL_SERVICE_NAME, "enabled": get_settings().ENABLED}


@app.get("/metrics", include_in_schema=False)
def metrics():
    return PlainTextResponse(render_prometheus(), media_type="text/plain; version=0.0.4")


@app.get("/ready")
def ready():
    settings = get_settings()
    if not settings.ENABLED:
        return JSONResponse(status_code=503, content={"status": "disabled", "checks": {"kill_switch": "disabled"}})
    checks: dict[str, str] = {"provider": "configured" if settings.PROVIDER_ENABLED else "manual_safe_mode"}
    ok = True
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
            checks["database"] = "ok"
            try:
                current = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            except Exception:
                current = None
            checks["migration"] = "ok" if current == EXPECTED_MIGRATION_HEAD else f"expected:{EXPECTED_MIGRATION_HEAD};current:{current or 'none'}"
            ok = ok and current == EXPECTED_MIGRATION_HEAD
    except Exception as exc:
        checks["database"] = f"error:{type(exc).__name__}"
        checks["migration"] = "unknown"
        ok = False
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "not_ready", "checks": checks})


app.include_router(public_router)
