from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENVELOPE_SECRET = "change-this-assistant-v2-envelope-secret"
DEFAULT_SERVICE_SECRET = "change-this-assistant-v2-service-secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_prefix="ASSISTANT_V2_",
        case_sensitive=True,
        extra="ignore",
    )

    ENABLED: bool = False
    DATABASE_URL: str = (
        "postgresql+psycopg://assistant_v2:assistant_v2_local_dev@127.0.0.1:5432/assistant_v2"
    )
    ENVELOPE_SECRET: str = DEFAULT_ENVELOPE_SECRET
    SERVICE_SECRET: str = DEFAULT_SERVICE_SECRET
    ENVELOPE_ISSUER: str = "dmb-backlog"
    ENVELOPE_AUDIENCE: str = "assistant-v2"
    ENVELOPE_ALGORITHM: str = "HS256"
    ENVELOPE_REPLAY_WINDOW_SECONDS: int = 300
    DMB_ADAPTER_BASE_URL: str = "http://127.0.0.1:8000/internal/assistant-v2/v1"
    DMB_ADAPTER_TIMEOUT_SECONDS: float = 10.0
    MAX_SOURCE_BYTES: int = 262_144
    MAX_MESSAGE_BYTES: int = 32_768
    MAX_JSON_BYTES: int = 262_144
    ALLOW_REAL_DATA: bool = False
    PROVIDER_ENABLED: bool = False
    PROVIDER_MODEL: str = "disabled"
    PROMPT_VERSION: str = "base-policy/1.0"
    POLICY_VERSION: str = "assistant-v2-policy/1.0"
    OUTPUT_SCHEMA_VERSION: str = "agent-response/1.0"
    OTEL_SERVICE_NAME: str = "dmb-assistant-v2"

    def validate_runtime(self) -> None:
        errors: list[str] = []
        if self.ENABLED and self.DATABASE_URL.lower().startswith("sqlite"):
            errors.append("DATABASE_URL must use PostgreSQL outside tests")
        if self.ENABLED and self.ENVELOPE_SECRET == DEFAULT_ENVELOPE_SECRET:
            errors.append("ENVELOPE_SECRET must be changed")
        if self.ENABLED and self.SERVICE_SECRET == DEFAULT_SERVICE_SECRET:
            errors.append("SERVICE_SECRET must be changed")
        if not 1 <= self.ENVELOPE_REPLAY_WINDOW_SECONDS <= 600:
            errors.append("ENVELOPE_REPLAY_WINDOW_SECONDS must be between 1 and 600")
        if self.ENVELOPE_ALGORITHM != "HS256":
            errors.append("ENVELOPE_ALGORITHM must be HS256 for the approved dev contract")
        if self.MAX_SOURCE_BYTES < 1 or self.MAX_MESSAGE_BYTES < 1:
            errors.append("content limits must be positive")
        if errors:
            raise RuntimeError("Unsafe Assistant V2 configuration: " + "; ".join(errors))


@lru_cache
def get_settings() -> Settings:
    return Settings()
