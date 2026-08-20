"""
AI Business Analyst Assistant - Configuration
"""
import json
import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # Paths
    BASE_DIR: Path = BASE_DIR
    KB_DIR: Path = BASE_DIR / "kb_seed"
    PROMPTS_DIR: Path = BASE_DIR / "agent" / "prompts"
    SESSION_DB: str = str(BASE_DIR / "agent_sessions.db")

    # Service
    APP_NAME: str = "DMB AI Business Analyst Assistant"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    AGENT_PORT: int = 9000

    # LLM provider: mock | openai_compat
    LLM_PROVIDER: str = "mock"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

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
    """Fail closed when production is started with the development secret."""
    if not settings.DEBUG and (
        not settings.AGENT_SECRET or settings.AGENT_SECRET == DEFAULT_AGENT_SECRET
    ):
        raise RuntimeError("AGENT_SECRET must be set to a non-default value in production")


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
