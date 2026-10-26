"""No application DB and no protected records: identities are in-memory stubs."""
import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from auth import get_current_user
from config import settings
from routers import backlog_assistant_gateway_router as gateway
from routers import backlog_assistant_data_router as internal
from services.backlog_assistant_integration import ledger, policy, query


def user(customer=False, team=None, scope="none"):
    role = SimpleNamespace(customer_portal_only=customer, review_access=scope, backlog_dmb_access="none")
    return SimpleNamespace(id=71, team_id=team, business_customer_id=None, role=role, role_name="",
        _auth_sid="synthetic-session", _auth_version=1)


def sql(clause):
    return str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_teamless_request_scope_never_matches_null_team():
    assert "team_id" not in sql(policy.request_clause(user(team=None, scope="team")))
    assert "user_id = 71" in sql(policy.request_clause(user(team=None, scope="team")))


def test_customer_all_review_role_does_not_expand_customer_projection():
    clause = policy.request_clause(user(customer=True, scope="all"))
    assert "user_id = 71" in sql(clause)
    assert "false" in sql(policy.customer_tasks_clause(user(customer=True)))


@pytest.mark.parametrize("filters", [{"priority_ids": [1]}, {"project_ids": [1]}, {"relationship": "mine"}, {"missing": ["effect"]}])
def test_customer_cannot_infer_hidden_fields_from_counts(filters):
    db = MagicMock()
    with pytest.raises(HTTPException) as error:
        query.query(db, user(customer=True), {"customer": True, "task": []}, filters)
    assert error.value.status_code == 422


def test_customer_projection_excludes_internal_fields():
    now = datetime.now(timezone.utc)
    task = SimpleNamespace(id=1, public_id="TASK-000-001", title="Synthetic", description="Test", progress=0,
        created_at=now, updated_at=now, team=None, status=None, deadline=None, effort_rub=987654, financial_effect=123,
        priority_score=91, comments=["private"], owner=None)
    value = query.project_task(task, True)
    assert not set(value) & {"effort_rub", "cost_rub", "financial_effect", "priority_score", "comments", "owner"}
    assert value["progress"] == 0


def test_aggregate_counts_full_selection_and_distinguishes_zero_and_null(monkeypatch):
    rows = [SimpleNamespace(id=i, version=1, team=SimpleNamespace(id=1, name="Synthetic team"),
        effort_rub=Decimal(0) if i % 2 else None, financial_effect=Decimal("1.5")) for i in range(1101)]
    selected = MagicMock()
    selected.filter.return_value = selected
    selected.all.return_value = rows
    monkeypatch.setattr(query, "query", lambda *args: selected)
    data, manifest, _ = query.execute(MagicMock(), user(), {"customer": False}, "aggregate_backlog",
        {"query": {}, "group_by": "team", "metrics": ["count", "cost_rub", "effect_million_rub"]}, {"filters": {}})
    assert data["total"] == 1101 and len(manifest) == 1101
    assert data["items"][0]["cost_rub"] == "0"
    assert data["items"][0]["cost_rub_unknown"] == 551
    assert data["items"][0]["effect_million_rub"] == "1651.5"


def test_customer_detail_exception_never_expands_list():
    actor = user(customer=True)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = (1,)
    task = SimpleNamespace(id=4, business_customer_id=8, is_deleted=False)
    assert policy.customer_task_allowed(db, actor, task)
    assert "false" in sql(policy.customer_tasks_clause(actor))


def test_disabled_gateway_and_public_input_rejects_identity():
    app = FastAPI()
    app.include_router(gateway.router, prefix="/api/v1/backlog-assistant")
    app.dependency_overrides[get_current_user] = lambda: user()
    client = TestClient(app)
    assert client.get('/api/v1/backlog-assistant/capabilities').json()["enabled"] is False
    assert client.post('/api/v1/backlog-assistant/sessions', json={}).status_code == 403
    app.dependency_overrides[gateway.allowed] = lambda: user()
    assert client.post('/api/v1/backlog-assistant/sessions', json={"user_id": 7}).status_code == 422
    assert client.get('/api/v1/backlog-assistant/config').status_code == 404
    assert client.get('/api/v1/backlog-assistant/runs/config').status_code == 404


def test_internal_requires_service_auth_and_refuses_subject_in_activation(monkeypatch):
    app = FastAPI(); app.include_router(internal.router)
    client = TestClient(app)
    assert client.post('/executions/test/activate', json={"lease": "a"}).status_code == 401
    monkeypatch.setattr(settings, "BACKLOG_ASSISTANT_SERVICE_TOKEN", "a"*32)
    response = client.post('/executions/test/activate', json={"lease": "a", "user_id": 7},
        headers={"Authorization": "Bearer "+"a"*32})
    assert response.status_code == 422


def test_history_proof_is_bound_to_subject_and_specific_receipts(monkeypatch):
    monkeypatch.setattr(settings, "BACKLOG_ASSISTANT_SERVICE_TOKEN", "a"*32)
    monkeypatch.setattr(settings, "BACKLOG_ASSISTANT_GATEWAY_SECRET", "b"*32)
    proof = gateway.read_proof(user(), ["receipt-one"])
    app = FastAPI(); app.include_router(internal.router)
    client = TestClient(app)
    headers = {"Authorization": "Bearer "+"a"*32, "X-Read-Proof": proof}
    for owner, refs in [(json.dumps(["dmb", "72"]), ["receipt-one"]), (json.dumps(["dmb", "71"]), ["receipt-two"])]:
        response = client.post('/sources/validate', json={"owner": owner, "receipt_refs": refs}, headers=headers)
        assert response.status_code == 403


def test_context_normalization_and_unknown_filter():
    normal = gateway.checked_context({})
    assert normal["filters"]["relationship"] == "all"
    assert normal["filters"]["team_ids"] == []
    with pytest.raises(HTTPException):
        gateway.checked_context({"filters": {"sql": "SELECT 1"}})


def test_contract_artifacts_match_independent_release():
    release = Path(__file__).resolve().parents[3] / "backlog-assistant" / "contracts"
    for artifact in ledger.SCHEMA_DIR.glob('*.json'):
        assert json.loads(artifact.read_text(encoding='utf-8')) == json.loads((release / artifact.name).read_text(encoding='utf-8'))


def test_private_router_is_not_mounted_on_browser_server():
    main = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
    assert "backlog_assistant_data_router" not in main
    server = (Path(ledger.__file__).parent / "server.py").read_text(encoding="utf-8")
    assert "ssl_cert_reqs=ssl.CERT_REQUIRED" in server


def test_request_reason_comes_from_current_status_not_old_rejection():
    row=SimpleNamespace(id=1,title="Synthetic",description="Test",status="in_progress",reject_reason="Old rejection",version=1,
        status_history=[{"status":"rejected","comment":"Old rejection"},{"status":"in_progress","comment":"Assigned specialist"}])
    assert query.project_request(row)["review_comment"]=="Assigned specialist"
    row.status_history[-1]["comment"]=""
    assert not query.project_request(row)["review_comment"]


def test_duplicate_group_names_do_not_merge_distinct_projects(monkeypatch):
    rows=[SimpleNamespace(id=i,version=1,project=SimpleNamespace(id=i,name="Same name")) for i in [1,2]]
    selected=MagicMock();selected.filter.return_value=selected;selected.all.return_value=rows
    monkeypatch.setattr(query,"query",lambda *a:selected)
    data,_,_=query.execute(MagicMock(),user(),{"customer":False},"aggregate_backlog",{"query":{},"group_by":"project","metrics":["count"]},{"filters":{}})
    assert data["group_total"]==2
    assert {r["group_id"] for r in data["items"]}=={1,2}
    assert all(r["count"]==1 for r in data["items"])


def test_search_normalization_preserves_ids_and_literal_punctuation():
    from services.backlog_assistant_integration.normalization import search_tokens
    assert search_tokens('TASK-000-003')==['task-000-003']
    assert search_tokens('100% literal_under')==['100%','literal_under']
    assert search_tokens('котировка')==['котиров']
    assert search_tokens('кэшировании котировок')==['кэширован','котиров']
