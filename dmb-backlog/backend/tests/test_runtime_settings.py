import pytest
from pathlib import Path

from config import (
    DEFAULT_AGENT_SECRET,
    DEFAULT_PRIORITISER_SECRET,
    DEFAULT_SECRET_KEY,
    settings,
    should_run_startup_maintenance,
    should_run_startup_seed,
    should_run_notification_scheduler,
    validate_runtime_settings,
)


@pytest.fixture(autouse=True)
def _explicit_prioritiser_secret(monkeypatch):
    monkeypatch.setattr(settings, "PRIORITISER_SECRET", "unique-prioritiser-secret")


def test_development_mode_allows_local_defaults(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "SECRET_KEY", DEFAULT_SECRET_KEY)
    monkeypatch.setattr(settings, "AGENT_SECRET", DEFAULT_AGENT_SECRET)
    validate_runtime_settings()


@pytest.mark.parametrize("secret", ["", DEFAULT_SECRET_KEY, "short-secret"])
def test_production_rejects_unsafe_jwt_secret(monkeypatch, secret):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", secret)
    monkeypatch.setattr(settings, "AGENT_SECRET", "agent-secret-that-is-not-the-default")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_runtime_settings()


@pytest.mark.parametrize("agent_secret", ["", DEFAULT_AGENT_SECRET])
def test_production_rejects_unsafe_agent_secret(monkeypatch, agent_secret):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", agent_secret)
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    with pytest.raises(RuntimeError, match="AGENT_SECRET"):
        validate_runtime_settings()


@pytest.mark.parametrize("prioritiser_secret", ["", DEFAULT_PRIORITISER_SECRET])
def test_production_rejects_unsafe_prioritiser_secret(monkeypatch, prioritiser_secret):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "PRIORITISER_SECRET", prioritiser_secret)
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")

    with pytest.raises(RuntimeError, match="PRIORITISER_SECRET"):
        validate_runtime_settings()


def test_production_accepts_explicit_secrets(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://dmb:test@db/dmb_backlog")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", Path("Z:/dmb-shared/attachments"))
    monkeypatch.setattr(settings, "CLAMAV_HOST", "clamav")
    validate_runtime_settings()


def test_production_rejects_sqlite_and_instance_local_attachments(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "sqlite:///local.db")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", settings.BASE_DIR / "uploads")

    with pytest.raises(RuntimeError, match="DATABASE_URL.*ATTACHMENT_STORAGE_DIR"):
        validate_runtime_settings()


def test_production_requires_redis(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", None)
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        validate_runtime_settings()


def test_production_rejects_unsafe_outbox_dead_letter_policy(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://dmb:test@db/dmb_backlog")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", Path("Z:/dmb-shared/attachments"))
    monkeypatch.setattr(settings, "OUTBOX_MAX_ATTEMPTS", 0)
    monkeypatch.setattr(settings, "OUTBOX_RETENTION_DAYS", 7)
    monkeypatch.setattr(settings, "OUTBOX_DEAD_LETTER_RETENTION_DAYS", 3)
    with pytest.raises(RuntimeError, match="OUTBOX_MAX_ATTEMPTS.*OUTBOX_DEAD_LETTER_RETENTION_DAYS"):
        validate_runtime_settings()


def test_production_rejects_startup_data_mutations(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://dmb:test@db/dmb_backlog")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", Path("Z:/dmb-shared/attachments"))
    monkeypatch.setattr(settings, "RUN_STARTUP_SEED", True)
    monkeypatch.setattr(settings, "RUN_STARTUP_MAINTENANCE", True)
    with pytest.raises(RuntimeError, match="RUN_STARTUP_SEED.*RUN_STARTUP_MAINTENANCE"):
        validate_runtime_settings()


def test_production_requires_otel_endpoint_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://dmb:test@db/dmb_backlog")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", Path("Z:/dmb-shared/attachments"))
    monkeypatch.setattr(settings, "OTEL_ENABLED", True)
    monkeypatch.setattr(settings, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", None)
    with pytest.raises(RuntimeError, match="OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        validate_runtime_settings()


@pytest.mark.parametrize("ratio", [-0.01, 1.01])
def test_production_rejects_invalid_otel_sample_ratio(monkeypatch, ratio):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+psycopg://dmb:test@db/dmb_backlog")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", Path("Z:/dmb-shared/attachments"))
    monkeypatch.setattr(settings, "OTEL_ENABLED", True)
    monkeypatch.setattr(settings, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://collector:4318/v1/traces")
    monkeypatch.setattr(settings, "OTEL_TRACE_SAMPLE_RATIO", ratio)
    with pytest.raises(RuntimeError, match="OTEL_TRACE_SAMPLE_RATIO"):
        validate_runtime_settings()


@pytest.mark.parametrize("debug,expected", [(True, True), (False, False)])
def test_startup_data_operations_follow_debug_by_default(monkeypatch, debug, expected):
    monkeypatch.setattr(settings, "DEBUG", debug)
    monkeypatch.setattr(settings, "RUN_STARTUP_SEED", None)
    monkeypatch.setattr(settings, "RUN_STARTUP_MAINTENANCE", None)
    monkeypatch.setattr(settings, "RUN_NOTIFICATION_SCHEDULER", None)
    assert should_run_startup_seed() is expected
    assert should_run_startup_maintenance() is expected
    assert should_run_notification_scheduler() is expected


def test_startup_data_operations_can_be_explicitly_overridden(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "RUN_STARTUP_SEED", True)
    monkeypatch.setattr(settings, "RUN_STARTUP_MAINTENANCE", True)
    monkeypatch.setattr(settings, "RUN_NOTIFICATION_SCHEDULER", True)
    assert should_run_startup_seed() is True
    assert should_run_startup_maintenance() is True
    assert should_run_notification_scheduler() is True
