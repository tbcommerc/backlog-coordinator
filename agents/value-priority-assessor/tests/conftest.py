"""Общие фикстуры тестов.

Каждый тест получает свою SQLite-базу во временном каталоге: тесты правят
справочники и задачи, и делить одну базу между ними означало бы ловить
зависимость от порядка выполнения.
"""

from __future__ import annotations

import datetime as dt

import pytest

from value_priority_assessor.config import get_settings
from value_priority_assessor.core import db as db_module
from value_priority_assessor.core.models import Task
from value_priority_assessor.core.references import ReferenceBundle


@pytest.fixture()
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("PRIORITISER_DB_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("PRIORITISER_LLM_PROVIDER", "mock")
    monkeypatch.setenv("PRIORITISER_STRATEGY_PROVIDER", "stub")
    get_settings.cache_clear()
    db_module.reset_engine()
    db_module.init_db(drop=True)

    from value_priority_assessor.core.references import seed_references

    factory = db_module.get_session_factory()
    with factory() as sess:
        seed_references(sess)
        sess.commit()

    with factory() as sess:
        yield sess
        sess.commit()

    db_module.reset_engine()
    get_settings.cache_clear()


@pytest.fixture()
def refs(session) -> ReferenceBundle:
    return ReferenceBundle(session)


@pytest.fixture()
def today() -> dt.date:
    """Фиксированная «сегодня»: фактор срочности иначе зависит от даты прогона."""
    return dt.date(2026, 8, 10)


def make_task(**kwargs) -> Task:
    """Задача с безопасными значениями по умолчанию."""
    defaults = dict(
        task_key="TASK-TEST-001",
        team="Core",
        team_class="serving",
        title="Тестовая задача",
        task_type="AD-HOC",
        involved_teams_count=0,
        is_regulatory=False,
        is_rnd=False,
        is_blocking=False,
        value_confidence="medium",
        raw={},
        factor_scores={},
        factor_contributions={},
        applied_overrides=[],
        value_inputs={},
    )
    defaults.update(kwargs)
    return Task(**defaults)
