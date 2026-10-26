"""
AI Business Analyst Assistant - Configuration
"""
import json
import os
from pathlib import Path
from typing import Literal, Optional
from pydantic import Field
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # Paths
    BASE_DIR: Path = BASE_DIR
    KB_DIR: Path = BASE_DIR / "kb_seed"
    PROMPTS_DIR: Path = BASE_DIR / "prompts"
    SESSION_DB: str = str(BASE_DIR / "agent_v2_sessions.db")
    SESSION_DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SECONDS: int = 30

    # Service
    APP_NAME: str = "DMB AI BA/PO Assistant V2"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = True
    AGENT_PORT: int = Field(default=9300, validation_alias="AGENT_V2_PORT")
    ENABLED: bool = False
    KILL_SWITCH: bool = False
    PILOT_USER_IDS: str = ""
    PILOT_EMAILS: str = ""
    PROMPT_SET_VERSION: str = "v2.1"

    # OpenTelemetry traces (OTLP/HTTP). Disabled locally by default.
    OTEL_ENABLED: bool = False
    OTEL_SERVICE_NAME: str = "dmb-agent-v2"
    OTEL_DEPLOYMENT_ENVIRONMENT: str = "local"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: Optional[str] = None
    OTEL_TRACE_SAMPLE_RATIO: float = 1.0
    OTEL_EXPORT_TIMEOUT_SECONDS: float = 10.0
    OTEL_EXCLUDED_URLS: str = "/api/agent-v2/health,/api/agent-v2/ready"

    # LLM provider: mock | openai_compat
    LLM_PROVIDER: str = "mock"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_REASONING_EFFORT: Literal["", "low", "medium", "high"] = ""
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    AGENT_DECISION_MAX_TOKENS: int = 3072
    # Full documents and per-source coverage are larger than dialogue decisions.
    DOCUMENT_MAX_TOKENS: int = Field(default=12000, ge=1024, le=32000)
    AGENT_LLM_HISTORY_MESSAGES: int = 40
    AGENT_HISTORY_MESSAGES: int = 100
    AGENT_SLOT_HISTORY_ITEMS: int = 20
    MESSAGE_RECEIPT_RETENTION_DAYS: int = 7
    # Security
    AGENT_SECRET: str = Field(
        default="dmb-agent-v2-local-secret-2026",
        validation_alias="AGENT_V2_SECRET",
    )

    # MCP servers: JSON list, e.g.
    # [{"name": "kb-tools", "command": "python", "args": ["server.py"]}]
    MCP_SERVERS_JSON: str = ""

    # External tools: JSON list of tool configs
    TOOLS_CONFIG_JSON: str = ""

    # Domain policy
    ALLOWED_INTENTS: list = ["feature", "change", "problem", "clarification", "incident"]
    OUT_OF_DOMAIN_MAX_STRIKES: int = 3

    # Retrieval
    KB_MAX_DOCS: int = 4
    KB_MAX_SNIPPETS: int = 6

    class Config:
        env_file = os.path.join(BASE_DIR, ".env")
        env_prefix = "AGENT_V2_"
        case_sensitive = True
        extra = "ignore"


settings = Settings()


DEFAULT_AGENT_SECRET = "dmb-agent-v2-local-secret-2026"


def validate_runtime_settings() -> None:
    """Fail closed when production is started with the development secret."""
    if settings.DEBUG:
        return
    errors = []
    if not settings.AGENT_SECRET or settings.AGENT_SECRET == DEFAULT_AGENT_SECRET:
        errors.append("AGENT_V2_SECRET must be set to a non-default value")
    if not settings.SESSION_DATABASE_URL.lower().startswith(("postgresql://", "postgresql+psycopg://")):
        errors.append("AGENT_V2_SESSION_DATABASE_URL must use PostgreSQL in production")
    if (settings.LLM_PROVIDER or "").strip().lower() != "openai_compat":
        errors.append("AGENT_V2_LLM_PROVIDER must be openai_compat in production")
    if not settings.OPENAI_API_KEY.strip():
        errors.append("AGENT_V2_OPENAI_API_KEY must be configured in production")
    if settings.OTEL_ENABLED and not settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
        errors.append("AGENT_V2_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be configured when AGENT_V2_OTEL_ENABLED=true")
    if not 0 <= settings.OTEL_TRACE_SAMPLE_RATIO <= 1:
        errors.append("AGENT_V2_OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1")
    if errors:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(errors))


def parse_json_list(raw: str) -> list:
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else []
    except Exception:
        return []


def mcp_servers() -> list:
    return parse_json_list(settings.MCP_SERVERS_JSON)


def tools_config() -> list:
    return parse_json_list(settings.TOOLS_CONFIG_JSON)
