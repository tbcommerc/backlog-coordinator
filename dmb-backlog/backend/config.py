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
    RUN_STARTUP_SEED: Optional[bool] = None
    RUN_STARTUP_MAINTENANCE: Optional[bool] = None
    RUN_NOTIFICATION_SCHEDULER: Optional[bool] = None
    
    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'dmb_backlog.db'}"
    REDIS_URL: Optional[str] = None
    
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
