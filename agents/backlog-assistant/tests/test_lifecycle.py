import asyncio
import time
import pytest
import httpx
from fastapi.testclient import TestClient
from contracts.models import Answer, Context
from runtime.opencode import OpenCodeRuntime
from backlog_assistant.app import create_app
from backlog_assistant.worker import Worker
from tests.test_service import setup, queued, send, SECRET
from tests.test_boundaries import bridge


@pytest.mark.asyncio
async def test_structured_output_tool_finish_is_terminal():
    b = await bridge()
    runtime = OpenCodeRuntime(None, model="synthetic")
    handle = {"instance": "one", "session": "ses_one", "message": "msg_one"}
    async def response(request):
        if request.url.path == "/permission":
            return httpx.Response(200, json=[])
        return httpx.Response(200, json=[{"info": {"role": "assistant", "sessionID": "ses_one",
            "parentID": "msg_one", "time": {"completed": 1}, "finish": "tool-calls", "structured": {}}}])
    runtime.clients["one"] = httpx.AsyncClient(base_url="http://synthetic.invalid", transport=httpx.MockTransport(response))
    runtime.bridges["one"] = b
    assert await runtime.inspect(handle) == "completed"
    await runtime.clients["one"].aclose()


@pytest.mark.asyncio
async def test_result_ownership_and_revocation(setup):
    store, data, runtime = setup
    row = queued(setup)
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    receipt = store.get_run(row["owner"], row["id"])["receipts"][0]
    client = TestClient(create_app(store, data, runtime, SECRET, run_workers=False))
    assert send(client, "GET", f"/v1/results/{receipt}?cursor=0").status_code == 200
    assert send(client, "GET", f"/v1/results/{receipt}?cursor=0", subject="two").status_code == 404
    assert send(client, "GET", f"/v1/internal/results/{receipt}", subject="two").status_code == 404
    data.revoked_owners.add(row["owner"])
    assert send(client, "GET", f"/v1/results/{receipt}?cursor=0").status_code == 404


@pytest.mark.asyncio
async def test_invalid_model_answer_falls_back_to_verified_server_data(setup):
    store, data, runtime = setup
    row = queued(setup)
    async def invalid(handle):
        raise ValueError("invalid_candidate")
    runtime.collect = invalid
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    result = store.get_run(row["owner"], row["id"])
    assert result["status"] == "partial"
    assert result["answer"]["verified_blocks"][0]["total"] == 1
    assert result["answer"]["summary_claims"] == []
    assert not runtime.instances


@pytest.mark.asyncio
async def test_cancellation_during_tool_read_never_publishes(setup):
    store, data, runtime = setup
    row = queued(setup)
    original = runtime.submit
    async def cancelling(handle, envelope, dispatch):
        result = await original(handle, envelope, dispatch)
        store.cancel(row["owner"], row["id"])
        return result
    runtime.submit = cancelling
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    result = store.get_run(row["owner"], row["id"])
    assert result["answer"] is None and result["status"] in {"cancelled", "interrupted"}
    assert not runtime.instances


@pytest.mark.asyncio
async def test_prepare_crash_has_durable_cleanup_identity(setup):
    store, data, runtime = setup
    row = queued(setup)
    disposed = []
    async def failed(context, bridge, schema):
        saved = store.get_run(row["owner"], row["id"])
        assert saved["handle"]["instance"] == row["execution_ref"]
        assert saved["cleanup_pending"] is False  # other workers must not clean an active prepare
        raise ValueError("startup_failed")
    async def dispose(handle):
        disposed.append(handle["instance"])
    runtime.prepare, runtime.dispose = failed, dispose
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    assert disposed == [row["execution_ref"]]
    assert store.get_run(row["owner"], row["id"])["status"] == "failed"


@pytest.mark.asyncio
async def test_model_timeout_preserves_reauthorized_tool_results(setup):
    store, data, runtime = setup
    row = queued(setup)
    async def timeout(handle):
        raise TimeoutError()
    runtime.collect = timeout
    worker = Worker(store, data, runtime)
    await worker.execute(store.claim(worker.id))
    result = store.get_run(row["owner"], row["id"])
    assert result["status"] == "partial"
    assert result["answer"]["verified_blocks"][0]["total"] == 1
    assert not runtime.instances


@pytest.mark.asyncio
async def test_denial_after_successful_read_never_publishes_partial(setup):
    store,data,runtime=setup
    row=queued(setup)
    original=runtime.submit
    async def deny_after_read(handle,envelope,dispatch):
        await original(handle,envelope,dispatch)
        runtime.instances[handle["instance"]]["bridge"].failure="source_access_denied"
        raise PermissionError("source_access_denied")
    runtime.submit=deny_after_read
    worker=Worker(store,data,runtime)
    await worker.execute(store.claim(worker.id))
    result=store.get_run(row["owner"],row["id"])
    assert result["answer"] is None and result["status"]=="failed"
    assert not runtime.instances
