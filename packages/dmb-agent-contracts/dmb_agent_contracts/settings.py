"""One alias contract for Pydantic settings, environment clients and launchers."""
import json
import os
import warnings
from contextvars import ContextVar
from importlib.resources import files
from pathlib import Path
from typing import ClassVar

from dotenv import dotenv_values

_origins = ContextVar("dmb_configuration_origins", default=None)


def profile_aliases(service_id):
    manifest = json.loads(files("dmb_agent_contracts").joinpath("profiles.json").read_text(encoding="utf-8"))
    return manifest[service_id]


def select_alias(values, names, *, case_sensitive=True):
    normalized = values if case_sensitive else {key.casefold(): value for key, value in values.items()}
    present = [(name, normalized[name if case_sensitive else name.casefold()]) for name in names
               if (name if case_sensitive else name.casefold()) in normalized]
    if not present:
        return None
    def plain(value):
        return value.get_secret_value() if hasattr(value, "get_secret_value") else value
    first = plain(present[0][1])
    if any(plain(value) != first for _, value in present[1:]):
        raise ValueError("Conflicting settings: "+", ".join(name for name, _ in present))
    # An explicitly empty key is an override, never permission to reuse a lower source.
    return present[0]


def settings_source(source, specs, origin, *, case_sensitive=True, include_targets=False):
    def read():
        result = source()
        raw = getattr(source, "env_vars", result)
        for target, public_names in specs.items():
            origins = _origins.get()
            if origins is not None and target in origins:
                continue
            names = list(public_names)
            if include_targets and target not in names:
                names.insert(0, target)
            selected = select_alias(raw, names, case_sensitive=case_sensitive)
            if selected is None:
                continue
            name, value = selected
            for alias in names:
                if alias != target:
                    result.pop(alias, None)
                    if not case_sensitive:
                        result.pop(alias.casefold(), None)
            result[target] = value
            origins = _origins.get()
            if origins is not None:
                origins.setdefault(target, {"source": origin, "name": name})
            if name in public_names[1:]:
                warnings.warn("Deprecated setting "+name+"; use "+public_names[0], FutureWarning, stacklevel=3)
        return result
    return read


class AliasSettingsMixin:
    alias_specs: ClassVar[dict] = {}

    def __init__(self, **values):
        token = _origins.set({})
        try:
            super().__init__(**values)
            origins = _origins.get()
            object.__setattr__(self, "_configuration_origins", {
                field: origins.get(field, {"source": "default", "name": None}) for field in self.alias_specs})
        finally:
            _origins.reset(token)

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings):
        sensitive = settings_cls.model_config.get("case_sensitive", False)
        return (
            settings_source(init_settings, cls.alias_specs, "explicit", case_sensitive=sensitive, include_targets=True),
            settings_source(env_settings, cls.alias_specs, "process", case_sensitive=sensitive),
            settings_source(dotenv_settings, cls.alias_specs, "service_file", case_sensitive=sensitive),
            settings_source(file_secret_settings, cls.alias_specs, "secret_file", case_sensitive=sensitive, include_targets=True),
        )

    def configuration_sources(self):
        return {field: dict(origin) for field, origin in self._configuration_origins.items()}


def resolve_environment(service_id, service_file=None, environment=None):
    """For clients that use os.environ rather than BaseSettings. No file writes."""
    process = dict(os.environ if environment is None else environment)
    file_values = dict(dotenv_values(service_file, interpolate=False)) if service_file and Path(service_file).is_file() else {}
    # The Windows compatibility launcher labels values imported for its Data API child.
    imported = json.loads(process.get("BACKLOG_ASSISTANT_FILE_IMPORTED_KEYS", "[]")) if service_id == "backlog-assistant" else []
    independent_process = {key: value for key, value in process.items() if key not in imported}
    result, origins = {**file_values, **process}, {}
    for target, names in profile_aliases(service_id).items():
        for origin, values in (("process", independent_process), ("service_file", file_values)):
            selected = select_alias(values, names)
            if selected is not None:
                name, value = selected
                result[target] = value
                origins[target] = {"source": origin, "name": name}
                break
    return result, origins
