from pydantic import Field, SecretStr
from typing import ClassVar
from dmb_agent_contracts.settings import AliasSettingsMixin, profile_aliases
from pydantic_settings import BaseSettings, SettingsConfigDict
from dmb_agent_contracts.config import validate_go_url


class Settings(AliasSettingsMixin, BaseSettings):
    alias_specs: ClassVar[dict] = profile_aliases("meeting-analyzer")
    model_config = SettingsConfigDict(env_prefix="MEETING_ANALYZER_", extra="ignore", protected_namespaces=(),
        env_file=".env")
    database_url: SecretStr = SecretStr("")
    service_secret: SecretStr = SecretStr("")
    model_api_key: SecretStr = SecretStr("")
    model_base_url: str = "https://opencode.ai/zen/go/v1"
    model_name: str = "glm-5.3-flash"
    model_protocol: str = "chat_completions"
    execution_backend: str = "direct"
    model_provider: str = "opencode_go"
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
    deadline_seconds: int = Field(default=600, ge=10, le=600)
    queue_limit: int = Field(default=100, ge=1, le=1000)
    request_body_limit_bytes: int = Field(default=1048576, ge=1024, le=4194304)
    snapshot_retention_hours: int = Field(default=24, ge=1, le=24)
    result_retention_days: int = Field(default=7, ge=1, le=7)
    metadata_retention_days: int = Field(default=7, ge=7, le=90)
    idempotency_retention_days: int = Field(default=14, ge=7, le=90)

    def retention_policy(self):
        return {"snapshot_hours": self.snapshot_retention_hours, "result_days": self.result_retention_days,
                "metadata_days": self.metadata_retention_days, "idempotency_days": self.idempotency_retention_days}

    host: str = "127.0.0.1"
    port: int = 9500

    def remote_profile(self):
        from dmb_agent_contracts.remote_configuration import RemoteProfile
        return RemoteProfile.from_settings(self)

    def run_profile(self):
        value = {"backend": self.execution_backend, "provider": self.model_provider,
            "protocol": self.model_protocol, "base_url": self.model_base_url, "model": self.model_name}
        if self.execution_backend == "opencode":
            value["remote_profile_ref"] = self.remote_profile().profile_ref
        return value

    def validate_runtime(self):
        missing = [name for name in ("database_url", "service_secret", "model_api_key")
                   if not getattr(self, name).get_secret_value()]
        if missing:
            raise ValueError("Required settings: " + ", ".join("MEETING_ANALYZER_" + n.upper() for n in missing))
        if not self.database_url.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("MEETING_ANALYZER_DATABASE_URL must use PostgreSQL/psycopg")
        if (self.execution_backend, self.runtime_location) not in (("direct", "none"), ("opencode", "remote")) or self.model_protocol != "chat_completions":
            raise ValueError("Unsupported MEETING_ANALYZER_EXECUTION_BACKEND/MODEL_PROTOCOL")
        if self.model_provider != "opencode_go":
            raise ValueError("Unsupported MEETING_ANALYZER_MODEL_PROVIDER/RUNTIME_LOCATION")
        validate_go_url(self.model_base_url)
        if self.execution_backend == "opencode":
            if self.runtime_contract_version != "1.17.13":
                raise ValueError("MEETING_ANALYZER_RUNTIME_CONTRACT_VERSION unsupported")
            self.remote_profile().runtime()
