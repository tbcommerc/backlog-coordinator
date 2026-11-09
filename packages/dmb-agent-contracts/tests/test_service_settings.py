"""Each settings class is imported alone, without other product source roots."""
import os
import subprocess
import sys
from pathlib import Path
import pytest

SERVICES = [
    ("business-analyst", "business_analyst.config", "OPENAI_API_KEY", "AGENT_MODEL_API_KEY", "OPENAI_API_KEY"),
    ("business-analyst-experimental", "business_analyst_experimental.config", "OPENAI_API_KEY", "AGENT_V2_MODEL_API_KEY", "AGENT_V2_OPENAI_API_KEY"),
    ("meeting-analyzer", "meeting_analyzer.config", "model_api_key", "MEETING_ANALYZER_MODEL_API_KEY", "MEETING_ANALYZER_OPENAI_API_KEY"),
    ("value-priority-assessor", "value_priority_assessor.config", "openai_api_key", "PRIORITISER_MODEL_API_KEY", "PRIORITISER_OPENAI_API_KEY"),
]


def service_python(root, service):
    environments = {
        "business-analyst": ".venv",
        "business-analyst-experimental": ".venv-agent-v2",
        "meeting-analyzer": ".venv",
        "value-priority-assessor": ".venv-prioritiser",
        "backlog-assistant": "agents/backlog-assistant/.venv",
    }
    candidate = root/environments[service]/"Scripts"/"python.exe"
    return str(candidate) if candidate.is_file() else sys.executable


@pytest.mark.parametrize("service,module,field,canonical,legacy", SERVICES)
def test_independent_service_configuration(service, module, field, canonical, legacy):
    root = Path(__file__).resolve().parents[3]
    directory = root/"agents"/service
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
    env[canonical] = "synthetic-new-key"
    code = f'''
import importlib,os,hashlib
from pathlib import Path
path=Path('.env')
before=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
settings_class=importlib.import_module({module!r}).Settings
def value(instance):
    item=getattr(instance,{field!r})
    return item.get_secret_value() if hasattr(item,'get_secret_value') else item
instance=settings_class(_env_file=None)
assert value(instance)=='synthetic-new-key'
assert instance.configuration_sources()[{field!r}]['source']=='process'
assert 'synthetic-new-key' not in str(instance.configuration_sources())
os.environ[{legacy!r}]='different-synthetic-key'
try:
    settings_class(_env_file=None)
except ValueError as error:
    assert {canonical!r} in str(error) and {legacy!r} in str(error)
    assert 'synthetic-new-key' not in str(error) and 'different-synthetic-key' not in str(error)
else:
    raise AssertionError('Alias conflict accepted')
del os.environ[{legacy!r}]
os.environ[{canonical!r}]=''
assert value(settings_class(_env_file=None))==''
after=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
assert before==after
print('PASS')
'''
    result = subprocess.run([service_python(root, service), "-c", code], cwd=directory, env=env,
                            text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=45)
    assert result.returncode == 0, f"{service}: isolated settings contract failed (exit={result.returncode})"
    assert result.stdout.strip() == "PASS"


def test_independent_backlog_configuration():
    root = Path(__file__).resolve().parents[3]
    directory = root/"agents"/"backlog-assistant"
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
    env["BACKLOG_ASSISTANT_MODEL_API_KEY"] = "synthetic-process-key"
    code = """
import hashlib,os
from pathlib import Path
from backlog_assistant.config import environment,configuration_sources
path=Path('.env')
before=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
assert environment()['ASSISTANT_MODEL_KEY']=='synthetic-process-key'
assert configuration_sources()['ASSISTANT_MODEL_KEY']['source']=='process'
assert 'synthetic-process-key' not in str(configuration_sources())
os.environ['ASSISTANT_MODEL_KEY']='synthetic-conflict'
try:
    environment()
except ValueError as error:
    assert 'BACKLOG_ASSISTANT_MODEL_API_KEY' in str(error)
    assert 'synthetic-conflict' not in str(error)
else:
    raise AssertionError('Alias conflict accepted')
after=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
assert before==after
print('PASS')
"""
    result = subprocess.run([service_python(root, "backlog-assistant"), "-c", code], cwd=directory, env=env,
                            text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=45)
    assert result.returncode == 0, "backlog-assistant: isolated settings contract failed"
    assert result.stdout.strip() == "PASS"
