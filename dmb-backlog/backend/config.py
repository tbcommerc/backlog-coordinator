"""
DMB Backlog - Configuration
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent
    LOGS_DIR: Path = BASE_DIR / "logs"
    
    # Application
    APP_NAME: str = "DMB Backlog"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'dmb_backlog.db'}"
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production-dmb2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS
    CORS_ORIGINS: list = ["http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8080"]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

# Create logs directory
settings.LOGS_DIR.mkdir(exist_ok=True)