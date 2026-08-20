import pytest

from config import (
    DEFAULT_AGENT_SECRET,
    DEFAULT_SECRET_KEY,
    settings,
    should_run_startup_maintenance,
    should_run_startup_seed,
    should_run_notification_scheduler,
    validate_runtime_settings,
)


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


def test_production_accepts_explicit_secrets(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    validate_runtime_settings()


def test_production_requires_redis(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SECRET_KEY", "s" * 32)
    monkeypatch.setattr(settings, "AGENT_SECRET", "unique-agent-secret")
    monkeypatch.setattr(settings, "REDIS_URL", None)
    with pytest.raises(RuntimeError, match="REDIS_URL"):
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
