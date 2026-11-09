import hashlib
import threading
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, select

from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_api import router
from dmb_agent_contracts.run_store import Store, metadata, now
from dmb_agent_contracts.run_worker import execute


@pytest.fixture
def environment(tmp_path, monkeypatch):
    for key in list(__import__("os").environ):
        if key.startswith("DMB_AGENT_LIMITER_") or key == "DMB_AGENT_REQUIRE_LIMITER":
            monkeypatch.delenv(key)
    url = os.environ.get("AGENT_RUN_TEST_DATABASE_URL")
    engine = create_engine(url or "sqlite:///"+str(tmp_path/"runs.sqlite"),
        connect_args={} if url else {"check_same_thread": False})
    if url:
        from sqlalchemy import inspect
        assert set(inspect(engine).get_table_names()) <= {"agent_runs", "agent_run_events", "synthetic_product"}
    metadata.create_all(engine)
    product = Table("synthetic_product", MetaData(), Column("value", Integer))
    product.metadata.create_all(engine)
    store = Store(engine)
    app = FastAPI()

    @app.exception_handler(AgentError)
    async def error(request, exception):
        return JSONResponse(status_code=exception.status, content={"error": {"code": exception.code}})

    def authenticate(x_actor_ref: str = Header(default=""), x_agent_secret: str = Header(default="")):
        if x_agent_secret != "synthetic":
            raise AgentError("service_auth_required", 401)
        if not x_actor_ref:
            raise AgentError("operation_forbidden", 403)
        return "dmb", x_actor_ref

    def validate(body):
        if body["operation"] != "synthetic.test":
            raise AgentError("unsupported_operation", 422)

    app.include_router(router(store=store, authenticate=authenticate, validate=validate,
        profile=lambda: {"name": "synthetic"}, capabilities=lambda: {"service_id": "fixture"}))
    with TestClient(app) as client:
        yield client, store, product
    product.drop(engine)
    metadata.drop_all(engine)
    engine.dispose()


def request_body():
    return {"contract_version": "1.0", "operation": "synthetic.test", "conversation_ref": None,
        "source": {"kind": "fixture", "ref": "opaque", "revision": 1,
            "snapshot_hash": "sha256:"+hashlib.sha256(b"fixture").hexdigest()}, "input": {"text": "fixture"}}


def headers(actor="one"):
    return {"X-Agent-Secret": "synthetic", "X-Actor-Ref": actor, "Idempotency-Key": "synthetic-key"}


def test_acceptance_replay_scope_and_cancel_tombstone(environment):
    client, store, _ = environment
    url = "/internal/agent/v1/runs"
    response = client.post(url, json=request_body(), headers=headers())
    assert response.status_code == 202
    accepted = response.json()
    assert client.post(url, json=request_body(), headers=headers()).json()["run_id"] == accepted["run_id"]
    changed = request_body()
    changed["input"]["text"] = "different"
    assert client.post(url, json=changed, headers=headers()).status_code == 409
    location = response.headers["Location"]
    assert client.get(location, headers=headers("other")).status_code == 404
    assert client.get(location).status_code == 401
    assert client.get(location+"/result", headers=headers()).status_code == 409
    assert client.post(location+"/cancel", headers=headers()).json()["status"] == "cancelled"
    assert client.post(location+"/cancel", headers=headers()).status_code == 200
    assert client.post(location+"/acknowledgements", headers=headers()).status_code == 200
    assert "cancelled" in client.get(location+"/events", headers=headers()).text
    tombstone = client.post(url+"/cancellations", json=request_body(), headers=headers("late"))
    late = client.post(url, json=request_body(), headers=headers("late"))
    assert late.status_code == 200 and late.json()["run_id"] == tombstone.json()["run_id"]
    assert late.json()["status"] == "cancelled"


def test_worker_commits_product_with_result(environment):
    client, store, product = environment
    response = client.post("/internal/agent/v1/runs", json=request_body(), headers=headers())
    row = store.claim()
    def handler(row, connection):
        connection.execute(product.insert().values(value=7))
        return {"value": 7}
    execute(store, row, handler)
    result = client.get(response.headers["Location"]+"/result", headers=headers())
    assert result.status_code == 200 and result.json()["result"] == {"value": 7}
    with store.engine.connect() as connection:
        assert connection.scalar(select(product.c.value)) == 7


def test_cancel_before_final_cas_discards_staged_product(environment):
    client, store, product = environment
    response = client.post("/internal/agent/v1/runs", json=request_body(), headers=headers())
    row = store.claim()
    def handler(row, connection):
        # Cancellation commits on an independent connection before any product write.
        current = store.get(row["id"])
        assert store.transition(current, "cancelled", finished_at=now())
        connection.execute(product.insert().values(value=99))
        return {"value": 99}
    execute(store, row, handler)
    assert client.get(response.headers["Location"], headers=headers()).json()["status"] == "cancelled"
    with store.engine.connect() as connection:
        assert connection.scalar(select(product.c.value)) is None


def test_postgresql_cancel_while_domain_write_is_uncommitted(environment):
    client, store, product = environment
    if store.engine.dialect.name != "postgresql":
        pytest.skip("Independent transaction cancellation requires disposable PostgreSQL")
    response = client.post("/internal/agent/v1/runs", json=request_body(), headers=headers())
    row = store.claim()
    staged, release = threading.Event(), threading.Event()
    def handler(row, connection):
        connection.execute(product.insert().values(value=99))
        staged.set()
        assert release.wait(5)
        return {"value": 99}
    thread = threading.Thread(target=execute, args=(store, row, handler))
    thread.start()
    try:
        assert staged.wait(5)
        assert client.post(response.headers["Location"]+"/cancel", headers=headers()).status_code == 200
    finally:
        release.set()
        thread.join(timeout=5)
    assert not thread.is_alive()
    with store.engine.connect() as connection:
        assert connection.scalar(select(product.c.value)) is None
    assert store.get(row["id"])["status"] == "cancelled"
