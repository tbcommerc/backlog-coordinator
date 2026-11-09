import pytest
from value_priority_assessor.config import Settings


def settings(**changes):
    values = {"db_url": "postgresql+psycopg://synthetic@127.0.0.1/synthetic", "debug": True,
              "unit_test_mode": False, "openai_base_url": "https://opencode.ai/zen/go/v1", "openai_api_key": "synthetic-key", "service_secret": "synthetic-service"}
    values.update(changes)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("changes,field", [
    ({"db_url": "sqlite:///:memory:"}, "PRIORITISER_DB_URL"),
    ({"llm_provider": "mock"}, "PRIORITISER_LLM_PROVIDER"),
    ({"openai_api_key": ""}, "PRIORITISER_OPENAI_API_KEY"),
    ({"service_secret": ""}, "PRIORITISER_SERVICE_SECRET"),
    ({"unit_test_mode": True, "debug": False}, "PRIORITISER_UNIT_TEST_MODE"),
    ({"debug": False, "service_secret": "dmb-prioritiser-local-secret-2026"}, "PRIORITISER_SERVICE_SECRET"),
])
def test_invalid_profile_refused_without_connection_or_secret_output(changes, field):
    with pytest.raises(RuntimeError, match=field) as error:
        settings(**changes).validate_service_runtime()
    assert "synthetic-key" not in str(error.value)


def test_isolated_mock_sqlite_requires_explicit_test_mode():
    settings(db_url="sqlite:///:memory:", llm_provider="mock", openai_api_key="", unit_test_mode=True).validate_service_runtime()


def test_local_postgres_profile_validates_without_provider_probe():
    settings().validate_service_runtime()


def test_database_urls_keep_explicit_driver_and_memory_boundary(monkeypatch):
    from pathlib import Path
    def forbidden(*_args, **_kwargs):
        raise AssertionError("No filesystem mutation for PostgreSQL or in-memory fixtures")
    monkeypatch.setattr(Path, "mkdir", forbidden)
    assert settings(db_url="postgresql://synthetic@127.0.0.1/synthetic").resolved_db_url() == "postgresql+psycopg://synthetic@127.0.0.1/synthetic"
    assert settings(db_url="sqlite:///:memory:", unit_test_mode=True).resolved_db_url() == "sqlite:///:memory:"
