import hashlib
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine, select, func, text
from sqlalchemy.orm import Session
from value_priority_assessor.core.models import Base, Task, LlmCall, AgentRequest, FactorAssessment
from value_priority_assessor.migrate_state import ALLOWED, migrate, readonly_sqlite, require_matching_references


def create_history_tables(engine):
    for table in Base.metadata.sorted_tables:
        if table.name in ALLOWED:
            table.create(engine)


def populate(engine):
    with Session(engine) as session:
        session.add(Task(id=41, task_key="SYNTHETIC", title="Synthetic", value_manual_mln=12.5, value_internal_mln=12.5))
        session.flush()
        session.add(FactorAssessment(id=12, task_id=41, factor="F5_strategy_fit", score=7, payload={"answers": {"synthetic": "direct"}},
            provider="synthetic", actor="strategy-analyst", rubric_version=3, is_active=False))
        session.add(LlmCall(id=5, provider="synthetic", purpose="synthetic", prompt_hash="x"*64, prompt="Synthetic", response='{"ok":true}',
            tokens_in=2, tokens_out=3, created_at=datetime(2026, 11, 2, tzinfo=timezone.utc)))
        session.add(AgentRequest(id=9, request_id="synthetic-request", request_type="value", task_key="SYNTHETIC", cache_key="c"*64,
            attributes={"title": "Synthetic"}, response={"value": 12.5}, reference_versions={"synthetic": 3}, snapshot_version="synthetic-1"))
        session.commit()


@pytest.fixture
def databases(tmp_path):
    path = tmp_path/"source.db"
    writable = create_engine("sqlite:///"+path.as_posix())
    create_history_tables(writable)
    populate(writable)
    writable.dispose()
    source = readonly_sqlite(path)
    target = create_engine("sqlite://")
    create_history_tables(target)
    yield source, target, path
    source.dispose()
    target.dispose()


def test_dry_run_copy_hashes_and_replay_preserve_history(databases):
    source, target, path = databases
    original = hashlib.sha256(path.read_bytes()).hexdigest()
    plan = migrate(source, target)
    assert not plan["applied"]
    with target.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(Task)) == 0
    result = migrate(source, target, apply=True)
    assert result["applied"] and result["protected_reference_writes"] == 0
    assert result["tables"] == plan["tables"]
    assert migrate(source, target, apply=True)["replayed"]
    with Session(target) as session:
        assert session.get(Task, 41).value_manual_mln == 12.5
        assert session.get(FactorAssessment, 12).actor == "strategy-analyst"
        assert not session.get(FactorAssessment, 12).is_active
        assert session.get(AgentRequest, 9).reference_versions == {"synthetic": 3}
    assert hashlib.sha256(path.read_bytes()).hexdigest() == original


def test_nonempty_different_target_is_not_overwritten(databases):
    source, target, _ = databases
    with Session(target) as session:
        session.add(Task(id=1, task_key="OTHER", title="Keep"))
        session.commit()
    with pytest.raises(RuntimeError, match="nonempty_target_history_conflict"):
        migrate(source, target, apply=True)
    with Session(target) as session:
        assert session.get(Task, 1).title == "Keep"


def test_reference_mismatch_is_a_hard_boundary_without_protected_writes():
    # Mock reference snapshots only: no reference entities are created in a DB.
    with pytest.raises(RuntimeError, match="protected_reference_mismatch"):
        require_matching_references([{"name": "synthetic", "version": 1}], [])


def test_row_budget_refused_before_copy(databases):
    with pytest.raises(RuntimeError, match="migration_row_budget_exceeded"):
        migrate(databases[0], databases[1], apply=True, max_rows=1)
    with databases[1].connect() as conn:
        assert conn.scalar(select(func.count()).select_from(Task)) == 0
