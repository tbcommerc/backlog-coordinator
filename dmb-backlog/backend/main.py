"""
DMB Backlog - FastAPI Application Entry Point
"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from contextlib import asynccontextmanager
import asyncio
import logging
import mimetypes
from contextlib import suppress
import os
import stat
import json
import urllib.request
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

from config import (
    settings,
    validate_runtime_settings,
    should_run_startup_seed,
    should_run_startup_maintenance,
    should_run_notification_scheduler,
)
from database import engine, init_db
from middleware import LoggingMiddleware, AuditMiddleware
from routers import auth_router, tasks_router, teams_router, users_router, reports_router
from routers.task_collaboration_router import router as task_collaboration_router
from routers.task_analytics_router import router as task_analytics_router
from routers import admin_router, customer_router
from routers import express_router
from routers import notifications_router
from routers import timeline_router
from routers import agent_router
from routers.meeting_capture_router import router as meeting_capture_router
from routers.work_reporting_router import router as work_reporting_router
from routers.work_tasks_router import router as work_tasks_router
from routers.projects_router import router as projects_router
from routers.work_files_router import router as work_files_router
from routers.metrics_router import router as metrics_router
from routers.metrics_quarterly_router import router as metrics_quarterly_router
from routers.work_resolution_router import router as work_resolution_router
from routers.work_relations_router import router as work_relations_router
from routers import prioritiser_router
from routers.events_router import router as events_router
from routers.reporting_meetings_router import (
    router as reporting_meetings_router,
    task_router as task_reporting_router,
)
from auth import get_current_user, require_non_business_customer_access


logger = logging.getLogger("dmb_backlog.startup")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/ttf", ".ttf")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown events"""
    # Fail before schema/seed operations when production secrets are unsafe.
    validate_runtime_settings()
    init_db()
    if should_run_startup_seed():
        from seed import seed_dict_always, seed_initial_data, seed_team_resources, migrate_team_fk_ids, seed_field_labels
        seed_dict_always()
        seed_field_labels()
        seed_initial_data()
        seed_team_resources()
        migrate_team_fk_ids()
        logger.info("Startup seed enabled")
    else:
        logger.info("Startup seed disabled")

    if should_run_startup_maintenance():
        # Recalculate computed task fields (idempotent)
        try:
            from database import SessionLocal
            from routers.tasks_router import recalculate_actual_effort_days_for_all
            db = SessionLocal()
            try:
                n = recalculate_actual_effort_days_for_all(db)
                if n:
                    logger.info("Recalculated actual_effort_days for %s tasks", n)
            finally:
                db.close()
        except Exception:
            logger.exception("Startup actual_effort_days recalculation failed")
        logger.info("Startup maintenance enabled")
    else:
        logger.info("Startup maintenance disabled")

    # Standard reports are product configuration, not optional data maintenance.
    # Keep the registry available on every normal start, including production
    # where RUN_STARTUP_MAINTENANCE must remain disabled.
    try:
        from database import SessionLocal
        from routers.reports_router import ensure_standard_reports
        db = SessionLocal()
        try:
            ensure_standard_reports(db)
        finally:
            db.close()
        logger.info("Standard reports registry synchronized")
    except Exception:
        logger.exception("Startup standard reports sync failed")

    # Startup verification: log user count for safety
    try:
        from database import SessionLocal
        from models import User
        db = SessionLocal()
        try:
            user_count = db.query(User).count()
        finally:
            db.close()
        logger.info("Users in database: %s", user_count)
        if user_count == 0:
            logger.warning("No users found; database may have been reset")
    except Exception:
        logger.exception("Startup database verification failed")

    scheduler_task = None
    outbox_task = None
    if settings.REDIS_URL:
        from event_outbox import event_outbox_dispatcher_loop
        outbox_task = asyncio.create_task(event_outbox_dispatcher_loop())
        logger.info("Transactional outbox dispatcher started")
    else:
        logger.warning("Transactional outbox dispatcher disabled: REDIS_URL is not configured")

    if should_run_notification_scheduler():
        from notification_scheduler import notification_scheduler_loop
        scheduler_task = asyncio.create_task(notification_scheduler_loop())
        logger.info("Notification scheduler started (hourly)")
    else:
        logger.info("Notification scheduler disabled; run a separate worker if required")

    from services.meeting_analysis import MeetingAnalysisWorker
    from routers.agent_router import _call_agent
    from database import SessionLocal
    meeting_worker = MeetingAnalysisWorker(SessionLocal, _call_agent)
    if settings.MEETING_ANALYSIS_WORKER_ENABLED:
        meeting_worker.start()
    try:
        yield
    finally:
        if settings.MEETING_ANALYSIS_WORKER_ENABLED:
            meeting_worker.stop()

    if scheduler_task is not None:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task
    if outbox_task is not None:
        outbox_task.cancel()
        with suppress(asyncio.CancelledError):
            await outbox_task


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware
from account_middleware import AccountSecurityMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

@app.exception_handler(RequestValidationError)
async def private_validation_error(request, exc):
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(error["loc"]), "type": error["type"], "msg": "Недопустимое значение"}
        for error in exc.errors()]})

@app.exception_handler(SQLAlchemyError)
async def database_unavailable(request, exc):
    return JSONResponse(status_code=503, content={"detail": "DATABASE_UNAVAILABLE"})

app.add_middleware(AccountSecurityMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.AUTH_ALLOWED_HOSTS)
app.add_middleware(LoggingMiddleware)
app.add_middleware(AuditMiddleware)

from telemetry import configure_telemetry
configure_telemetry(app, engine=engine, settings=settings)

# Routers
non_customer_dependencies = [Depends(require_non_business_customer_access)]
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
from routers.backlog_assistant_gateway_router import router as backlog_assistant_gateway_router
app.include_router(backlog_assistant_gateway_router, prefix="/api/v1/backlog-assistant", tags=["Backlog Assistant"])
# Static analytics paths must be registered before ``/{task_id}``, otherwise
# FastAPI treats ``analytics`` as a task id and returns a validation error.
app.include_router(task_analytics_router, prefix="/api/v1/tasks", tags=["Task analytics"], dependencies=non_customer_dependencies)
app.include_router(tasks_router, prefix="/api/v1/tasks", tags=["Tasks"], dependencies=non_customer_dependencies)
app.include_router(task_collaboration_router, prefix="/api/v1/tasks", tags=["Task collaboration"], dependencies=non_customer_dependencies)
app.include_router(teams_router, prefix="/api/v1/teams", tags=["Teams"], dependencies=non_customer_dependencies)
app.include_router(users_router, prefix="/api/v1/users", tags=["Users"], dependencies=non_customer_dependencies)
from routers.did_backlog_router import router as did_backlog_router
app.include_router(did_backlog_router, prefix="/api/v1/reports/did-backlog", tags=["DID backlog"], dependencies=non_customer_dependencies)
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"], dependencies=non_customer_dependencies)
app.include_router(reporting_meetings_router, prefix="/api/v1/reporting-meetings", tags=["Reporting meetings"], dependencies=non_customer_dependencies)
app.include_router(task_reporting_router, prefix="/api/v1/tasks", tags=["Task reporting statuses"], dependencies=non_customer_dependencies)
from routers.customer_references_router import router as customer_references_router
app.include_router(customer_references_router, prefix="/api/v1/admin/customer-references", tags=["Customer references"], dependencies=non_customer_dependencies)
app.include_router(admin_router.router, prefix="/api/v1/admin", dependencies=non_customer_dependencies)
app.include_router(customer_router, prefix="/api/v1/customer", tags=["Customer Portal"])
app.include_router(express_router, prefix="/api/v1", tags=["Express Estimate"], dependencies=non_customer_dependencies)
# Recipient-owned inbox; every operation remains authenticated and owner-scoped.
app.include_router(notifications_router.router, prefix="/api/v1", tags=["Notifications"], dependencies=[Depends(get_current_user)])
app.include_router(events_router, prefix="/api/v1", tags=["Events"])
app.include_router(timeline_router, prefix="/api/v1/timeline", tags=["Timeline"], dependencies=non_customer_dependencies)
app.include_router(agent_router.router, prefix="/api/v1", tags=["AI Assistant"])
app.include_router(meeting_capture_router, prefix="/api/v1/meeting-capture", tags=["Meeting capture"])
app.include_router(work_reporting_router, prefix="/api/v1", tags=["Work reporting"])
app.include_router(work_tasks_router, prefix="/api/v1", tags=["Work tasks"])
app.include_router(projects_router, prefix="/api/v1", tags=["Projects"])
app.include_router(metrics_router, prefix="/api/v1", tags=["Metrics"])
app.include_router(metrics_quarterly_router, prefix="/api/v2", tags=["Quarterly metrics"])
app.include_router(work_files_router, prefix="/api/v1", tags=["Work files"])
app.include_router(work_resolution_router, prefix="/api/v1", tags=["Work resolution"])
app.include_router(work_relations_router, prefix="/api/v1", tags=["Work relations"])
app.include_router(prioritiser_router.router, prefix="/api/v1/tasks", tags=["Task prioritiser"], dependencies=non_customer_dependencies)

# Experimental BA V2 gateway is absent while disabled.
if settings.AGENT_V2_ENABLED and not settings.AGENT_V2_KILL_SWITCH:
    from routers.agent_v2_router import router as agent_v2_router
    from routers.requirement_reviews_router import router as requirement_reviews_router
    from services.agent_v2_gateway import (
        operator_role as agent_v2_operator_role,
        pilot_allowed as agent_v2_pilot_allowed,
    )

    app.include_router(agent_v2_router, prefix="/api/v2/agent", tags=["AI Assistant V2 fork"])
    app.include_router(requirement_reviews_router, prefix="/api", dependencies=non_customer_dependencies)
else:
    agent_v2_pilot_allowed = lambda _user: False
    agent_v2_operator_role = lambda _user: ""


# Health check
@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/api/v1/features")
def feature_bootstrap(current_user=Depends(get_current_user)):
    """Small shell bootstrap; does not import or contact V2 while disabled."""
    return {
        "agent_v2": {
            "enabled": settings.AGENT_V2_ENABLED and not settings.AGENT_V2_KILL_SWITCH,
            "pilot_allowed": bool(agent_v2_pilot_allowed(current_user)),
            "operator_role": agent_v2_operator_role(current_user),
        },
    }


@app.get("/metrics", include_in_schema=False)
def prometheus_metrics():
    """Prometheus text exposition; intended for an internal scrape endpoint."""
    from metrics import render_prometheus
    return Response(content=render_prometheus(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/api/v1/health/ready")
async def readiness_check():
    """Read-only readiness checks for a multi-worker deployment."""
    checks = {}
    ready = True
    try:
        from database import SessionLocal
        from models import EventOutbox
        from sqlalchemy import func
        db = SessionLocal()
        try:
            pending_filter = (
                EventOutbox.processed_at.is_(None),
                EventOutbox.dead_lettered_at.is_(None),
            )
            pending = db.query(EventOutbox).filter(*pending_filter).count()
            oldest_pending_at = db.query(func.min(EventOutbox.created_at)).filter(
                *pending_filter
            ).scalar()
            dead_lettered = db.query(EventOutbox).filter(
                EventOutbox.dead_lettered_at.is_not(None)
            ).count()
        finally:
            db.close()
        checks["database"] = "ok"
        checks["outbox_pending"] = pending
        checks["outbox_dead_lettered"] = dead_lettered
        if oldest_pending_at is None:
            checks["outbox_oldest_seconds"] = 0
        else:
            now = datetime.now(timezone.utc) if oldest_pending_at.tzinfo else datetime.utcnow()
            checks["outbox_oldest_seconds"] = max(0, int((now - oldest_pending_at).total_seconds()))
    except Exception as exc:
        ready = False
        checks["database"] = f"error:{type(exc).__name__}"

    if settings.REDIS_URL:
        try:
            from redis.asyncio import Redis
            redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
            try:
                await redis_client.ping()
            finally:
                await redis_client.aclose()
            checks["redis"] = "ok"
        except Exception as exc:
            ready = False
            checks["redis"] = f"error:{type(exc).__name__}"
    else:
        checks["redis"] = "disabled"
        if not settings.DEBUG:
            ready = False

    storage = settings.ATTACHMENT_STORAGE_DIR
    storage_ready = storage.exists() and storage.is_dir() and os.access(storage, os.W_OK)
    checks["attachment_storage"] = "ok" if storage_ready else "unavailable"
    if not storage_ready:
        ready = False

    async def probe(name: str, url: str) -> None:
        nonlocal ready
        try:
            def request() -> None:
                with urllib.request.urlopen(url, timeout=3) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    if payload.get("status") not in {"ready", "ok"}:
                        raise ValueError("dependency is not ready")
            await asyncio.to_thread(request)
            checks[name] = "ok"
        except Exception as exc:
            ready = False
            checks[name] = f"error:{type(exc).__name__}"

    dependency_probes = [
        probe("agent", f"{settings.AGENT_BASE_URL.rstrip('/')}/api/agent/ready"),
    ]
    if settings.PRIORITISER_ENABLED:
        dependency_probes.append(
            probe("prioritiser", f"{settings.PRIORITISER_BASE_URL.rstrip('/')}/ready")
        )
    else:
        checks["prioritiser"] = "disabled"
    await asyncio.gather(*dependency_probes)

    # Experimental V2 remains a non-blocking dependency.
    if settings.AGENT_V2_ENABLED and not settings.AGENT_V2_KILL_SWITCH:
        try:
            def request_agent_v2() -> None:
                with urllib.request.urlopen(
                    f"{settings.AGENT_V2_BASE_URL.rstrip('/')}/api/agent-v2/ready",
                    timeout=3,
                ) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    if payload.get("status") != "ready":
                        raise ValueError("dependency is not ready")
            await asyncio.to_thread(request_agent_v2)
            checks["agent_v2"] = "ok"
        except Exception as exc:
            checks["agent_v2"] = f"non_blocking_error:{type(exc).__name__}"
    else:
        checks["agent_v2"] = "disabled"

    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


# Disable caching for static files during development
class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

# Serve frontend (in production you'd use nginx, but for local dev this works)
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", NoCacheStaticFiles(directory=frontend_path), name="static")
    
    @app.get("/")
    async def serve_frontend():
        return FileResponse(
            os.path.join(frontend_path, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )

if __name__ == "__main__":
    import uvicorn
    # The unified local launcher owns process restarts and keeps logs in .runtime.
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
