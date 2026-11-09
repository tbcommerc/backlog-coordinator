import asyncio

from fastapi.testclient import TestClient
from dmb_agent_contracts.run_store import fingerprint
from backlog_assistant.app import create_app
from backlog_assistant.security import Identity
from backlog_assistant.worker import Worker
from contracts.models import Context
from test_service import SECRET, setup, send


def admitted(environment):
    store, data, runtime = environment
    owner = Identity("dmb", "one").owner
    context = Context().model_dump(mode="json")
    session = store.create(owner, "session", {"context": context})
    message = {"text": "Synthetic question", "context_revision": 1, "context": context,
        "execution_ref": data.register(owner)}
    body = {"contract_version": "1.0", "operation": "backlog.answer", "conversation_ref": session["id"],
        "source": {"kind": "assistant_context", "ref": session["id"], "revision": 1,
            "snapshot_hash": "sha256:"+fingerprint(message)}, "input": message}
    client = TestClient(create_app(store, data, runtime, SECRET, run_workers=False))
    response = send(client, "POST", "/internal/agent/v1/runs", body, key="question")
    assert response.status_code == 202, response.text
    return client, response, body


def test_common_facade_keeps_attestation_and_revalidates_sources(setup):
    store, data, runtime = setup
    client, response, body = admitted(setup)
    path = response.headers["Location"]
    assert client.get(path).status_code == 401
    assert send(client, "GET", path, subject="other").status_code == 404
    replay = send(client, "POST", "/internal/agent/v1/runs", body, key="question")
    assert replay.status_code == 200 and replay.json()["run_id"] == response.json()["run_id"]
    worker = Worker(store, data, runtime)
    asyncio.run(worker.execute(store.claim(worker.id)))
    assert send(client, "GET", path).json()["status"] == "completed"
    result = send(client, "GET", path+"/result")
    assert result.status_code == 200, result.text
    assert result.json()["result"]["payload"]["verified_blocks"][0]["total"] == 1
    assert "result_ready" in send(client, "GET", path+"/events").text
    data.revoked_owners.add(Identity("dmb", "one").owner)
    assert send(client, "GET", path+"/result").status_code == 403


def test_cancel_queued_common_run_prevents_dispatch(setup):
    store, data, runtime = setup
    client, response, body = admitted(setup)
    path = response.headers["Location"]
    assert send(client, "POST", path+"/cancel").json()["status"] == "cancelled"
    assert store.claim("replacement") is None
    assert not runtime.instances
    assert send(client, "POST", path+"/cancel").status_code == 200


def test_changed_model_profile_is_fenced_before_runtime_preparation(setup):
    from types import SimpleNamespace
    from runtime.opencode import OpenCodeRuntime
    store,data,_=setup
    runtime=OpenCodeRuntime(SimpleNamespace(image='sha256:'+'1'*64,
        provider_url='https://opencode.ai/zen/go/v1'),model='synthetic-original')
    client,response,_=admitted((store,data,runtime))
    runtime.model='synthetic-changed'
    worker=Worker(store,data,runtime)
    claimed=store.claim(worker.id)
    asyncio.run(worker.execute(claimed))
    status=send(client,'GET',response.headers['Location']).json()
    assert status['status']=='failed' and status['error']=='runtime_profile_changed'
