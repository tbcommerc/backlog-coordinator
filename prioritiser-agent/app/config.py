"""Конфигурация прототипа. Всё, что зависит от контура, приходит из ENV."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
REFERENCES_DIR = DATA_DIR / "references"
KNOWLEDGE_DIR = DATA_DIR / "knowledge"
VAR_DIR = REPO_ROOT / "var"
DEFAULT_SERVICE_SECRET = "dmb-prioritiser-local-secret-2026"
DEFAULT_METHODOLOGIST_SECRET = "dmb-prioritiser-methodologist-local-secret-2026"


class Settings(BaseSettings):
    """Настройки читаются из .env с префиксом PRIORITISER_, плюс несколько
    вендорских переменных без префикса (их имена задаёт владелец контура)."""

    model_config = SettingsConfigDict(
        env_prefix="PRIORITISER_",
        env_file=REPO_ROOT / ".env",
        extra="ignore",
    )

    debug: bool = True
    db_url: str = "sqlite:///var/prioritiser.db"
    service_secret: str = DEFAULT_SERVICE_SECRET
    methodologist_secret: str = DEFAULT_METHODOLOGIST_SECRET

    # mock | openai_compat | anthropic | gigachat | gigacode
    # Рабочий default обязан обращаться к настроенной модели. Mock разрешён
    # только при явном выборе в тестах и никогда не включается как fallback.
    llm_provider: str = "openai_compat"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
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
    llm_cache_enabled: bool = True

    # Плотный слой поиска включён по умолчанию: без него RAG вырождается в
    # лексический поиск и не находит формулировки, отличные от запроса дословно.
    rag_vector: bool = True
    rag_embedding_model: str = "intfloat/multilingual-e5-base"
    rag_embedding_revision: str = "d13f1b27baf31030b7fd040960d60d909913633f"
    rag_model_cache_dir: str = ""
    rag_local_files_only: bool = False

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

    def resolved_db_url(self) -> str:
        """SQLite-пути в .env заданы относительно корня репозитория."""
        if self.db_url.startswith("sqlite:///") and not self.db_url.startswith("sqlite:////"):
            relative = self.db_url[len("sqlite:///") :]
            absolute = (REPO_ROOT / relative).resolve()
            absolute.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{absolute}"
        return self.db_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
