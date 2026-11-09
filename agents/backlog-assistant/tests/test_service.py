import asyncio
import json
import time
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.pool import StaticPool
from contracts.models import Context, Answer
from fixtures.data import FakeData
from runtime.fake import FakeRuntime
from backlog_assistant.app import create_app
from backlog_assistant.security import sign, Identity
from backlog_assistant.store import Store, StoreError, metadata, runs
from backlog_assistant.worker import Worker

SECRET = "synthetic-test-only-" + "x" * 32


@pytest.fixture
def setup():
    # No DMB tables, no protected rows. SQLite is ONLY this unit-test engine.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    metadata.create_all(engine)
    store, data, runtime = Store(engine), FakeData(), FakeRuntime()
    return store, data, runtime


def send(client, method, path, body=None, subject="one", key="", proof="synthetic-current-read"):
    raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
    token = sign(SECRET, subject, method, path, raw, key)
    return client.request(method, path, content=raw, headers={"X-Gateway-Attestation": token,
        "Idempotency-Key": key, "X-Read-Proof": proof, "Content-Type": "application/json"})


def queued(setup, subject="one", key="question"):
    store, data, runtime = setup
    owner = Identity("dmb", subject).owner
    context = Context().model_dump(mode="json")
    session = store.create(owner, key, {"context": context})
    execution = data.register(owner)
    body = {"text": "Найди работу", "context_revision": 1, "context": context, "execution_ref": execution}
    return store.enqueue(owner, session["id"], key, body)


def test_attestation_tampering_and_replay(setup):
    s, d, r = setup
    client = TestClient(create_app(s, d, r, SECRET, run_workers=False))
    token = sign(SECRET, "one", "GET", "/v1/sessions")
    assert client.get("/v1/sessions", headers={"X-Gateway-Attestation": token}).status_code == 200
    assert client.get("/v1/sessions", headers={"X-Gateway-Attestation": token}).status_code == 401
    assert client.get("/v1/capabilities", headers={"X-Gateway-Attestation": token}).status_code == 401
    assert client.get("/v1/sessions").status_code == 401


def test_session_idempotency_ownership_and_revision(setup):
    s, d, r = setup
    client = TestClient(create_app(s, d, r, SECRET, run_workers=False))
    created = send(client, "POST", "/v1/sessions", {}, key="create").json()
    assert send(client, "POST", "/v1/sessions", {}, key="create").json()["id"] == created["id"]
    assert send(client, "POST", "/v1/sessions", {"context": {"surface": "task"}}, key="create").status_code == 409
    path = "/v1/sessions/" + created["id"]
    assert send(client, "GET", path, subject="two").status_code == 404
    assert send(client, "PATCH", path, {"context_revision": 99}).status_code == 409
    assert send(client, "POST", "/v1/sessions", {"user_id": 7}, key="bad").status_code == 422


@pytest.mark.asyncio
async def test_end_to_end_and_history_revocation(setup):
    s, d, r = setup
    row = queued(setup)
    worker = Worker(s, d, r)
    claim = s.claim(worker.id)
    assert s.claim("other") is None
    await worker.execute(claim)
    stored = s.get_run(row["owner"], row["id"])
    assert stored["status"] == "completed"
    assert not r.instances and d.executions[row["execution_ref"]]["revoked"]
    client = TestClient(create_app(s, d, r, SECRET, run_workers=False))
    path = "/v1/runs/" + row["id"]
    response = send(client, "GET", path).json()
    assert response["answer"]["verified_blocks"][0]["total"] == 1
    assert "execution_ref" not in response and "handle" not in response
    d.revoked_owners.add(row["owner"])
    assert send(client, "GET", path).json()["answer"] is None


def test_message_dedup_and_conflicts(setup):
    s, d, r = setup
    row = queued(setup)
    assert s.enqueue(row["owner"], row["session_id"], row["key"], row["input"])["id"] == row["id"]
    with pytest.raises(StoreError, match=""):
        s.enqueue(row["owner"], row["session_id"], row["key"], dict(row["input"], text="other"))
    with pytest.raises(StoreError):
        s.enqueue(row["owner"], row["session_id"], "second", dict(row["input"], execution_ref=d.register(row["owner"])))


@pytest.mark.asyncio
async def test_revoke_during_candidate_prevents_publication(setup):
    s, d, r = setup
    row = queued(setup)
    original = r.collect
    async def revoked(handle):
        value = await original(handle)
        d.revoked_owners.add(row["owner"])
        return value
    r.collect = revoked
    worker = Worker(s, d, r)
    await worker.execute(s.claim(worker.id))
    stored = s.get_run(row["owner"], row["id"])
    assert stored["answer"] is None and stored["status"] == "failed"
    assert not r.instances


def test_expired_lease_never_redispatches(setup):
    s, d, r = setup
    row = queued(setup)
    assert s.claim("worker")
    with s.engine.begin() as c:
        c.execute(update(runs).where(runs.c.id == row["id"]).values(lease_until=time.time()-1, dispatch_state="unknown"))
    assert s.claim("replacement") is None
    assert s.get_run(row["owner"], row["id"])["status"] == "interrupted"


@pytest.mark.asyncio
async def test_cancel_queued_and_delete_purges(setup):
    s, d, r = setup
    row = queued(setup)
    s.cancel(row["owner"], row["id"])
    assert s.claim("worker") is None
    s.remove(row["owner"], row["session_id"])
    await Worker(s, d, r).janitor()
    assert s.list_sessions(row["owner"]) == []


@pytest.mark.asyncio
async def test_history_quotes_require_current_evidence_access(setup):
    store, data, runtime = setup
    row = queued(setup)
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    client = TestClient(create_app(store, data, runtime, SECRET, run_workers=False))
    result = send(client, "GET", "/v1/runs/"+row["id"]).json()
    assert result["text"] == row["input"]["text"]
    async def revoked(*args):
        raise ValueError("revoked")
    data.validate = revoked
    denied = send(client, "GET", "/v1/runs/"+row["id"]).json()
    assert "text" not in denied and denied["answer"] is None


@pytest.mark.parametrize('audience,ttl', [('another-service',30),('backlog-assistant',-1)])
def test_wrong_audience_or_expired_attestation_never_reaches_store_or_tools(setup,audience,ttl):
    from sqlalchemy import func
    from backlog_assistant.store import nonces
    store,data,runtime=setup
    client=TestClient(create_app(store,data,runtime,SECRET,run_workers=False))
    token=sign(SECRET,'one','GET','/v1/sessions',audience=audience,ttl=ttl)
    response=client.get('/v1/sessions',headers={'X-Gateway-Attestation':token})
    assert response.status_code==401
    with store.engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(nonces))==0
    assert not data.executions and not runtime.instances
