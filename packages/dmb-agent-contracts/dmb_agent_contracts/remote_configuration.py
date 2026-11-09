"""Explicit per-service remote configuration; never inferred from inference URL."""
import hashlib
import json
import base64
from pathlib import Path

from .model import AgentError
from .remote import RemoteOpenCode
from .runtime_model import RuntimeModel


class RemoteProfile:
    def __init__(self, *, enabled, base_url, config_file, provider_id, model_id, agent, credential="", username="opencode", auth_scheme="basic"):
        if enabled is not True:
            raise AgentError("remote_profile_disabled", 422)
        try:
            path = Path(config_file)
            if not path.is_absolute() or not path.is_file() or path.stat().st_size > 262144:
                raise ValueError()
            config = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(config, dict) or not all((provider_id, model_id, agent)):
                raise ValueError()
        except (OSError, ValueError, TypeError):
            raise AgentError("remote_configuration_invalid", 503) from None
        self.base_url, self.config, self.credential = base_url, config, credential
        if auth_scheme not in {"basic", "bearer"} or not username or ":" in username:
            raise AgentError("remote_configuration_invalid", 503)
        self.auth_scheme, self.username = auth_scheme, username
        self.model, self.agent = {"providerID": provider_id, "modelID": model_id}, agent
        self.profile_ref = hashlib.sha256(json.dumps({"origin": base_url, "config": config,
            "model": self.model, "agent": agent, "auth_scheme": auth_scheme, "username": username}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def runtime(self):
        authorization = ("Basic "+base64.b64encode((self.username+":"+self.credential).encode()).decode()
            if self.auth_scheme == "basic" else "Bearer "+self.credential)
        return RemoteOpenCode(base_url=self.base_url, expected_config=self.config,
            model=self.model, agent=self.agent, enabled=True,
            headers={"Authorization": authorization} if self.credential else {})

    @classmethod
    def from_settings(cls, settings):
        def value(name, default=""):
            selected = getattr(settings, name, getattr(settings, name.upper(), default))
            return selected.get_secret_value() if hasattr(selected, "get_secret_value") else selected
        return cls(enabled=value("remote_enabled", False), base_url=value("remote_base_url"),
            config_file=value("remote_config_file"), provider_id=value("remote_provider_id", "controlled"),
            model_id=value("remote_model_id"), agent=value("remote_agent", "bounded"),
            credential=value("remote_credential"), username=value("remote_username", "opencode"),
            auth_scheme=value("remote_auth_scheme", "basic"))

    def preflight(self):
        return self.runtime().capabilities()

    def model_port(self):
        return RuntimeModel(self.runtime, model_actual=self.model["modelID"], profile_ref=self.profile_ref)
