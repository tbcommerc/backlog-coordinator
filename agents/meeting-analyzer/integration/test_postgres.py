"""Only technical tables in an explicitly supplied disposable database."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import create_engine, select, text
import pytest
from dmb_agent_contracts.model import AgentError
from meeting_analyzer.store import Store, metadata, runs, events, now
from meeting_analyzer.migrate import migrate


@pytest.fixture
def store():
    url = os.environ.get("MEETING_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Explicit disposable MEETING_TEST_POSTGRES_URL required")
    engine = create_engine(url)
    with engine.connect() as conn:
        # Never reset an existing database containing application tables.
        from sqlalchemy import inspect
        assert set(inspect(conn).get_table_names()) <= set(metadata.tables)
    migrate(engine)
    with engine.begin() as conn:
        conn.execute(events.delete())
        conn.execute(runs.delete())
    yield Store(engine)
    engine.dispose()


def create(store, key="key", actor="actor", **kwargs):
    return store.create("dmb", actor, key, {"input": {"transcript": "Synthetic"},
        "source": {"ref": "synthetic", "revision": 1}}, {"model": "synthetic"}, 300, kwargs.get("limit", 100))


def test_concurrent_idempotency(store):
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda _: create(store), range(10)))
    assert len({r[0]["id"] for r in results}) == 1
    assert sum(not replay for _, replay in results) == 1


def test_claim_has_one_owner(store):
    create(store)
    with ThreadPoolExecutor(max_workers=5) as pool:
        claims = list(pool.map(lambda _: store.claim(), range(5)))
    assert sum(row is not None for row in claims) == 1


def test_create_and_cancel_key_race_never_leaves_executable_run(store):
    body = {"input": {"transcript": "Synthetic"}, "source": {"ref": "synthetic", "revision": 1}}
    profile = {"model": "synthetic"}
    def execute(action):
        if action == "cancel":
            return store.cancel_key("dmb", "actor", "race", body, profile, 300)[0]
        return store.create("dmb", "actor", "race", body, profile, 300, 100)[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, ["create", "cancel"]))
    assert len({row["id"] for row in results}) == 1
    assert store.get(results[0]["id"])["status"] == "cancelled"
    assert store.claim() is None


def test_trusted_deadline_is_persisted_and_replay_cannot_extend_it(store):
    deadline = now() + timedelta(seconds=20)
    body = {"input": {"transcript": "Synthetic"}, "source": {"ref": "synthetic", "revision": 1}}
    row, replay = store.create("dmb", "actor", "deadline", body, {"model": "synthetic"}, 300, 100, deadline_at=deadline)
    assert not replay and store.get(row["id"])["deadline_at"] == deadline
    same, replay = store.create("dmb", "actor", "deadline", body, {"model": "synthetic"}, 300, 100,
        deadline_at=now() + timedelta(seconds=200))
    assert replay and same["deadline_at"] == deadline
    with pytest.raises(AgentError, match="operation_deadline_exceeded"):
        store.create("dmb", "actor", "expired", body, {}, 300, 100, deadline_at=now()-timedelta(seconds=1))


def test_real_transport_boundary_shares_persisted_worker_operation(store):
    import httpx
    from dmb_agent_contracts.go import GoModel
    from dmb_agent_contracts.operation import current_operation
    from meeting_analyzer.worker import execute
    row, _ = create(store)
    claimed = store.claim()
    observed = []
    def provider(request):
        operation = current_operation()
        observed.append((str(operation.run_id), operation.model_attempts, operation.deadline_at))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"items":[]}'}, "finish_reason": "stop"}], "model": "synthetic"})
    with httpx.Client(transport=httpx.MockTransport(provider)) as client:
        model = GoModel(base_url="https://opencode.ai/zen/go/v1", api_key="synthetic", model="synthetic", client=client)
        execute(store, claimed, model)
    assert observed == [(row["id"], 1, row["deadline_at"])]
    assert store.get(row["id"])["status"] == "completed"
    assert current_operation() is None


def test_cancel_completion_race(store):
    row, _ = create(store)
    row = validating(store, store.claim())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda status: store.transition(row, status, finished_at=now()), ["completed", "cancelled"]))
    assert sum(r is not None for r in results) == 1
    assert store.transition(row, "completed") is None


def test_restart_unknown_delivery_fencing(store):
    row, _ = create(store)
    claimed = store.transition(store.claim(), "preparing")
    intent = store.transition(claimed, "running", delivery="unknown", dispatch_ref="synthetic-dispatch",
                              deadline_at=now()-timedelta(seconds=1))
    recovered = Store(store.engine)
    recovered.expire()
    assert recovered.claim() is None
    assert recovered.get(row["id"])["status"] == "interrupted"
    assert store.transition(intent, "validating", delivery="accepted") is None


def test_durable_result_and_receipt(store):
    row, _ = create(store)
    payload = {"items": [{"id": "stable"}]}
    store.transition(validating(store, row), "completed", result=payload, payload_hash="stablehash", finished_at=now())
    recovered = Store(store.engine)
    replay, is_replay = create(recovered)
    assert is_replay and replay["result"] == payload
    assert recovered.get(row["id"])["payload_hash"] == "stablehash"


def test_queue_admission_across_connections(store):
    def attempt(i):
        try:
            create(store, key=str(i), limit=2)
            return "accepted"
        except AgentError as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(attempt, range(10)))
    assert results.count("accepted") == 2
    assert results.count("queue_full") == 8


def test_migration_refuses_unknown_schema_before_ddl(store):
    with store.engine.begin() as conn:
        conn.execute(text("CREATE TABLE unexpected_technical_fixture (id integer)"))
    try:
        with pytest.raises(RuntimeError, match="Unexpected meeting schema"):
            migrate(store.engine)
    finally:
        with store.engine.begin() as conn:
            conn.execute(text("DROP TABLE unexpected_technical_fixture"))


def validating(store, row):
    for status in ("preparing", "running", "validating"):
        if row["status"] == status:
            continue
        order = ["queued", "preparing", "running", "validating"]
        if order.index(row["status"]) < order.index(status):
            row = store.transition(row, status)
    return row


def test_retention_minimal_tombstone_without_redispatch(store):
    row, _ = create(store)
    row = validating(store, row)
    store.transition(row, "completed", result={"items":[]}, finished_at=now()-timedelta(days=8))
    with store.engine.begin() as conn:
        conn.execute(runs.update().where(runs.c.id==row["id"]).values(created_at=now()-timedelta(days=8)))
    store.expire()
    tombstone = store.get(row["id"])
    assert tombstone["input"] is None and tombstone["source"]=={} and tombstone["profile"]=={}
    assert tombstone["result"] is None and tombstone["result_expired"]==1
    with pytest.raises(AgentError, match="result_expired"):
        create(store)
    with store.engine.connect() as conn:
        assert not conn.execute(select(events).where(events.c.run_id==row["id"])).first()


def test_retention_deletes_only_after_both_windows(store):
    row, _ = create(store)
    store.transition(validating(store,row), "completed", result={"items":[]}, finished_at=now()-timedelta(days=8))
    with store.engine.begin() as conn:
        conn.execute(runs.update().where(runs.c.id==row["id"]).values(created_at=now()-timedelta(days=20)))
    store.expire()
    with pytest.raises(AgentError, match="run_not_found"):
        store.get(row["id"])
    new, replayed = create(store)
    assert not replayed and new["id"] != row["id"]


def test_retention_keeps_active_and_emits_expiration_event(store):
    active, _ = create(store,key="active")
    with store.engine.begin() as conn:
        conn.execute(runs.update().where(runs.c.id==active["id"]).values(created_at=now()-timedelta(days=20)))
    complete, _ = create(store,key="complete")
    store.transition(validating(store,complete), "completed", result={"items":[]}, finished_at=now()-timedelta(days=8))
    policy_store = Store(store.engine, retention={"metadata_days":14})
    policy_store.expire()
    assert store.get(active["id"])["input"] is not None
    assert store.get(complete["id"])["error"]=="result_expired"
    with store.engine.connect() as conn:
        assert conn.execute(select(events).where(events.c.run_id==complete["id"],events.c.type=="result_expired")).first()
