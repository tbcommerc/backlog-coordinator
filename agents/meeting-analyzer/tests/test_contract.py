from datetime import timedelta
from uuid import uuid4
import hashlib
import pytest
from sqlalchemy import create_engine, update
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from dmb_agent_contracts.model import AgentError, ModelResult, Usage
from meeting_analyzer.api import create_app
from meeting_analyzer.config import Settings
from meeting_analyzer.extraction import ExtractionInput, validate_candidate
from meeting_analyzer.migrate import migrate
from meeting_analyzer.store import Store, now, runs
from meeting_analyzer.worker import execute


@pytest.fixture
def storage():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    migrate(engine)
    yield Store(engine)
    engine.dispose()


def body(text="Подготовить описание процесса."):
    return {"contract_version": "1.0", "operation": "meeting.extract", "source": {
        "kind": "meeting_capture", "ref": "capture", "revision": 1,
        "snapshot_hash": "sha256:"+hashlib.sha256(text.encode()).hexdigest()},
        "input": {"transcript": text}}


def create(storage, key="key", actor="actor", request=None):
    return storage.create("dmb", actor, key, request or body(), {"model": "synthetic"}, 300, 10)[0]


def test_idempotency_and_actor_scope(storage):
    row = create(storage)
    assert create(storage)["id"] == row["id"]
    assert create(storage, actor="other")["id"] != row["id"]
    with pytest.raises(AgentError, match="idempotency_conflict"):
        create(storage, request=body("Другой текст"))
    with pytest.raises(AgentError, match="run_not_found"):
        storage.get(row["id"], "dmb", "other")


def test_cancel_unknown_prevents_late_create_and_never_enters_queue(storage):
    request, profile = body(), {"model": "synthetic"}
    cancelled, replay = storage.cancel_key("dmb", "actor", "unknown", request, profile, 300)
    assert not replay and cancelled["status"] == "cancelled"
    late, replay = storage.create("dmb", "actor", "unknown", request, profile, 300, 10)
    assert replay and late["id"] == cancelled["id"] and late["status"] == "cancelled"
    assert storage.claim() is None
    with pytest.raises(AgentError, match="idempotency_conflict"):
        storage.cancel_key("dmb", "actor", "unknown", body("Other text"), profile, 300)
    other, _ = storage.cancel_key("dmb", "other-actor", "unknown", request, profile, 300)
    assert other["id"] != cancelled["id"]


def test_cancel_unknown_fences_previously_claimed_worker(storage):
    row = create(storage)
    claimed = storage.claim()
    cancelled, replay = storage.cancel_key("dmb", "actor", "key", body(), {"model": "synthetic"}, 300)
    assert replay and cancelled["id"] == row["id"] and cancelled["status"] == "cancelled"
    assert storage.transition(claimed, "preparing") is None


def test_stale_worker_and_cancel_win(storage):
    create(storage)
    row = storage.transition(storage.claim(), "preparing")
    cancelled = storage.transition(row, "cancelled", finished_at=now())
    assert cancelled
    assert storage.transition(row, "running", delivery="accepted") is None
    assert storage.get(row["id"])["status"] == "cancelled"


def test_no_redispatch_after_intent(storage):
    create(storage)
    row = storage.transition(storage.claim(), "preparing")
    storage.transition(row, "running", delivery="unknown", dispatch_ref=str(uuid4()), deadline_at=now()-timedelta(seconds=1))
    storage.expire()
    assert storage.claim() is None
    assert storage.get(row["id"])["status"] == "interrupted"


def test_tombstone(storage):
    row = create(storage)
    done = storage.transition(validating(storage, row), "completed", result={"items": []}, finished_at=now()-timedelta(days=8))
    storage.expire()
    with pytest.raises(AgentError, match="result_expired"):
        create(storage)
    assert storage.get(done["id"])["input"] is None


def test_quote_invalidates_entire_candidate():
    with pytest.raises(ValueError):
        validate_candidate({"items": [{"kind": "action", "title": "Описание", "quote": "Несуществующая цитата"}]}, "Подготовить описание")


def test_dedup_no_resolution():
    item = {"kind": "action", "title": "Описание", "quote": "подготовить", "owner_text": "Иван", "due_text": "к пятнице"}
    result = validate_candidate({"items": [item, {**item, "title": "  ОПИСАНИЕ  "}]}, "Нужно подготовить")
    assert len(result["items"]) == 1
    assert result["items"][0]["due_date"] is None
    assert result["items"][0]["selected"] is False


@pytest.mark.parametrize("length,valid", [(60000, True), (60001, False), (0, False)])
def test_input_boundaries(length, valid):
    if valid:
        assert len(ExtractionInput(transcript="я"*length).transcript) == length
    else:
        with pytest.raises(ValueError):
            ExtractionInput(transcript="я"*length)


def test_stable_result_no_second_model_call(storage):
    create(storage)
    class Model:
        calls = 0
        def complete(self, request):
            self.calls += 1
            return ModelResult(text='{"items": []}', structured={"items": []}, finish_reason="stop",
                usage=Usage(unavailable_reason="synthetic"), model_actual="synthetic", elapsed_ms=1)
    model = Model()
    row = storage.claim()
    # SQLite fixture loses timezone; production PostgreSQL preserves it.
    row["deadline_at"] = now()+timedelta(seconds=300)
    execute(storage, row, model)
    assert storage.get(row["id"])["result"] == {"items": []}
    assert create(storage)["id"] == row["id"]
    assert storage.claim() is None
    assert model.calls == 1


def test_api_auth_replay_events(storage):
    settings = Settings(_env_file=None, service_secret="synthetic-secret")
    with TestClient(create_app(settings, storage.engine)) as client:
        headers = {"X-Agent-Secret": "synthetic-secret", "X-Agent-Caller": "dmb", "X-Actor-Ref": "actor", "Idempotency-Key": "key"}
        assert client.post("/internal/agent/v1/runs", json=body()).status_code == 401
        response = client.post("/internal/agent/v1/runs", json=body(), headers=headers)
        assert response.status_code == 202
        url = response.json()["status_url"]
        assert client.post("/internal/agent/v1/runs", json=body(), headers=headers).json()["replayed"]
        assert client.get(url, headers={**headers, "X-Actor-Ref": "other"}).status_code == 404
        assert client.get(url+"/events", headers=headers).text.count("event: accepted") == 1
        assert client.get(url+"/events", headers={**headers, "Last-Event-ID": "1"}).text == ""
        assert client.post(url+"/cancel", headers=headers).json()["status"] == "cancelled"
        assert client.post(url+"/cancel", headers=headers).status_code == 200


def test_api_cancel_key_before_late_create(storage):
    settings = Settings(_env_file=None, service_secret="synthetic-secret")
    headers = {"X-Agent-Secret": "synthetic-secret", "X-Agent-Caller": "dmb", "X-Actor-Ref": "actor", "Idempotency-Key": "cancel-key"}
    with TestClient(create_app(settings, storage.engine)) as client:
        assert client.post("/internal/agent/v1/runs/cancellations", json=body()).status_code == 401
        cancelled = client.post("/internal/agent/v1/runs/cancellations", json=body(), headers=headers)
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
        late = client.post("/internal/agent/v1/runs", json=body(), headers=headers)
        assert late.status_code == 200 and late.json()["run_id"] == cancelled.json()["run_id"]
        assert late.json()["status"] == "cancelled" and storage.claim() is None


def test_trusted_deadline_can_only_narrow_and_replay_cannot_extend(storage):
    from datetime import timezone
    settings=Settings(_env_file=None,service_secret="synthetic-secret")
    headers={"X-Agent-Secret":"synthetic-secret","X-Agent-Caller":"dmb","X-Actor-Ref":"actor","Idempotency-Key":"deadline"}
    deadline=now()+timedelta(seconds=30)
    with TestClient(create_app(settings,storage.engine)) as client:
        response=client.post("/internal/agent/v1/runs",json=body(),headers={**headers,"X-Agent-Deadline":deadline.isoformat()})
        assert response.status_code==202
        identifier=response.json()["run_id"]
        stored=storage.get(identifier)["deadline_at"].replace(tzinfo=timezone.utc)
        assert stored==deadline
        replay=client.post("/internal/agent/v1/runs",json=body(),headers={**headers,"X-Agent-Deadline":(deadline+timedelta(days=1)).isoformat()})
        assert replay.status_code==200 and replay.json()["run_id"]==identifier
        assert storage.get(identifier)["deadline_at"].replace(tzinfo=timezone.utc)==stored
        capped=client.post("/internal/agent/v1/runs",json=body(),headers={**headers,"Idempotency-Key":"capped","X-Agent-Deadline":(deadline+timedelta(days=1)).isoformat()})
        assert capped.status_code==202
        assert storage.get(capped.json()["run_id"])["deadline_at"].replace(tzinfo=timezone.utc)<=now()+timedelta(seconds=settings.deadline_seconds)


def test_past_or_naive_deadline_never_admits_new_work(storage):
    from sqlalchemy import select,func
    settings=Settings(_env_file=None,service_secret="synthetic-secret")
    headers={"X-Agent-Secret":"synthetic-secret","X-Agent-Caller":"dmb","X-Actor-Ref":"actor","Idempotency-Key":"past"}
    with TestClient(create_app(settings,storage.engine)) as client:
        response=client.post("/internal/agent/v1/runs",json=body(),headers={**headers,"X-Agent-Deadline":(now()-timedelta(seconds=1)).isoformat()})
        assert response.status_code==504
        response=client.post("/internal/agent/v1/runs",json=body(),headers={**headers,"X-Agent-Deadline":"2026-11-03T12:00:00"})
        assert response.status_code==400
    with storage.engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(runs))==0


def test_validation_error_never_echoes_private_input(storage):
    settings=Settings(_env_file=None,service_secret="synthetic-secret")
    with TestClient(create_app(settings,storage.engine)) as client:
        response=client.post("/internal/agent/v1/runs",json={**body(),"unexpected":"synthetic-private-value"},headers={"X-Agent-Secret":"synthetic-secret","X-Agent-Caller":"dmb","X-Actor-Ref":"actor","Idempotency-Key":"invalid"})
        assert response.status_code==422
        assert "synthetic-private-value" not in response.text
        assert response.json()["error"]["code"]=="input_validation_failed"


def test_body_limit_counts_actual_bytes_and_accepts_the_exact_boundary(storage):
    import json
    settings=Settings(_env_file=None,service_secret="synthetic-secret",request_body_limit_bytes=1024)
    headers={"X-Agent-Secret":"synthetic-secret","X-Agent-Caller":"dmb","X-Actor-Ref":"actor",
        "Idempotency-Key":"boundary","Content-Type":"application/json"}
    raw=json.dumps(body(),ensure_ascii=False).encode()
    exact=raw+b" "*(1024-len(raw))
    with TestClient(create_app(settings,storage.engine)) as client:
        assert client.post("/internal/agent/v1/runs",content=exact,headers=headers).status_code==202
        rejected=client.post("/internal/agent/v1/runs",content=exact+b" ",headers={**headers,"Idempotency-Key":"oversize"})
        assert rejected.status_code==413 and rejected.json()["error"]["code"]=="payload_too_large"
        # No Content-Length: enforce the limit while receiving chunked ingress too.
        chunked=client.post("/internal/agent/v1/runs",content=iter([exact,b" "]),headers={**headers,"Idempotency-Key":"chunked"})
        assert chunked.status_code==413


def test_invalid_json_has_safe_standard_error(storage):
    settings=Settings(_env_file=None,service_secret="synthetic-secret")
    with TestClient(create_app(settings,storage.engine)) as client:
        response=client.post("/internal/agent/v1/runs",content=b'{"synthetic-private-value":',
            headers={"Content-Type":"application/json"})
        assert response.status_code==400 and response.json()["error"]["code"]=="invalid_request"
        assert "synthetic-private-value" not in response.text


def validating(store, row):
    for status in ("preparing", "running", "validating"):
        if row["status"] == status:
            continue
        order = ["queued", "preparing", "running", "validating"]
        if order.index(row["status"]) < order.index(status):
            row = store.transition(row, status)
    return row


def test_default_deadline_preserves_original_ten_minute_budget():
    from meeting_analyzer.config import Settings
    assert Settings(_env_file=None).deadline_seconds == 600


@pytest.mark.parametrize('count,valid',[(60,True),(61,False)])
def test_output_item_count_is_validated_before_deduplication(count,valid):
    items=[{'kind':'action','title':'Поручение '+str(index),'quote':'Подготовить'} for index in range(count)]
    if valid:
        result=validate_candidate({'items':items},'Подготовить')
        assert len(result['items'])==count
    else:
        with pytest.raises(ValueError):validate_candidate({'items':items},'Подготовить')
        # Excess duplicate candidates must not silently shrink into a valid result.
        with pytest.raises(ValueError):validate_candidate({'items':[items[0]]*count},'Подготовить')


@pytest.mark.parametrize('field,maximum',[('title',255),('description',5000),('owner_text',255),('due_text',255),('quote',4000)])
def test_output_field_limits_reject_whole_candidate_without_truncation(field,maximum):
    item={'kind':'agreement','title':'Договорённость','quote':'цитата'}
    exact={**item,field:'я'*maximum}
    transcript=exact['quote']
    result=validate_candidate({'items':[exact]},transcript)
    assert result['items'][0][field]=='я'*maximum
    invalid={**exact,field:'я'*(maximum+1)}
    with pytest.raises(ValueError):
        validate_candidate({'items':[item,invalid]},'цитата '+invalid['quote'])
