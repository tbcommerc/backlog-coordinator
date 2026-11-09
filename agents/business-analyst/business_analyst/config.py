"""
AI Business Analyst Assistant - Configuration
"""
import json
import os
from pathlib import Path
from typing import Optional
from typing import ClassVar
from dmb_agent_contracts.settings import AliasSettingsMixin, profile_aliases
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(AliasSettingsMixin, BaseSettings):
    alias_specs: ClassVar[dict] = profile_aliases("business-analyst")
    # Paths
    BASE_DIR: Path = BASE_DIR
    KB_DIR: Path = BASE_DIR / "kb_seed"
    PROMPTS_DIR: Path = BASE_DIR / "business_analyst" / "prompts"
    SESSION_DB: str = str(BASE_DIR / "agent_sessions.db")
    SESSION_DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SECONDS: int = 30

    # Service
    APP_NAME: str = "DMB AI Business Analyst Assistant"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    UNIT_TEST_MODE: bool = Field(default=False, validation_alias="AGENT_UNIT_TEST_MODE")
    AGENT_PORT: int = 9000

    # OpenTelemetry traces (OTLP/HTTP). Disabled locally by default.
    OTEL_ENABLED: bool = False
    OTEL_SERVICE_NAME: str = "dmb-agent"
    OTEL_DEPLOYMENT_ENVIRONMENT: str = "local"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: Optional[str] = None
    OTEL_TRACE_SAMPLE_RATIO: float = 1.0
    OTEL_EXPORT_TIMEOUT_SECONDS: float = 10.0
    OTEL_EXCLUDED_URLS: str = "/api/agent/health"

    EXECUTION_BACKEND: str = Field(default='direct', validation_alias='AGENT_EXECUTION_BACKEND')
    MODEL_PROVIDER: str = Field(default='opencode_go', validation_alias='AGENT_MODEL_PROVIDER')
    MODEL_PROTOCOL: str = Field(default='chat_completions', validation_alias='AGENT_MODEL_PROTOCOL')
    RUNTIME_LOCATION: str = Field(default='none', validation_alias='AGENT_RUNTIME_LOCATION')
    RUNTIME_CONTRACT_VERSION: str = Field(default='1.17.13', validation_alias='AGENT_RUNTIME_CONTRACT_VERSION')
    REMOTE_ENABLED: bool = False
    REMOTE_BASE_URL: str = ""
    REMOTE_CONFIG_FILE: str = ""
    REMOTE_PROVIDER_ID: str = "controlled"
    REMOTE_MODEL_ID: str = ""
    REMOTE_AGENT: str = "bounded"
    REMOTE_CREDENTIAL: SecretStr = SecretStr("")
    REMOTE_USERNAME: str = "opencode"
    REMOTE_AUTH_SCHEME: str = "basic"

    # LLM provider: mock | openai_compat
    LLM_PROVIDER: str = "mock"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://opencode.ai/zen/go/v1"
    OPENAI_MODEL: str = "glm-5.3-flash"
    EMBEDDINGS_ENABLED: bool = Field(default=False, validation_alias="AGENT_EMBEDDINGS_ENABLED")
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    AGENT_DECISION_MAX_TOKENS: int = 3072
    AGENT_LLM_HISTORY_MESSAGES: int = 40
    AGENT_HISTORY_MESSAGES: int = 100
    AGENT_SLOT_HISTORY_ITEMS: int = 20
    MESSAGE_RECEIPT_RETENTION_DAYS: int = 7
    # Security
    AGENT_SECRET: str = "dmb-agent-local-secret-2026"

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
        case_sensitive = True
        extra = "ignore"


settings = Settings()


DEFAULT_AGENT_SECRET = "dmb-agent-local-secret-2026"


def validate_runtime_settings() -> None:
    """Validate real local/production services; mocks require explicit unit mode."""
    if settings.UNIT_TEST_MODE and settings.DEBUG:
        return
    errors = []
    if (settings.EXECUTION_BACKEND, settings.RUNTIME_LOCATION) not in (("direct", "none"), ("opencode", "remote")):
        errors.append("EXECUTION_BACKEND/RUNTIME_LOCATION unsupported by this service profile")
    if settings.MODEL_PROVIDER != "opencode_go":
        errors.append("MODEL_PROVIDER must be opencode_go in the local profile")
    if settings.MODEL_PROTOCOL != "chat_completions":
        errors.append("MODEL_PROTOCOL: model_capability_missing")
    if settings.UNIT_TEST_MODE:
        errors.append("UNIT_TEST_MODE requires DEBUG=true")
    if not settings.AGENT_SECRET or settings.AGENT_SECRET == DEFAULT_AGENT_SECRET:
        errors.append("AGENT_SECRET must be set to a non-default value")
    if not settings.SESSION_DATABASE_URL.lower().startswith(("postgresql://", "postgresql+psycopg://")):
        errors.append("SESSION_DATABASE_URL must use PostgreSQL for service startup")
    if (settings.LLM_PROVIDER or "").strip().lower() != "openai_compat":
        errors.append("LLM_PROVIDER must be openai_compat for service startup")
    from dmb_agent_contracts.config import validate_go_url
    try:
        validate_go_url(settings.OPENAI_BASE_URL)
    except Exception:
        errors.append("OPENAI_BASE_URL must use an allowed HTTPS Go origin")
    if settings.EMBEDDINGS_ENABLED:
        errors.append("EMBEDDINGS_ENABLED: embedding_capability_not_qualified")
    if not settings.OPENAI_API_KEY.strip():
        errors.append("OPENAI_API_KEY must be configured for service startup")
    if settings.OTEL_ENABLED and not settings.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
        errors.append("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be configured when OTEL_ENABLED=true")
    if not 0 <= settings.OTEL_TRACE_SAMPLE_RATIO <= 1:
        errors.append("OTEL_TRACE_SAMPLE_RATIO must be between 0 and 1")
    if settings.EXECUTION_BACKEND == "opencode":
        from dmb_agent_contracts.remote_configuration import RemoteProfile
        if settings.RUNTIME_CONTRACT_VERSION != "1.17.13":
            errors.append("RUNTIME_CONTRACT_VERSION unsupported")
        RemoteProfile.from_settings(settings).runtime()
    if errors:
        raise RuntimeError("Unsafe service configuration: " + "; ".join(errors))


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
