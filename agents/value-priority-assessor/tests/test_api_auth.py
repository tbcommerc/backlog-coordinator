from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from value_priority_assessor.api import main
from value_priority_assessor.config import get_settings as load_settings


def _settings():
    return SimpleNamespace(
        service_secret="service-test-secret",
        debug=False,
        methodologist_secret="methodologist-test-secret",
    )


def test_service_secret_is_required(monkeypatch):
    monkeypatch.setattr(main, "get_settings", _settings)

    with pytest.raises(HTTPException) as exc_info:
        main.require_service(None)

    assert exc_info.value.status_code == 401


def test_methodologist_secret_is_independent_from_service_secret(monkeypatch):
    monkeypatch.setattr(main, "get_settings", _settings)

    assert main.require_service("service-test-secret") == "coordinator"
    with pytest.raises(HTTPException) as exc_info:
        main.require_methodologist("service-test-secret")
    assert exc_info.value.status_code == 401
    assert main.require_methodologist("methodologist-test-secret") == "methodologist"


def test_openapi_declares_both_capability_headers():
    schemes = main.app.openapi()["components"]["securitySchemes"]

    assert schemes["PrioritiserServiceSecret"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-Prioritiser-Secret",
    }
    assert schemes["PrioritiserMethodologistSecret"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-Methodologist-Secret",
    }


def test_ready_is_public_when_optional_models_disabled(monkeypatch, tmp_path):
    from sqlalchemy import create_engine
    from dmb_agent_contracts.run_store import metadata
    from value_priority_assessor.config import Settings
    settings = Settings(_env_file=None, db_url='sqlite:///:memory:', debug=True,
        unit_test_mode=True, llm_provider='mock', rag_vector=False,
        value_analogy=False, strategy_use_rag=False, service_secret='synthetic-readiness')
    engine = create_engine('sqlite:///'+(tmp_path/'readiness.sqlite').as_posix())
    metadata.create_all(engine)  # Only the two technical tables, no references/users.
    monkeypatch.setattr(main, 'get_settings', lambda:settings)
    monkeypatch.setattr(main, 'get_engine', lambda:engine)
    try:
        assert main.ready().status_code == 200
    finally:
        engine.dispose()
