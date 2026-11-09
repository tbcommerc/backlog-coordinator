"""Only technical run/history rows in an explicitly supplied disposable database."""
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, select


@pytest.mark.parametrize("cancel", [False, True])
def test_assessor_history_joins_run_publication(monkeypatch, cancel):
    url = os.environ.get("ASSESSOR_RUN_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL required")
    monkeypatch.setenv("PRIORITISER_DATABASE_URL", url)
    from value_priority_assessor.config import get_settings
    from value_priority_assessor.core.db import reset_engine
    get_settings.cache_clear()
    reset_engine()
    from value_priority_assessor import runs as service
    from value_priority_assessor.core.models import AgentRequest
    from dmb_agent_contracts.run_store import Store, metadata, now, fingerprint
    from dmb_agent_contracts.run_worker import execute
    engine = create_engine(url)
    from value_priority_assessor import remote_tools
    assert set(inspect(engine).get_table_names()) <= {"agent_runs", "agent_run_events", "agent_request", "agent_tool_grants", "agent_tool_receipts"}
    metadata.create_all(engine)
    remote_tools.grants.create(engine, checkfirst=True)
    remote_tools.receipts.create(engine, checkfirst=True)
    AgentRequest.__table__.create(engine, checkfirst=True)
    store = Store(engine)
    body = {"operation": "value.estimate", "source": {"kind": "work_item", "ref": "synthetic"},
        "input": {"task_id": "synthetic", "task_type": "research", "team": "synthetic", "title": "Synthetic"}}
    request_id = uuid4().hex

    class Response:
        status = "ok"
        def model_dump(self, **options):
            return {"status": "ok", "synthetic": True}

    def calculate(attributes, request_type, session):
        if cancel:
            current = store.get(row["id"])
            assert store.transition(current, "cancelled", finished_at=now())
        session.add(AgentRequest(request_id=request_id, cache_key="synthetic", request_type="value",
            task_key="synthetic", attributes={}, response={"synthetic": True}, drivers={}, reference_versions={}))
        return Response()

    monkeypatch.setattr(service, "handle_request", calculate)
    row, _ = store.create("dmb", "synthetic-actor", request_id, body, service.profile(), 180, 8)
    execute(store, store.claim(), service.handle)
    assert store.get(row["id"])["status"] == ("cancelled" if cancel else "completed")
    with engine.connect() as connection:
        present = connection.scalar(select(AgentRequest.request_id).where(AgentRequest.request_id == request_id))
        assert bool(present) is (not cancel)
    AgentRequest.__table__.drop(engine)
    remote_tools.receipts.drop(engine)
    remote_tools.grants.drop(engine)
    metadata.drop_all(engine)
    engine.dispose()
