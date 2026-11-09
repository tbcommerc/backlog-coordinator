"""Only isolated random technical schemas in explicitly supplied PostgreSQL."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text, select, func
from sqlalchemy.orm import Session
from value_priority_assessor import remote_tools as tools
from value_priority_assessor.core.models import Task, FactorAssessment

RUBRIC = {"strategy_fit": {"rubric_version": 1, "criteria": [{"id": "synthetic", "weight": 1,
    "options": {"direct": {"value": 1}}}], "scale": {"raw_min": 1, "raw_max": 10}},
    "dependencies": {"rubric_version": 1, "base_score": 1, "floor": 0.2, "types": {}}}


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("ASSESSOR_TOOL_TEST_DATABASE_URL")
    if not url or not url.startswith("postgresql+psycopg://"):
        pytest.skip("Explicit disposable ASSESSOR_TOOL_TEST_DATABASE_URL required")
    schema = "tool_test_"+uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": "-csearch_path="+schema})
    try:
        for table in (Task.__table__, FactorAssessment.__table__):
            table.create(engine)
        from dmb_agent_contracts.run_store import metadata as run_metadata
        run_metadata.create_all(engine)
        import importlib.util
        from pathlib import Path
        path = Path(__file__).parents[1]/"alembic/versions/20261102_01_remote_tools.py"
        spec = importlib.util.spec_from_file_location("frozen_tool_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with engine.begin() as connection:
            monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
            migration.upgrade()
            migration.upgrade()  # Existing technical schema is left intact.
        monkeypatch.setattr(tools, "get_reference", lambda *_: RUBRIC)
        monkeypatch.setattr(tools, "recompute_factor_priority", lambda *_a, **_k: None)
        with Session(engine) as session:
            task = Task(task_key="SYNTHETIC", title="Synthetic", raw={})
            session.add(task)
            session.commit()
            request = tools.GrantRequest(run_id=uuid4(), subject="synthetic", role="strategy-analyst",
                                        task_key=task.task_key, source_hash=tools.source_hash(task))
            from dmb_agent_contracts.run_store import runs
            from datetime import timedelta
            session.execute(runs.insert().values(id=str(request.run_id),caller="dmb",actor="synthetic",
                key=str(request.run_id),request_hash="0"*64,input={},profile={},trusted_context={},
                source={"kind":"work_item","ref":task.task_key},operation="priority.estimate",
                status="running",version=1,delivery="accepted",created_at=tools.now(),
                deadline_at=tools.now()+timedelta(seconds=180),result_expired=0))
            issued = tools.issue(session, request)
            session.commit()
        yield engine, request, issued
    finally:
        engine.dispose()
        with admin.begin() as conn:
            assert schema.startswith("tool_test_") and len(schema) == 42
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def call(database, rationale="Synthetic"):
    engine, request, issued = database
    with Session(engine) as session:
        result = tools.execute(session, issued["token"], tools.ToolCall(run_id=request.run_id,
            call_id="call", operation="strategy-assess", answers={"synthetic": "direct"}, rationale=rationale))
        session.commit()
        return result


def count(database, model):
    with Session(database[0]) as session:
        return session.scalar(select(func.count()).select_from(model))


def promote(database):
    from dmb_agent_contracts.run_store import runs
    with Session(database[0]) as session:
        result = tools.promote_staged(session,database[1].run_id)
        session.execute(runs.update().where(runs.c.id==str(database[1].run_id)).values(status="completed",version=2))
        session.commit()
        return result


def test_concurrent_delivery_stages_one_receipt_without_active_write(database):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: call(database), range(8)))
    assert all(result == results[0] for result in results)
    assert count(database, FactorAssessment) == 0 and count(database, tools.receipts) == 1
    assert promote(database)
    assert count(database, FactorAssessment) == 1


def test_changed_body_conflicts_without_second_write(database):
    call(database)
    with pytest.raises(HTTPException) as error:
        call(database, rationale="Different")
    assert error.value.status_code == 409
    assert count(database, FactorAssessment) == 0
    assert promote(database)
    assert count(database, FactorAssessment) == 1


def test_failure_after_flush_rolls_back_factor_and_receipt(database, monkeypatch):
    def crash(*_args, **_kwargs):
        raise RuntimeError("synthetic_crash_before_receipt")
    monkeypatch.setattr(tools, "recompute_factor_priority", crash)
    call(database)
    with pytest.raises(RuntimeError, match="synthetic_crash"):
        promote(database)
    assert count(database, FactorAssessment) == 0 and count(database, tools.receipts) == 1
    with Session(database[0]) as session:
        assert session.scalar(select(Task)).strategy_fit_raw is None
    monkeypatch.setattr(tools, "recompute_factor_priority", lambda *_a, **_k: None)
    assert call(database)["assessment"]["raw_score"] == 10
    assert promote(database)
    assert count(database, FactorAssessment) == 1


def test_revocation_blocks_writes(database):
    with Session(database[0]) as session:
        session.execute(tools.grants.update().where(tools.grants.c.id == database[2]["grant_id"]).values(revoked_at=tools.now()))
        session.commit()
    with pytest.raises(HTTPException) as error:
        call(database)
    assert error.value.status_code == 401
    assert count(database, FactorAssessment) == 0


def test_sqlite_history_to_postgres_preserves_hashes_scores_and_sequences(tmp_path):
    import datetime as dt
    from value_priority_assessor.core.models import Base, LlmCall, AgentRequest
    from value_priority_assessor.migrate_state import ALLOWED, migrate, readonly_sqlite
    from value_priority_assessor.core.references import ReferenceBundle
    from value_priority_assessor.core.scoring import score_task, ScoringContext
    url = os.environ.get("ASSESSOR_TOOL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL required")
    schema = "tool_test_"+uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    target = create_engine(url, connect_args={"options": "-csearch_path="+schema})
    path = tmp_path/"synthetic-history.db"
    writable = create_engine("sqlite:///"+path.as_posix())
    source = None
    try:
        for table in Base.metadata.sorted_tables:
            if table.name in ALLOWED:
                table.create(writable)
                table.create(target)
        with Session(writable) as session:
            session.add(Task(id=41, task_key="SYNTHETIC", title="Synthetic", team_class="serving",
                value_manual_mln=5, value_internal_mln=5, effort_man_days=1, strategy_fit_raw=4, dependency_score=0.7))
            session.add(LlmCall(id=5, provider="synthetic", purpose="synthetic", prompt_hash="f"*64, prompt="Synthetic", response="Synthetic"))
            session.add(AgentRequest(id=9, request_id="synthetic", request_type="value", task_key="SYNTHETIC", cache_key="a"*64,
                                     attributes={"synthetic": True}, response={"value": 5}))
            session.commit()
            before = score_task(session.get(Task, 41), ReferenceBundle(None), ScoringContext(max_value_mln=5, today=dt.date(2026,11,2)))
        writable.dispose()
        source = readonly_sqlite(path)
        result = migrate(source, target, apply=True)
        assert result["applied"] and result["protected_reference_writes"] == 0
        assert migrate(source, target, apply=True)["replayed"]
        with Session(target) as session:
            task = session.get(Task,41)
            after = score_task(task, ReferenceBundle(None), ScoringContext(max_value_mln=5, today=dt.date(2026,11,2)))
            assert before == after
            assert session.get(AgentRequest,9).response == {"value":5}
            new = Task(task_key="SYNTHETIC-NEXT",title="Synthetic next")
            session.add(new)
            session.flush()
            assert new.id == 42
    finally:
        if source is not None:
            source.dispose()
        writable.dispose()
        target.dispose()
        with admin.begin() as conn:
            assert schema.startswith("tool_test_") and len(schema)==42
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
