"""Abandoned runtime cleanup never authorizes another model dispatch."""
import socket
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine, select

from dmb_agent_contracts.runtime_records import RuntimeRecords, bindings, migrate
from test_remote_http import adapter, emulator, SCHEMA


@pytest.mark.parametrize("owner_status,terminal,profile_match,finished,expected", [
    ("dead", True, True, False, True), ("alive", True, True, False, False),
    ("unknown", True, True, False, False), ("dead", False, True, False, False),
    ("dead", True, False, False, False), ("alive", True, True, True, True),
])
def test_recovery_requires_dead_owner_terminal_fence_and_frozen_profile(
        monkeypatch, owner_status, terminal, profile_match, finished, expected):
    engine = create_engine("sqlite://")
    migrate(engine)
    run_id, request_id = str(uuid4()), str(uuid4())
    request = SimpleNamespace(run_id=run_id, request_id=request_id)
    with emulator() as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({"run_id":run_id}, {}, SCHEMA)
        records = RuntimeRecords(engine, lambda: None)
        records.checkpoint(request, {"session_id":handle.session_id, "message_id":handle.message_id,
            "preparation_ref":handle.preparation_ref, "dispatch_ref":None, "delivery":"not_attempted",
            "cleanup":"pending", "cancelled":False, "profile_ref":"frozen", "owner_finished":finished})
        with engine.connect() as connection:
            owner = connection.execute(select(bindings.c.binding)).scalar_one()["owner"]
        monkeypatch.setattr("dmb_agent_contracts.limiter.process_identity",
            lambda pid: (owner_status, owner["birth"]))
        released = []
        profile = SimpleNamespace(profile_ref="frozen" if profile_match else "changed", runtime=lambda:runtime)
        store = SimpleNamespace(get=lambda identity: {"status":"failed" if terminal else "running"})
        limiter = SimpleNamespace(confirm_run_cleanup=released.append)
        records.recover_abandoned(store, profile, limiter)
        with engine.connect() as connection:
            cleanup = connection.execute(select(bindings.c.cleanup)).scalar_one()
        assert (cleanup == "confirmed") is expected
        assert released == ([run_id] if expected else [])
        assert state["dispatch_count"] == 0
        runtime.client.close()
    engine.dispose()


def test_cleanup_transport_can_finish_after_cancel_without_reopening_operation():
    from datetime import datetime, timedelta, timezone
    from dmb_agent_contracts.operation import operation_scope, current_operation, runtime_cleanup_scope
    from dmb_agent_contracts.model import AgentError
    with operation_scope(acquire_gate=False) as context:
        token = context.hold_slot_for_cleanup()
        context.cancel()
        with runtime_cleanup_scope():
            assert current_operation() is None
            assert context._physical_activities == 1
            assert context._cleanup_pending
        assert current_operation() is context
        assert context._physical_activities == 0
        with pytest.raises(AgentError, match="cancelled"):
            context.check()
        context.confirm_cleanup(token)


@pytest.mark.parametrize("fault", ["missing", "foreign", "delete_failed", "recover_create"])
def test_unknown_create_requires_positive_owned_cleanup_receipt(monkeypatch, fault):
    engine = create_engine("sqlite://")
    migrate(engine)
    run_id, request_id = str(uuid4()), str(uuid4())
    with emulator(cleanup_failure=fault == "delete_failed") as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({"run_id":run_id}, {}, SCHEMA)
        records = RuntimeRecords(engine, lambda: None)
        records.checkpoint(SimpleNamespace(run_id=run_id, request_id=request_id), {
            "session_id": None, "message_id":handle.message_id,
            "preparation_ref":handle.preparation_ref, "dispatch_ref":None,
            "delivery":"not_attempted", "cleanup":"pending", "cancelled":False, "profile_ref":"frozen"})
        if fault == "missing":
            state.pop("session_record")
        elif fault == "foreign":
            state["session_record"]["metadata"]["dmb_run_id"] = str(uuid4())
        monkeypatch.setattr("dmb_agent_contracts.limiter.process_identity", lambda pid:("dead", None))
        released = []
        records.recover_abandoned(SimpleNamespace(get=lambda _: {"status":"interrupted"}),
            SimpleNamespace(profile_ref="frozen", runtime=lambda:runtime),
            SimpleNamespace(confirm_run_cleanup=released.append))
        with engine.connect() as connection:
            cleanup = connection.execute(select(bindings.c.cleanup)).scalar_one()
        assert (cleanup == "confirmed") is (fault == "recover_create")
        assert released == ([run_id] if fault == "recover_create" else [])
        assert state["prepare_count"] == 1 and state["dispatch_count"] == 0
        runtime.client.close()
    engine.dispose()


def test_final_cleanup_checkpoint_survives_cancel_and_cannot_reopen_owner():
    from dmb_agent_contracts.model import AgentError
    engine = create_engine('sqlite://')
    migrate(engine)
    cancelled = False
    def authorize():
        if cancelled:
            raise AgentError('cancelled',409)
    records = RuntimeRecords(engine, authorize)
    request = SimpleNamespace(run_id=uuid4(),request_id=uuid4())
    value = {'session_id':None,'message_id':'msg_synthetic','preparation_ref':uuid4().hex,
        'dispatch_ref':None,'delivery':'not_attempted','cleanup':'pending','cancelled':False,
        'profile_ref':'frozen','owner_finished':False}
    records.checkpoint(request,value)
    cancelled = True
    records.checkpoint(request,{**value,'owner_finished':True,'cleanup':'failed'})
    with pytest.raises(AgentError):
        records.checkpoint(request,{**value,'cleanup':'confirmed'})
    with engine.connect() as connection:
        assert connection.execute(select(bindings.c.binding)).scalar_one()['owner_finished'] is True
    engine.dispose()
