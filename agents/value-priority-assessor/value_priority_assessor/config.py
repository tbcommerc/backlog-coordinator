"""Конфигурация прототипа. Всё, что зависит от контура, приходит из ENV."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from typing import ClassVar
from dmb_agent_contracts.settings import AliasSettingsMixin, profile_aliases
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import SecretStr

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
REFERENCES_DIR = DATA_DIR / "references"
KNOWLEDGE_DIR = DATA_DIR / "knowledge"
VAR_DIR = REPO_ROOT / "var"
DEFAULT_SERVICE_SECRET = "dmb-prioritiser-local-secret-2026"
DEFAULT_METHODOLOGIST_SECRET = "dmb-prioritiser-methodologist-local-secret-2026"


class Settings(AliasSettingsMixin, BaseSettings):
    alias_specs: ClassVar[dict] = profile_aliases("value-priority-assessor")
    """Настройки читаются из .env с префиксом PRIORITISER_, плюс несколько
    вендорских переменных без префикса (их имена задаёт владелец контура)."""

    model_config = SettingsConfigDict(protected_namespaces=(),
        env_prefix="PRIORITISER_",
        env_file=REPO_ROOT / ".env",
        extra="ignore",
    )

    debug: bool = True
    unit_test_mode: bool = False
    execution_backend: str = "direct"
    model_provider: str = "opencode_go"
    model_protocol: str = "chat_completions"
    runtime_location: str = "none"
    runtime_contract_version: str = "1.17.13"
    remote_enabled: bool = False
    remote_base_url: str = ""
    remote_config_file: str = ""
    remote_provider_id: str = "controlled"
    remote_model_id: str = ""
    remote_agent: str = "bounded"
    remote_credential: SecretStr = SecretStr("")
    remote_username: str = "opencode"
    remote_auth_scheme: str = "basic"
    db_url: str = "sqlite:///var/prioritiser.db"
    service_secret: str = DEFAULT_SERVICE_SECRET
    methodologist_secret: str = DEFAULT_METHODOLOGIST_SECRET

    # mock | openai_compat | anthropic | gigachat | gigacode
    # Рабочий default обязан обращаться к настроенной модели. Mock разрешён
    # только при явном выборе в тестах и никогда не включается как fallback.
    llm_provider: str = "openai_compat"
    openai_api_key: str = ""
    openai_base_url: str = "https://opencode.ai/zen/go/v1"
    openai_model: str = "glm-5.3-flash"
    anthropic_model: str = "claude-sonnet-5"
    gigachat_model: str = "GigaChat-2-Max"

    # F5 «Стратегическое соответствие»: agent | rest; stub только для тестов.
    # По ТЗ фактор приходит от внешнего Strategy Decomposer (rest); решением
    # владельца оценка перенесена внутрь проекта (agent).
    strategy_provider: str = "agent"

    # F6 «Зависимость от команд»: declared | agent.
    dependency_provider: str = "declared"

    # Подмешивать ли материалы корпуса в промпт оценщика.
    strategy_use_rag: bool = True

    # Оценка Value по аналогии с задачами, где его заполнил человек.
    # На leave-one-out она точнее формулы в пять раз, поэтому включена по
    # умолчанию; выключатель нужен, чтобы сравнить методы между собой.
    value_analogy: bool = True
    value_analogy_top_k: int = 3

    llm_timeout_seconds: float = 30.0
    llm_retry_attempts: int = 3
    llm_retry_base_seconds: float = 0.5
    llm_retry_max_seconds: float = 5.0
    llm_cache_enabled: bool = True
    assessment_max_workers: int = 8

    # Плотный слой поиска включён по умолчанию: без него RAG вырождается в
    # лексический поиск и не находит формулировки, отличные от запроса дословно.
    rag_vector: bool = True
    rag_embedding_model: str = "intfloat/multilingual-e5-base"
    rag_embedding_revision: str = "d13f1b27baf31030b7fd040960d60d909913633f"
    rag_model_cache_dir: str = ""
    rag_index_dir: str = ""
    rag_local_files_only: bool = True

    # Корпус K3 индексируется, когда пакет установлен. Выключатель нужен для
    # демонстраций и внешних показов, где материалы этой классификации
    # показывать нельзя.
    rag_allow_k3: bool = True

    @property
    def anthropic_api_key(self) -> str:
        return os.getenv("ANTHROPIC_API_KEY", "")

    @property
    def gigachat_credentials(self) -> str:
        return os.getenv("GIGACHAT_CREDENTIALS", "")

    @property
    def gigachat_scope(self) -> str:
        return os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

    @property
    def gigachat_ca_bundle(self) -> str:
        return os.getenv("GIGACHAT_CA_BUNDLE", "")

    @property
    def gigacode_base_url(self) -> str:
        return os.getenv("GIGACODE_LLM_BASE_URL", "")

    @property
    def strategy_decomposer_url(self) -> str:
        return os.getenv("STRATEGY_DECOMPOSER_URL", "")

    @property
    def strategy_decomposer_token(self) -> str:
        return os.getenv("STRATEGY_DECOMPOSER_TOKEN", "")

    @property
    def sd_repo_root(self) -> Path | None:
        raw = os.getenv("SD_REPO_ROOT", "").strip()
        if not raw:
            return None
        path = Path(raw).expanduser()
        return path if path.is_dir() else None

    def validate_service_runtime(self) -> None:
        errors = []
        if self.unit_test_mode:
            if not self.debug:
                errors.append("PRIORITISER_UNIT_TEST_MODE requires PRIORITISER_DEBUG=true")
        else:
            if (self.execution_backend, self.runtime_location) not in (("direct", "none"), ("opencode", "remote")):
                errors.append("PRIORITISER_EXECUTION_BACKEND/RUNTIME_LOCATION unsupported")
            if self.model_provider != "opencode_go" or self.model_protocol != "chat_completions":
                errors.append("PRIORITISER_MODEL_PROVIDER/MODEL_PROTOCOL: model_capability_missing")
            if not self.db_url.startswith(("postgresql://", "postgresql+psycopg://")):
                errors.append("PRIORITISER_DB_URL must use PostgreSQL")
            if self.llm_provider != "openai_compat":
                errors.append("PRIORITISER_LLM_PROVIDER is test-only")
            from dmb_agent_contracts.config import validate_go_url
            try:
                validate_go_url(self.openai_base_url)
            except Exception:
                errors.append("PRIORITISER_OPENAI_BASE_URL must use an allowed HTTPS Go origin")
            if self.llm_provider == "openai_compat" and not self.openai_api_key:
                errors.append("PRIORITISER_OPENAI_API_KEY is required")
        if not self.service_secret or (not self.debug and self.service_secret == DEFAULT_SERVICE_SECRET):
            errors.append("PRIORITISER_SERVICE_SECRET must be configured")
        if not self.debug and (not self.methodologist_secret or self.methodologist_secret == DEFAULT_METHODOLOGIST_SECRET):
            errors.append("PRIORITISER_METHODOLOGIST_SECRET must be configured")
        if self.execution_backend == "opencode":
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            if self.runtime_contract_version != "1.17.13":
                errors.append("PRIORITISER_RUNTIME_CONTRACT_VERSION unsupported")
            RemoteProfile.from_settings(self).runtime()
        if errors:
            raise RuntimeError("; ".join(errors))

    def resolved_db_url(self) -> str:
        """SQLite-пути в .env заданы относительно корня репозитория."""
        if self.db_url.startswith("postgresql://"):
            return "postgresql+psycopg://"+self.db_url[len("postgresql://"):]
        if self.db_url in {"sqlite://", "sqlite:///:memory:"}:
            return self.db_url
        if self.db_url.startswith("sqlite:///") and not self.db_url.startswith("sqlite:////"):
            relative = self.db_url[len("sqlite:///") :]
            absolute = (REPO_ROOT / relative).resolve()
            absolute.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{absolute}"
        return self.db_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
