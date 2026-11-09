"""Real Redis tests use an explicitly supplied disposable server and unique keys."""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

import pytest
from dmb_agent_contracts.limiter import LimiterConfig, Redis, RedisLimiter
from dmb_agent_contracts.model import AgentError


@pytest.fixture
def gate(tmp_path):
    url = os.environ.get("AGENT_LIMITER_TEST_REDIS_URL")
    if not url:
        pytest.skip("Explicit disposable Redis required")
    config = LimiterConfig(url, "qualification-"+uuid4().hex, uuid4().hex, tmp_path/"journal", queue_seconds=15)
    value = RedisLimiter(config)
    value.bootstrap(initialize=True)
    yield value
    # Only this fixture's unique namespace; never FLUSHDB or shared keys.
    value.client.command("DEL", *value.keys)


def test_ten_concurrent_operations_share_two_slots(gate):
    lock = threading.Lock()
    active, maximum = 0, 0
    paired = threading.Barrier(2)
    def operation(number):
        nonlocal active, maximum
        replica = RedisLimiter(gate.config)
        lease = replica.acquire(uuid4(), "actor-"+str(number % 3))
        try:
            lease.check()
            with lock:
                active += 1
                maximum = max(maximum, active)
            paired.wait(timeout=10)
            time.sleep(.08)
            with lock:
                active -= 1
        finally:
            lease.release()
        return number
    with ThreadPoolExecutor(max_workers=10) as pool:
        assert sorted(pool.map(operation, range(10))) == list(range(10))
    assert maximum == 2 and active == 0
    assert gate.client.command("HLEN", gate.keys[2]) == 0
    assert gate.client.command("ZCARD", gate.keys[3]) == 0


def test_standalone_cross_replica_limit_one(gate):
    separate = RedisLimiter(replace(gate.config, namespace=gate.config.namespace+"-single", limit=1, queue_seconds=1.5))
    separate.bootstrap(initialize=True)
    try:
        first = separate.acquire(uuid4(), "one")
        with pytest.raises(AgentError, match="operation_queue_timeout"):
            RedisLimiter(separate.config).acquire(uuid4(), "two")
        first.release()
        next_lease = separate.acquire(uuid4(), "two")
        next_lease.release()
    finally:
        separate.client.command("DEL", *separate.keys)


def test_active_ownership_has_no_ttl_and_waits_for_cleanup(gate):
    lease = gate.acquire(uuid4(), "actor")
    lease.hold_for_cleanup()
    lease.release()
    assert gate.client.command("TTL", gate.keys[2]) == -1
    assert gate.client.command("HLEN", gate.keys[2]) == 1
    assert json.loads(lease.path.read_text())["state"] == "resource_cleanup_pending"
    assert gate.recover_confirmed() == 0
    lease.confirm_cleanup()
    lease.release()
    assert gate.client.command("HLEN", gate.keys[2]) == 0


def test_missing_coordinator_fails_closed_and_never_discards_active_owner(gate):
    lease = gate.acquire(uuid4(), "actor")
    gate.client.command("DEL", gate.keys[0])
    try:
        with pytest.raises(AgentError, match="global_limiter_unavailable"):
            lease.check()
        with pytest.raises(AgentError, match="global_limiter_unavailable"):
            gate.acquire(uuid4(), "other")
        assert gate.client.command("HLEN", gate.keys[2]) == 1
        with pytest.raises(AgentError, match="epoch_missing"):
            gate.bootstrap()
        with pytest.raises(AgentError, match="limiter_recovery_required"):
            gate.bootstrap(initialize=True)
    finally:
        gate.client.command("SET", gate.keys[0], gate.config.epoch)
        gate.recover_confirmed()
        lease.release()


def test_other_replica_cannot_change_global_capacity(gate):
    other = RedisLimiter(replace(gate.config, limit=1))
    with pytest.raises(AgentError, match="profile_mismatch"):
        other.bootstrap()
    with pytest.raises(AgentError, match="global_limiter_unavailable"):
        other.acquire(uuid4(), "actor")


def test_unknown_acquisition_and_release_are_recovered_from_journal(gate):
    real = gate.client
    class LostResponses:
        def command(self, *args):
            if args[0] == "EVAL" and "return 'released'" in args[1]:
                raise AgentError("global_limiter_unavailable")
            if args[0] == "EVAL" and "local active=redis.call" in args[1]:
                real.command(*args)
                raise AgentError("global_limiter_unavailable")
            return real.command(*args)
    uncertain = RedisLimiter(gate.config, LostResponses())
    with pytest.raises(AgentError, match="global_limiter_unavailable"):
        uncertain.acquire(uuid4(), "actor")
    assert real.command("HLEN", gate.keys[2]) == 1
    records = [json.loads(p.read_text()) for p in gate.config.journal_dir.glob("*.json")]
    assert len(records) == 1 and records[0]["state"] == "cleanup_confirmed"
    assert gate.recover_confirmed() == 1
    assert real.command("HLEN", gate.keys[2]) == 0


def test_finite_queue_and_actor_backpressure(gate):
    bounded = RedisLimiter(replace(gate.config, queue_capacity=3, actor_queue_capacity=1, queue_seconds=4))
    # Separate epoch/namespace because profile is immutable after bootstrap.
    bounded = RedisLimiter(replace(bounded.config, namespace=gate.config.namespace+"-bounded"))
    bounded.bootstrap(initialize=True)
    first, second = bounded.acquire(uuid4(), "one"), bounded.acquire(uuid4(), "two")
    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(bounded.acquire, uuid4(), "waiting-actor")
        deadline = time.monotonic()+1
        while bounded.client.command("ZCARD", bounded.keys[3]) != 1:
            assert time.monotonic() < deadline
            time.sleep(.01)
        with pytest.raises(AgentError, match="actor_queue_full"):
            bounded.acquire(uuid4(), "waiting-actor")
        first.release()
        accepted = waiting.result(timeout=5)
        accepted.release()
    second.release()
    bounded.client.command("DEL", *bounded.keys)


def test_redis_errors_never_expose_url_credentials():
    with pytest.raises(AgentError) as error:
        Redis("redis://synthetic-private:synthetic-secret@127.0.0.1:1/0", timeout=.05).command("PING")
    assert str(error.value) == "global_limiter_unavailable"


def test_journal_path_cannot_be_forged(gate):
    from dmb_agent_contracts.limiter import Lease
    with pytest.raises(AgentError, match="limiter_journal_invalid"):
        Lease(gate, "../outside", "identity", str(uuid4()))


def configure_process(monkeypatch, gate):
    for name, value in {"MODE": "global", "REDIS_URL": gate.config.redis_url,
            "NAMESPACE": gate.config.namespace, "EPOCH": gate.config.epoch,
            "JOURNAL_DIR": str(gate.config.journal_dir)}.items():
        monkeypatch.setenv("DMB_AGENT_LIMITER_"+name, value)


def test_nested_parallel_model_attempts_hold_exactly_one_operation_slot(gate, monkeypatch):
    from dmb_agent_contracts.operation import operation_scope, reserve_model_attempt, submit_in_operation
    configure_process(monkeypatch, gate)
    with operation_scope(max_model_attempts=4, actor_ref="same-actor") as context:
        assert gate.client.command("HLEN", gate.keys[2]) == 1
        with operation_scope():
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = [submit_in_operation(pool, reserve_model_attempt) for _ in range(2)]
                assert sorted(f.result() for f in results) == [1, 2]
        assert context.model_attempts == 2
        assert gate.client.command("HLEN", gate.keys[2]) == 1
    assert gate.client.command("HLEN", gate.keys[2]) == 0


def test_context_does_not_release_unconfirmed_runtime_cleanup(gate, monkeypatch):
    from dmb_agent_contracts.operation import operation_scope
    configure_process(monkeypatch, gate)
    with operation_scope(actor_ref="actor") as context:
        context.hold_slot_for_cleanup()
    assert context.release_pending
    assert gate.client.command("HLEN", gate.keys[2]) == 1
    assert gate.recover_confirmed() == 0
    assert gate.confirm_run_cleanup(context.run_id) == 1
    assert gate.client.command("HLEN", gate.keys[2]) == 0


def test_http_abort_success_cannot_release_real_slot_before_owned_delete(gate,monkeypatch):
    import httpx
    from datetime import datetime,timedelta,timezone
    from dmb_agent_contracts.model import ModelRequest
    from dmb_agent_contracts.operation import operation_scope
    from dmb_agent_contracts.remote import RemoteOpenCode
    from dmb_agent_contracts.runtime import RuntimeHandle
    from dmb_agent_contracts.runtime_model import RuntimeModel
    from test_remote_http import CONFIG,SCHEMA,emulator
    configure_process(monkeypatch,gate)
    with emulator(cleanup_failure=True) as (url,state),httpx.Client(base_url=url,timeout=2,trust_env=False) as client:
        runtime=RemoteOpenCode(base_url='https://reference.invalid',expected_config=CONFIG,
            model={'providerID':'controlled','modelID':'synthetic'},agent='bounded',client=client,enabled=True)
        request=ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose='extraction',
            messages=[{'role':'user','content':'synthetic'}],system_prompt='Synthetic',output_schema=SCHEMA,
            model_profile='contract_emulator',deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20),max_output_tokens=100)
        checkpoints=[]
        with operation_scope(run_id=request.run_id,deadline_at=request.deadline_at) as context:
            context.runtime_checkpoint=lambda request,value:checkpoints.append(dict(value))
            RuntimeModel(lambda:runtime,model_actual='synthetic').complete(request)
            assert state['abort_count']==1 and context._cleanup_pending
        assert context.release_pending and gate.client.command('HLEN',gate.keys[2])==1
        assert checkpoints[-1]['cleanup']=='failed' and checkpoints[-1]['owner_finished'] is True
        assert gate.recover_confirmed()==0
        # Simulate a later successful cleanup using the durable owned identity.
        last=checkpoints[-1]
        handle=RuntimeHandle(last['session_id'],last['message_id'],SCHEMA,
            preparation_ref=last['preparation_ref'],run_id=str(request.run_id))
        state['cleanup_failure']=False
        assert runtime.dispose(handle)=={'cleanup':'confirmed'}
        context.confirm_cleanup()
        assert not context.release_pending and gate.client.command('HLEN',gate.keys[2])==0


def test_prepare_restart_cannot_reinitialize_a_lost_coordinator(gate, tmp_path):
    from dmb_agent_contracts.limiter_cli import prepare
    directory=tmp_path/"launcher"
    namespace=gate.config.namespace+"-bootstrap"
    first=prepare(directory,namespace,"global",gate.config.redis_url)
    second=prepare(directory,namespace,"global",gate.config.redis_url)
    assert first==second
    key="dmb:agent-gate:"+namespace+":epoch"
    gate.client.command("DEL",key)
    with pytest.raises(AgentError,match="epoch_missing"):
        prepare(directory,namespace,"global",gate.config.redis_url)
    assert gate.client.command("GET",key) is None
    other=RedisLimiter(LimiterConfig(gate.config.redis_url,namespace,first["epoch"],directory/"leases"))
    other.client.command("DEL",*other.keys)


@pytest.mark.parametrize("isolated", [False, True])
def test_real_owner_process_death_requires_proof_for_isolated_resources(gate, monkeypatch, isolated):
    import subprocess
    import sys
    configure_process(monkeypatch, gate)
    script = """from dmb_agent_contracts.operation import operation_scope
import time
with operation_scope() as context:
    if ISOLATED: context.hold_slot_for_cleanup()
    print('acquired', flush=True)
    time.sleep(60)
""".replace("ISOLATED", repr(isolated))
    child = subprocess.Popen([sys.executable, "-u", "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == "acquired"
        assert gate.client.command("HLEN", gate.keys[2]) == 1
    finally:
        child.terminate()  # This exact Popen handle belongs to this fixture.
        child.wait(timeout=5)
    recovered = gate.recover_confirmed()
    assert recovered == (0 if isolated else 1)
    assert gate.client.command("HLEN", gate.keys[2]) == (1 if isolated else 0)
    if isolated:
        record = next(json.loads(p.read_text()) for p in gate.config.journal_dir.glob("*.json"))
        assert record["state"] == "resource_cleanup_pending"
        gate.confirm_run_cleanup(record["run_id"])


def test_readiness_fails_closed_when_coordinator_is_lost(gate, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from dmb_agent_contracts.limiter_health import LimiterReadiness
    configure_process(monkeypatch, gate)
    application=FastAPI()
    @application.get("/health/ready")
    def ready():
        return {"status":"ready"}
    with TestClient(LimiterReadiness(application)) as client:
        response=client.get("/health/ready")
        assert response.status_code==200 and "x-agent-operation-limit" not in response.headers
        gate.client.command("DEL",gate.keys[0])
        response=client.get("/health/ready")
        assert response.status_code==503 and response.json()["reason"]=="operation_limiter_unavailable"
        assert gate.client.command("GET",gate.keys[0]) is None


def test_partial_active_hash_loss_cannot_reopen_capacity(gate):
    gate.acquire(uuid4(),"one")
    gate.acquire(uuid4(),"two")
    gate.client.command("DEL",gate.keys[2])
    with pytest.raises(AgentError,match="global_limiter_unavailable"):
        gate.acquire(uuid4(),"three")
    with pytest.raises(AgentError,match="state_lost"):
        gate.bootstrap()
    assert gate.client.command("GET",gate.keys[7])=="2"


def test_container_entry_requires_and_persists_an_explicit_profile(gate, monkeypatch, tmp_path):
    from dmb_agent_contracts.entry import prepare_runtime
    from dmb_agent_contracts.limiter import from_environment
    monkeypatch.setenv("DMB_AGENT_SERVICE_ID","meeting-analyzer")
    monkeypatch.setenv("DMB_AGENT_LIMITER_REDIS_URL",gate.config.redis_url)
    monkeypatch.setenv("DMB_AGENT_LIMITER_STATE_DIR",str(tmp_path/"container-state"))
    monkeypatch.setenv("DMB_AGENT_LIMITER_MODE","standalone")
    monkeypatch.setenv("DMB_AGENT_LIMITER_NAMESPACE",gate.config.namespace+"-container")
    for name in ("DMB_AGENT_LIMITER_EPOCH","DMB_AGENT_LIMITER_JOURNAL_DIR","DMB_AGENT_REQUIRE_LIMITER"):
        monkeypatch.setenv(name,os.environ.get(name,""))
    first=prepare_runtime()
    second=prepare_runtime()
    assert first==second and first["limit"]==1
    configured=from_environment()
    configured.bootstrap()
    configured.client.command("DEL",*configured.keys)


def test_required_runtime_never_falls_back_to_unlimited(monkeypatch):
    from dmb_agent_contracts.limiter import from_environment
    monkeypatch.delenv("DMB_AGENT_LIMITER_MODE",raising=False)
    monkeypatch.setenv("DMB_AGENT_REQUIRE_LIMITER","true")
    with pytest.raises(AgentError,match="limiter_configuration_invalid"):
        from_environment()


def test_finished_owner_holds_slot_until_actual_http_thread_exits(gate,monkeypatch):
    from dmb_agent_contracts.operation import operation_scope,physical_activity,submit_in_operation
    configure_process(monkeypatch,gate)
    started,finish=threading.Event(),threading.Event()
    def network():
        with physical_activity():
            started.set()
            assert finish.wait(10)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with operation_scope() as context:
            pending=submit_in_operation(pool,network)
            assert started.wait(5)
        assert context.release_pending and gate.client.command("HLEN",gate.keys[2])==1
        with pytest.raises(AgentError,match="http_cleanup_unconfirmed"):
            gate.confirm_run_cleanup(context.run_id)
        finish.set()
        pending.result(timeout=5)
    assert gate.client.command("HLEN",gate.keys[2])==0


def test_owner_cancellation_closes_default_http_before_freeing_slot(gate,monkeypatch):
    import asyncio
    import httpx
    from datetime import datetime,timedelta,timezone
    from dmb_agent_contracts.operation import operation_scope,submit_in_operation
    from dmb_agent_contracts.go import GoModel
    from dmb_agent_contracts.deadline_http import DeadlineHTTP
    from dmb_agent_contracts.model import ModelRequest
    configure_process(monkeypatch,gate)
    started=threading.Event()
    closed=[]
    async def provider(_):
        try:
            started.set()
            await asyncio.sleep(20)
        finally:
            closed.append(True)
    port=GoModel(base_url="https://opencode.ai/zen/go/v1",api_key="synthetic",model="synthetic",
        client=DeadlineHTTP(transport=httpx.MockTransport(provider)))
    with ThreadPoolExecutor(max_workers=1) as pool:
        with operation_scope() as context:
            request=ModelRequest(request_id=uuid4(),run_id=context.run_id,purpose="extraction",messages=[{"role":"user","content":"Synthetic"}],
                system_prompt="JSON",output_schema={},model_profile="synthetic",max_output_tokens=100,
                deadline_at=datetime.now(timezone.utc)+timedelta(seconds=10))
            pending=submit_in_operation(pool,port.complete,request)
            assert started.wait(5)
        with pytest.raises(AgentError,match="operation_already_finished"):
            pending.result(timeout=5)
    assert closed==[True] and gate.client.command("HLEN",gate.keys[2])==0


def test_confirmed_runtime_cleanup_does_not_end_owner_early(gate,monkeypatch):
    from dmb_agent_contracts.operation import operation_scope
    configure_process(monkeypatch,gate)
    with operation_scope() as context:
        context.hold_slot_for_cleanup()
        context.confirm_cleanup()
        assert gate.recover_confirmed()==0
        assert gate.client.command("HLEN",gate.keys[2])==1
    assert gate.client.command("HLEN",gate.keys[2])==0


def test_generation_loss_needs_explicit_closed_journal_reconciliation(gate):
    lease=gate.acquire(uuid4(),"actor")
    gate.client.command("SET",gate.keys[8],"previous-server-generation")
    with pytest.raises(AgentError,match="server_restarted"):
        gate.bootstrap()
    with pytest.raises(AgentError,match="global_limiter_unavailable"):
        gate.acquire(uuid4(),"new-actor")
    with pytest.raises(AgentError,match="limiter_recovery_required"):
        gate.reconcile_after_restart()
    lease.release()
    gate.reconcile_after_restart()
    gate.bootstrap()
    next_lease=gate.acquire(uuid4(),"next")
    next_lease.release()


def test_wrong_journal_directory_cannot_share_coordinator_authority(gate,tmp_path):
    other=RedisLimiter(replace(gate.config,journal_dir=tmp_path/"different-authority"))
    with pytest.raises(AgentError,match="profile_mismatch"):
        other.bootstrap()


def test_complete_coordinator_loss_can_only_recover_after_all_physical_cleanup(gate):
    lease=gate.acquire(uuid4(),"actor")
    gate.client.command("DEL",*gate.keys)
    with pytest.raises(AgentError,match="limiter_recovery_required"):
        gate.reconcile_after_restart()
    with pytest.raises(AgentError,match="operation_release_unconfirmed"):
        lease.release()
    assert read_state(lease.path)=="cleanup_confirmed"
    gate.reconcile_after_restart()
    gate.bootstrap()
    assert gate.client.command("HLEN",gate.keys[2])==0


def read_state(path):
    return json.loads(path.read_text())["state"]


def test_replicas_recover_one_confirmed_cleanup_idempotently(gate):
    lease = gate.acquire(uuid4(), "actor")
    lease.confirm_cleanup()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: RedisLimiter(gate.config).recover_confirmed(), range(8)))
    assert gate.client.command("HLEN", gate.keys[2]) == 0
    assert lease.path.with_suffix(".done").exists()
