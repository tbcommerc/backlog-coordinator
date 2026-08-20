"""
DMB Backlog - FastAPI Application Entry Point
"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from contextlib import asynccontextmanager
import asyncio
import logging
import mimetypes
from contextlib import suppress
import os
import stat

from config import (
    settings,
    validate_runtime_settings,
    should_run_startup_seed,
    should_run_startup_maintenance,
    should_run_notification_scheduler,
)
from database import init_db
from middleware import LoggingMiddleware, AuditMiddleware
from routers import auth_router, tasks_router, teams_router, users_router, reports_router
from routers.task_collaboration_router import router as task_collaboration_router
from routers.task_analytics_router import router as task_analytics_router
from routers import admin_router, customer_router
from routers import express_router
from routers import notifications_router
from routers import timeline_router
from routers import agent_router
from auth import require_non_business_customer_access


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

        # Sync standard reports registry with DB (idempotent, additive)
        try:
            from database import SessionLocal
            from routers.reports_router import ensure_standard_reports
            db = SessionLocal()
            try:
                ensure_standard_reports(db)
            finally:
                db.close()
        except Exception:
            logger.exception("Startup standard reports sync failed")
        logger.info("Startup maintenance enabled")
    else:
        logger.info("Startup maintenance disabled")

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
    if should_run_notification_scheduler():
        from notification_scheduler import notification_scheduler_loop
        scheduler_task = asyncio.create_task(notification_scheduler_loop())
        logger.info("Notification scheduler started (hourly)")
    else:
        logger.info("Notification scheduler disabled; run a separate worker if required")

    yield

    if scheduler_task is not None:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task


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
app.add_middleware(LoggingMiddleware)
app.add_middleware(AuditMiddleware)

# Routers
non_customer_dependencies = [Depends(require_non_business_customer_access)]
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(tasks_router, prefix="/api/v1/tasks", tags=["Tasks"], dependencies=non_customer_dependencies)
app.include_router(task_collaboration_router, prefix="/api/v1/tasks", tags=["Task collaboration"], dependencies=non_customer_dependencies)
app.include_router(task_analytics_router, prefix="/api/v1/tasks", tags=["Task analytics"], dependencies=non_customer_dependencies)
app.include_router(teams_router, prefix="/api/v1/teams", tags=["Teams"], dependencies=non_customer_dependencies)
app.include_router(users_router, prefix="/api/v1/users", tags=["Users"], dependencies=non_customer_dependencies)
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"], dependencies=non_customer_dependencies)
app.include_router(admin_router.router, prefix="/api/v1/admin", dependencies=non_customer_dependencies)
app.include_router(customer_router, prefix="/api/v1/customer", tags=["Customer Portal"])
app.include_router(express_router, prefix="/api/v1", tags=["Express Estimate"], dependencies=non_customer_dependencies)
app.include_router(notifications_router.router, prefix="/api/v1", tags=["Notifications"], dependencies=non_customer_dependencies)
app.include_router(timeline_router, prefix="/api/v1/timeline", tags=["Timeline"], dependencies=non_customer_dependencies)
app.include_router(agent_router.router, prefix="/api/v1", tags=["AI Assistant"])


# Health check
@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


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
    # Autoreload cannot safely watch this project directory: SQLite creates
    # journal/WAL files during writes and watchfiles restarts the worker in the
    # middle of POST requests. Run the working server without a reloader.
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
