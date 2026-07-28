"""
DMB Backlog - FastAPI Application Entry Point
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from contextlib import asynccontextmanager
import asyncio
import os
import stat
import time
from collections import defaultdict

from config import settings
from database import init_db
from middleware import LoggingMiddleware, AuditMiddleware
from routers import auth_router, tasks_router, teams_router, users_router, reports_router
from routers import admin_router, customer_router
from routers import express_router
from routers import notifications_router


async def _notification_scheduler():
    while True:
        try:
            from database import SessionLocal
            from notifications import check_scheduled_notifications
            db = SessionLocal()
            check_scheduled_notifications(db)
            db.close()
        except Exception as e:
            print(f"[scheduler] notification check failed: {e}")
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown events"""
    init_db()
    from seed import seed_dict_always, seed_initial_data, seed_team_resources, migrate_team_fk_ids
    seed_dict_always()
    seed_initial_data()
    seed_team_resources()
    migrate_team_fk_ids()

    # Startup verification: log user count for safety
    try:
        from database import SessionLocal
        from models import User
        db = SessionLocal()
        user_count = db.query(User).count()
        db.close()
        print(f"[startup] Users in DB: {user_count}")
        if user_count == 0:
            print("[startup] WARNING: No users found — DB may have been reset!")
    except Exception as e:
        print(f"[startup] DB verification failed: {e}")

    # Start notification scheduler
    scheduler_task = asyncio.create_task(_notification_scheduler())
    print("[startup] Notification scheduler started (hourly)")

    yield

    scheduler_task.cancel()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)


# Rate limiter
rate_limit_store = defaultdict(list)

def check_rate_limit(ip: str, route: str, max_requests: int, window: int) -> bool:
    key = f"{ip}:{route}"
    now = time.time()
    requests = rate_limit_store[key]
    cutoff = now - window
    requests[:] = [t for t in requests if t > cutoff]
    if len(requests) >= max_requests:
        return False
    requests.append(now)
    return True


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    ip = request.client.host if request.client else "unknown"
    
    if path.startswith("/api/v1/auth/login"):
        if not check_rate_limit(ip, "login", 5, 60):
            return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})
    elif path.startswith("/api/v1/auth/refresh"):
        if not check_rate_limit(ip, "refresh", 10, 60):
            return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})
    
    return await call_next(request)


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
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(tasks_router, prefix="/api/v1/tasks", tags=["Tasks"])
app.include_router(teams_router, prefix="/api/v1/teams", tags=["Teams"])
app.include_router(users_router, prefix="/api/v1/users", tags=["Users"])
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"])
app.include_router(admin_router.router, prefix="/api/v1/admin")
app.include_router(customer_router, prefix="/api/v1/customer", tags=["Customer Portal"])
app.include_router(express_router, prefix="/api/v1", tags=["Express Estimate"])
app.include_router(notifications_router.router, prefix="/api/v1", tags=["Notifications"])


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

# Serve uploaded files
uploads_path = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_path, exist_ok=True)
app.mount("/uploads", NoCacheStaticFiles(directory=uploads_path), name="uploads")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)