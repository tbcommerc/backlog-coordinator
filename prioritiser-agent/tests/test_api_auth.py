from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import main
from app.config import get_settings as load_settings


def _settings():
    return SimpleNamespace(
        service_secret="service-test-secret",
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


def test_ready_is_public_when_optional_models_disabled(monkeypatch):
    settings = load_settings()
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "llm_provider", "mock")
    monkeypatch.setattr(settings, "rag_vector", False)
    monkeypatch.setattr(settings, "value_analogy", False)
    assert main.ready().status_code == 200
