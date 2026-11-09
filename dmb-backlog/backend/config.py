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
DEFAULT_PRIORITISER_SECRET = "dmb-prioritiser-local-secret-2026"
DEFAULT_AGENT_V2_SECRET = "dmb-agent-v2-local-secret-2026"


class Settings(BaseSettings):
    WORK_TASK_BOARD_ENABLED: bool = False
    WORK_TASK_BOARD_ENABLED: bool = False
    BACKLOG_ASSISTANT_ENABLED: bool = False
    BACKLOG_ASSISTANT_KILL_SWITCH: bool = False
    BACKLOG_ASSISTANT_PILOT_USER_IDS: str = ""
    BACKLOG_ASSISTANT_SERVICE_URL: str = "https://127.0.0.1:9400"
    BACKLOG_ASSISTANT_GATEWAY_SECRET: str = ""
    BACKLOG_ASSISTANT_SERVICE_TOKEN: str = ""
    BACKLOG_ASSISTANT_TLS_CA: str = ""
    BACKLOG_ASSISTANT_TLS_CERT: str = ""
    BACKLOG_ASSISTANT_TLS_KEY: str = ""
    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent
    LOGS_DIR: Path = BASE_DIR / "logs"
    
    # Application
    APP_NAME: str = "DMB Backlog"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    RUN_STARTUP_SEED: Optional[bool] = False
    METRICS_QUARTERLY_WRITE_ENABLED: bool = True
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
    CLAMAV_HOST: Optional[str] = None
    CLAMAV_PORT: int = 3310
    CLAMAV_TIMEOUT_SECONDS: float = 30.0
    
    # Security
    SECRET_KEY: str = DEFAULT_SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 5
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    AUTH_ISSUER: str = "dmb-backlog"
    AUTH_AUDIENCE: str = "dmb-browser"
    AUTH_SESSION_HOURS: int = 8
    AUTH_IDLE_MINUTES: int = 30
    AUTH_ADMIN_IDLE_MINUTES: int = 15
    AUTH_MAX_SESSIONS: int = 5
    AUTH_INVITE_MINUTES: int = 1440
    AUTH_RECOVERY_MINUTES: int = 30
    AUTH_REAUTH_MINUTES: int = 5
    AUTH_PASSWORD_MIN: int = 15
    AUTH_PASSWORD_MAX: int = 128
    AUTH_HASH_WORKERS: int = 4
    AUTH_ARGON_MEMORY_KIB: int = 19456
    AUTH_ARGON_TIME_COST: int = 2
    AUTH_ARGON_PARALLELISM: int = 1
    AUTH_LOGIN_IP_LIMIT: int = 120
    AUTH_FAILURE_LIMIT: int = 5
    AUTH_FAILURE_WINDOW: int = 300
    AUTH_SETUP_IP_LIMIT: int = 60
    AUTH_ISSUE_TARGET_LIMIT: int = 5
    AUTH_ISSUE_ADMIN_LIMIT: int = 30
    AUTH_REFRESH_IP_LIMIT: int = 600
    AUTH_EVENTS_RETENTION_DAYS: int = 180
    AUTH_SESSION_RETENTION_DAYS: int = 30
    AUTH_RATE_HMAC_KEY: str = ""
    AUTH_ALLOW_LEGACY_PASSWORDS: bool = False
    AUTH_SUPPORT_CONTACT: str = "Обратитесь к администратору стенда"
    AUTH_ORIGINS: list[str] = ["http://127.0.0.1:8000", "http://localhost:8000"]
    AUTH_ALLOWED_HOSTS: list[str] = ["127.0.0.1", "localhost", "testserver"]

    # CORS
    CORS_ORIGINS: list = ["http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8080"]

    # AI Business Analyst Assistant (agent service)
    AGENT_BASE_URL: str = "http://127.0.0.1:9000"
    AGENT_RECOVERY_READ_ONLY: bool = False
    AGENT_SECRET: str = DEFAULT_AGENT_SECRET
    AGENT_TIMEOUT_SECONDS: float = 180.0
    MEETING_ANALYZER_ENABLED: bool = False
    MEETING_ANALYZER_BASE_URL: str = "http://127.0.0.1:9500"
    MEETING_ANALYZER_SECRET: str = ""
    MEETING_ANALYSIS_WORKER_ENABLED: bool = True
    INTERSERVICE_MAX_ATTEMPTS: int = 3
    INTERSERVICE_RETRY_BASE_SECONDS: float = 0.1
    INTERSERVICE_CIRCUIT_FAILURE_THRESHOLD: int = 5
    INTERSERVICE_CIRCUIT_RESET_SECONDS: float = 30.0

    # Experimental BA/PO V2; implementation lives in agents/business-analyst-experimental/.
    AGENT_V2_ENABLED: bool = False
    AGENT_V2_RECOVERY_READ_ONLY: bool = False
    AGENT_V2_KILL_SWITCH: bool = False
    AGENT_V2_BASE_URL: str = "http://127.0.0.1:9300"
    AGENT_V2_TIMEOUT_SECONDS: float = 180.0
    AGENT_V2_SECRET: str = DEFAULT_AGENT_V2_SECRET
    AGENT_V2_PILOT_USER_IDS: str = ""
    AGENT_V2_PILOT_EMAILS: str = ""
    AGENT_V2_BA_ROLE_NAMES: str = "BA/Участник команды,BA/Бизнес-аналитик"
    AGENT_V2_PO_ROLE_NAMES: str = "PO/PL/CL"

    # Task prioritisation and financial effect agent
    PRIORITISER_ENABLED: bool = True
    PRIORITISER_BASE_URL: str = "http://127.0.0.1:9100"
    PRIORITISER_SECRET: str = DEFAULT_PRIORITISER_SECRET
    PRIORITISER_TIMEOUT_SECONDS: float = 180.0
    
    class Config:
        # Единый env-файл проекта, независимо от каталога запуска uvicorn/pytest.
        env_file = str(PROJECT_DIR / ".env")
        case_sensitive = True


settings = Settings()


def validate_runtime_settings() -> None:
    """Запретить production-запуск с отсутствующими или известными секретами."""
    if settings.AUTH_ARGON_MEMORY_KIB < 19456 or settings.AUTH_ARGON_TIME_COST < 2 or settings.AUTH_ARGON_PARALLELISM < 1:
        raise ValueError("Argon2 parameters below the supported security floor")
    if not 15 <= settings.AUTH_PASSWORD_MIN <= settings.AUTH_PASSWORD_MAX <= 128:
        raise ValueError("Invalid password length policy")
    if settings.AUTH_MAX_SESSIONS < 1 or settings.AUTH_HASH_WORKERS < 1:
        raise ValueError("Session/hash limits must be positive")
    if settings.DEBUG:
        return

    errors = []
    if len(settings.AUTH_RATE_HMAC_KEY) < 32 or settings.AUTH_RATE_HMAC_KEY == settings.SECRET_KEY:
        errors.append("AUTH_RATE_HMAC_KEY must be an independent secret of at least 32 characters")
    if not settings.AUTH_ORIGINS or any(not origin.startswith("https://") for origin in settings.AUTH_ORIGINS):
        errors.append("AUTH_ORIGINS must contain exact HTTPS origins")
    if "*" in settings.AUTH_ALLOWED_HOSTS:
        errors.append("AUTH_ALLOWED_HOSTS must be explicit")
    if not settings.SECRET_KEY or settings.SECRET_KEY == DEFAULT_SECRET_KEY:
        errors.append("SECRET_KEY must be set to a non-default value")
    elif len(settings.SECRET_KEY) < 32:
        errors.append("SECRET_KEY must contain at least 32 characters")

    if not settings.AGENT_SECRET or settings.AGENT_SECRET == DEFAULT_AGENT_SECRET:
        errors.append("AGENT_SECRET must be set to a non-default value")
    if settings.PRIORITISER_ENABLED and (
        not settings.PRIORITISER_SECRET
        or settings.PRIORITISER_SECRET == DEFAULT_PRIORITISER_SECRET
    ):
        errors.append("PRIORITISER_SECRET must be set to a non-default value")
    if settings.AGENT_V2_ENABLED and (
        not settings.AGENT_V2_SECRET
        or settings.AGENT_V2_SECRET == DEFAULT_AGENT_V2_SECRET
    ):
        errors.append("AGENT_V2_SECRET must be set to a non-default value")
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
    if not settings.CLAMAV_HOST:
        errors.append("CLAMAV_HOST must be configured in production")

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
