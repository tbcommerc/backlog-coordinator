"""
DMB Backlog - Configuration
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Optional


PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SECRET_KEY = "your-secret-key-change-in-production-dmb2026"
DEFAULT_AGENT_SECRET = "dmb-agent-local-secret-2026"


class Settings(BaseSettings):
    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent
    LOGS_DIR: Path = BASE_DIR / "logs"
    
    # Application
    APP_NAME: str = "DMB Backlog"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    RUN_STARTUP_SEED: Optional[bool] = False
    RUN_STARTUP_MAINTENANCE: Optional[bool] = False
    RUN_NOTIFICATION_SCHEDULER: Optional[bool] = None
    
    # Database
    DATABASE_URL: str = "postgresql+psycopg://dmb:dmb_local_dev@127.0.0.1:5432/dmb_backlog"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SECONDS: int = 30
    REDIS_URL: Optional[str] = None
    EVENT_STREAM_NAME: str = "dmb:events"
    EVENT_STREAM_MAXLEN: int = 10000
    OUTBOX_BATCH_SIZE: int = 100
    OUTBOX_POLL_INTERVAL_SECONDS: float = 1.0
    OUTBOX_RETRY_INTERVAL_SECONDS: float = 5.0
    OUTBOX_CLAIM_TIMEOUT_SECONDS: int = 60
    OUTBOX_RETENTION_DAYS: int = 7
    OUTBOX_MAX_ATTEMPTS: int = 10
    OUTBOX_DEAD_LETTER_RETENTION_DAYS: int = 30
    IDEMPOTENCY_RETENTION_DAYS: int = 7

    # OpenTelemetry traces (OTLP/HTTP). Disabled locally by default.
    OTEL_ENABLED: bool = False
    OTEL_SERVICE_NAME: str = "dmb-backlog"
    OTEL_DEPLOYMENT_ENVIRONMENT: str = "local"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: Optional[str] = None
    OTEL_TRACE_SAMPLE_RATIO: float = 1.0
    OTEL_EXPORT_TIMEOUT_SECONDS: float = 10.0
    OTEL_EXCLUDED_URLS: str = "/api/v1/health,/api/v1/health/ready,/metrics"

    # Shared attachment storage. In production this must be a mounted shared
    # volume (or a path backed by network/object-storage gateway) visible to
    # every backend instance.
    ATTACHMENT_STORAGE_DIR: Path = BASE_DIR / "uploads"
    
    # Security
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS
    CORS_ORIGINS: list = ["http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8080"]

    # AI Business Analyst Assistant (agent service)
    AGENT_BASE_URL: str = "http://127.0.0.1:9000"
    AGENT_SECRET: str = DEFAULT_AGENT_SECRET
    AGENT_TIMEOUT_SECONDS: float = 180.0

    # Task prioritisation and financial effect agent
    PRIORITISER_BASE_URL: str = "http://127.0.0.1:9100"
    PRIORITISER_TIMEOUT_SECONDS: float = 180.0
    
    class Config:
        # Единый env-файл проекта, независимо от каталога запуска uvicorn/pytest.
        env_file = str(PROJECT_DIR / ".env")
        case_sensitive = True


settings = Settings()


def validate_runtime_settings() -> None:
    """Запретить production-запуск с отсутствующими или известными секретами."""
    if settings.DEBUG:
        return

    errors = []
    if not settings.SECRET_KEY or settings.SECRET_KEY == DEFAULT_SECRET_KEY:
        errors.append("SECRET_KEY must be set to a non-default value")
    elif len(settings.SECRET_KEY) < 32:
        errors.append("SECRET_KEY must contain at least 32 characters")

    if not settings.AGENT_SECRET or settings.AGENT_SECRET == DEFAULT_AGENT_SECRET:
        errors.append("AGENT_SECRET must be set to a non-default value")
    if not settings.REDIS_URL:
        errors.append("REDIS_URL must be configured for production rate limiting")
    if settings.DATABASE_URL.lower().startswith("sqlite"):
        errors.append("DATABASE_URL must use PostgreSQL in production")
    if settings.RUN_STARTUP_SEED:
        errors.append("RUN_STARTUP_SEED must be disabled in production")
    if settings.RUN_STARTUP_MAINTENANCE:
        errors.append("RUN_STARTUP_MAINTENANCE must be disabled in production")
    if settings.OUTBOX_MAX_ATTEMPTS < 1:
        errors.append("OUTBOX_MAX_ATTEMPTS must be at least 1")
    if settings.OUTBOX_DEAD_LETTER_RETENTION_DAYS < settings.OUTBOX_RETENTION_DAYS:
        errors.append("OUTBOX_DEAD_LETTER_RETENTION_DAYS must not be shorter than OUTBOX_RETENTION_DAYS")
    if settings.OTEL_ENABLED and not settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
        errors.append("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be configured when OTEL_ENABLED=true")
    if not 0 <= settings.OTEL_TRACE_SAMPLE_RATIO <= 1:
        errors.append("OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1")
    local_upload_dir = (settings.BASE_DIR / "uploads").resolve()
    if settings.ATTACHMENT_STORAGE_DIR.resolve() == local_upload_dir:
        errors.append("ATTACHMENT_STORAGE_DIR must point to shared storage in production")

    if errors:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(errors))


def should_run_startup_seed() -> bool:
    """Seed включён явно либо наследует dev-режим."""
    return settings.RUN_STARTUP_SEED if settings.RUN_STARTUP_SEED is not None else settings.DEBUG


def should_run_startup_maintenance() -> bool:
    """Массовое обслуживание включено явно либо наследует dev-режим."""
    return settings.RUN_STARTUP_MAINTENANCE if settings.RUN_STARTUP_MAINTENANCE is not None else settings.DEBUG


def should_run_notification_scheduler() -> bool:
    """Встроенный scheduler разрешён явно либо только в dev-режиме."""
    return settings.RUN_NOTIFICATION_SCHEDULER if settings.RUN_NOTIFICATION_SCHEDULER is not None else settings.DEBUG

# Create logs directory
settings.LOGS_DIR.mkdir(exist_ok=True)
