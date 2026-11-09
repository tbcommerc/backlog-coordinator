import os
from typing import ClassVar
import pytest
from pydantic_settings import BaseSettings, SettingsConfigDict
from dmb_agent_contracts.settings import AliasSettingsMixin, profile_aliases, resolve_environment


class Example(AliasSettingsMixin, BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_prefix="EXAMPLE_", case_sensitive=True)
    alias_specs: ClassVar[dict] = {"key": ["EXAMPLE_MODEL_API_KEY", "EXAMPLE_OLD_KEY"]}
    key: str = "default"


def test_explicit_process_file_and_defaults_precedence(tmp_path, monkeypatch):
    path = tmp_path/"service.env"
    path.write_text("EXAMPLE_OLD_KEY=file-synthetic\n", encoding="utf-8")
    assert Example(_env_file=path).key == "file-synthetic"
    monkeypatch.setenv("EXAMPLE_MODEL_API_KEY", "process-synthetic")
    result = Example(_env_file=path)
    assert result.key == "process-synthetic"
    assert result.configuration_sources()["key"] == {"source": "process", "name": "EXAMPLE_MODEL_API_KEY"}
    assert Example(_env_file=path, key="explicit-synthetic").key == "explicit-synthetic"
    assert Example(_env_file=None, key="explicit").configuration_sources()["key"]["source"] == "explicit"


def test_conflict_names_only_and_empty_is_not_fallback(tmp_path, monkeypatch):
    path = tmp_path/"service.env"
    path.write_text("EXAMPLE_OLD_KEY=old-synthetic-secret\nEXAMPLE_MODEL_API_KEY=new-synthetic-secret\n", encoding="utf-8")
    with pytest.raises(ValueError) as error:
        Example(_env_file=path)
    assert "EXAMPLE_MODEL_API_KEY" in str(error.value)
    assert "new-synthetic-secret" not in str(error.value)
    monkeypatch.setenv("EXAMPLE_MODEL_API_KEY", "")
    result = Example(_env_file=path)
    assert result.key == ""  # Explicitly cleared process key shadows the file.
    assert result.configuration_sources()["key"]["source"] == "process"


@pytest.mark.parametrize("service", ["business-analyst", "business-analyst-experimental", "meeting-analyzer", "value-priority-assessor", "backlog-assistant"])
def test_all_profile_aliases_and_conflicts(service, tmp_path):
    path = tmp_path/"service.env"
    for target, names in profile_aliases(service).items():
        path.write_text(names[-1]+"=file-synthetic\n", encoding="utf-8")
        values, origins = resolve_environment(service, path, {names[0]: "process-synthetic"})
        assert values[target] == "process-synthetic"
        assert origins[target]["source"] == "process"
        assert path.read_text(encoding="utf-8") == names[-1]+"=file-synthetic\n"
        if len(names)>1:
            with pytest.raises(ValueError):
                resolve_environment(service, None, {names[0]:"synthetic-one", names[-1]:"synthetic-two"})


def test_backlog_launcher_imports_do_not_override_real_process_settings(tmp_path):
    path = tmp_path/"service.env"
    path.write_text("ASSISTANT_MODEL_KEY=file-synthetic\n", encoding="utf-8")
    values, origins = resolve_environment("backlog-assistant", path, {
        "ASSISTANT_MODEL_KEY":"file-synthetic", "BACKLOG_ASSISTANT_MODEL_API_KEY":"process-synthetic",
        "BACKLOG_ASSISTANT_FILE_IMPORTED_KEYS":'["ASSISTANT_MODEL_KEY"]'})
    assert values["ASSISTANT_MODEL_KEY"] == "process-synthetic"
    assert origins["ASSISTANT_MODEL_KEY"]["source"] == "process"


def test_origins_never_include_secret_values(tmp_path):
    path = tmp_path/"service.env"
    path.write_text("EXAMPLE_MODEL_API_KEY=synthetic-private-value\n", encoding="utf-8")
    result = Example(_env_file=path)
    assert "synthetic-private-value" not in str(result.configuration_sources())


def test_compatibility_resolver_keeps_explicit_empty():
    from dmb_agent_contracts.config import resolve_alias
    assert resolve_alias({"NEW": ""}, "NEW", "OLD", default="fallback") == ("NEW", "")
    with pytest.raises(ValueError):
        resolve_alias({"NEW": "", "OLD": "synthetic-value"}, "NEW", "OLD")
