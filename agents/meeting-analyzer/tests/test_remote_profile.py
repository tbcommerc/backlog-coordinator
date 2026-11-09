"""Product extraction over the independent reference HTTP emulator, not live Go."""
import json
import runpy
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from dmb_agent_contracts.remote import RemoteOpenCode
from dmb_agent_contracts.remote_configuration import RemoteProfile
from dmb_agent_contracts.runtime_records import bindings, migrate as migrate_runtime
from meeting_analyzer.api import create_app
from meeting_analyzer.config import Settings
from meeting_analyzer.worker import execute
from test_contract import body, storage


def test_explicit_remote_profile_preserves_product_validation_and_binding(tmp_path, monkeypatch, storage):
    fixture = runpy.run_path(str(Path(__file__).resolve().parents[3]/"packages/dmb-agent-contracts/tests/test_remote_http.py"))
    config = fixture["CONFIG"]
    config_path = tmp_path/"synthetic-runtime.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    settings = Settings(_env_file=None, service_secret="synthetic-secret", execution_backend="opencode",
        runtime_location="remote", remote_enabled=True, remote_base_url="https://reference.invalid",
        remote_config_file=str(config_path.resolve()), remote_model_id="synthetic")
    migrate_runtime(storage.engine, backup_verified=True, allowed_existing=("meeting_runs", "meeting_events"))
    with fixture["emulator"](disconnect=True, candidate={"items": [{"kind": "action", "title": "Описание процесса",
            "description": "", "owner_text": "", "due_text": "", "quote": "Подготовить описание процесса."}]}) as (url, state):
        with httpx.Client(base_url=url, timeout=1, trust_env=False) as reference:
            monkeypatch.setattr(RemoteProfile, "runtime", lambda profile: RemoteOpenCode(
                base_url=profile.base_url, expected_config=profile.config, model=profile.model,
                agent=profile.agent, client=reference, enabled=True))
            with TestClient(create_app(settings, storage.engine)) as client:
                headers = {"X-Agent-Secret": "synthetic-secret", "X-Agent-Caller": "dmb",
                    "X-Actor-Ref": "synthetic-actor", "Idempotency-Key": "synthetic-key"}
                accepted = client.post("/internal/agent/v1/runs", json=body(), headers=headers)
                assert accepted.status_code == 202
                execute(storage, storage.claim(), settings.remote_profile().model_port())
                result = client.get(accepted.json()["status_url"]+"/result", headers=headers)
                assert result.status_code == 200, result.text
                item = result.json()["result"]["items"][0]
                assert item["quote"] == "Подготовить описание процесса." and item["due_date"] is None
                assert state["dispatch_count"] == 1
                with storage.engine.connect() as connection:
                    record = connection.execute(select(bindings)).mappings().one()
                assert record["delivery"] == "accepted" and record["cleanup"] == "confirmed"
                assert not set(record["binding"]) & {"endpoint", "credential", "provider_key", "token"}


def test_default_local_profile_does_not_require_remote_settings():
    settings = Settings(_env_file=None, database_url="postgresql+psycopg://postgres@127.0.0.1/synthetic",
        service_secret="synthetic", model_api_key="synthetic", remote_config_file="missing-unused-file")
    settings.validate_runtime()
    assert settings.execution_backend == "direct" and settings.runtime_location == "none"
