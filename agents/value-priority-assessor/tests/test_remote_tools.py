"""No reference/user/team records, seed or embeddings are created by this suite."""
import copy
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from value_priority_assessor import remote_tools as tools
from value_priority_assessor.core.models import Task, FactorAssessment

RUBRIC = {
    "strategy_fit": {"rubric_version": 7, "criteria": [{"id": "synthetic", "title": "Synthetic",
        "weight": 1, "options": {"direct": {"value": 1, "title": "Direct"}, "none": {"value": 0}}}],
        "scale": {"raw_min": 1, "raw_max": 10}},
    "dependencies": {"rubric_version": 7, "base_score": 1, "floor": 0.2, "types": {
        "blocking": {"penalty": 0.3}, "coordination": {"penalty": 0.1}, "informational": {"penalty": 0}}},
}


@pytest.fixture
def fixture(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (Task.__table__, FactorAssessment.__table__, tools.grants, tools.receipts):
        table.create(engine)
    from dmb_agent_contracts.run_store import metadata
    metadata.create_all(engine)
    rubric = copy.deepcopy(RUBRIC)
    monkeypatch.setattr(tools, "get_reference", lambda *_: rubric)
    recalculations = []
    def recompute(session, task, **kwargs):
        recalculations.append(task.task_key)
        task.priority, task.priority_score = "P3", 0.5
    monkeypatch.setattr(tools, "recompute_factor_priority", recompute)
    with Session(engine) as session:
        task = Task(task_key="SYNTHETIC-1", title="Synthetic", raw={})
        session.add(task)
        session.commit()
        digest = tools.source_hash(task)
    def db():
        with Session(engine) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
    def service(x_prioritiser_secret: str = Header(default="")):
        if x_prioritiser_secret != "synthetic-coordinator-secret":
            raise HTTPException(401, "service_auth_required")
    app = FastAPI()
    app.include_router(tools.create_router(db, service))
    with TestClient(app) as client:
        yield client, engine, digest, recalculations, rubric
    engine.dispose()


def grant(fixture, role="strategy-analyst"):
    client, _, digest, _, _ = fixture
    run_id = str(uuid4())
    from dmb_agent_contracts.run_store import runs
    with fixture[1].begin() as connection:
        connection.execute(runs.insert().values(id=run_id, caller="dmb", actor="synthetic-actor", key=run_id,
            request_hash="0"*64, input={}, profile={}, source={"kind":"work_item","ref":"SYNTHETIC-1"},
            operation="priority.estimate", trusted_context={}, status="running", version=1,
            delivery="accepted", created_at=tools.now(), deadline_at=tools.now()+timedelta(seconds=180), result_expired=0))
    response = client.post("/internal/tools/v1/grants", headers={"X-Prioritiser-Secret": "synthetic-coordinator-secret"},
        json={"run_id": run_id, "role": role, "subject": "synthetic-actor", "task_key": "SYNTHETIC-1",
              "source_hash": digest, "allowed_evidence": ["synthetic-source"]})
    assert response.status_code == 200
    return run_id, response.json()


def call(fixture, run, credential, **changes):
    body = {"run_id": run, "call_id": "synthetic-call", "operation": "strategy-assess",
            "answers": {"synthetic": "direct"}, "rationale": "Synthetic rationale", "evidence": ["synthetic-source"], **changes}
    return fixture[0].post("/internal/tools/v1/call", headers={"Authorization": "Bearer "+credential["token"]}, json=body)


def promote(fixture, run):
    from dmb_agent_contracts.run_store import runs
    with Session(fixture[1]) as session:
        result = tools.promote_staged(session, run)
        session.execute(runs.update().where(runs.c.id==run).values(status="completed",version=2))
        session.commit()
        return result


def test_strategy_candidate_and_receipt_are_atomic_and_idempotent(fixture):
    run, credential = grant(fixture)
    first = call(fixture, run, credential)
    assert first.status_code == 200
    assert first.json()["assessment"]["raw_score"] == 10
    assert call(fixture, run, credential).json() == first.json()
    assert call(fixture, run, credential, answers={"synthetic": "none"}).status_code == 409
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 0
    assert not fixture[3]
    assert promote(fixture, run)
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 1
        row = session.scalar(select(FactorAssessment))
        assert row.actor == "strategy-analyst" and row.factor == "F5_strategy_fit"
        assert session.scalar(select(func.count()).select_from(tools.receipts)) == 1
        assert session.scalar(select(tools.grants.c.token_hash)) != credential["token"]
    assert len(fixture[3]) == 1


def test_dependency_write_uses_same_kernel(fixture):
    run, credential = grant(fixture, "dependency-analyst")
    teams = [{"team": "Synthetic dependency", "type": "blocking", "reason": "Synthetic"}]
    response = call(fixture, run, credential, operation="dependency-assess", answers=None, teams=teams)
    assert response.status_code == 200
    expected = tools.score_dependencies(teams, RUBRIC, "Synthetic rationale", ["synthetic-source"]).as_dict()
    assert response.json()["assessment"] == expected
    assert promote(fixture, run)
    with Session(fixture[1]) as session:
        row = session.scalar(select(FactorAssessment))
        assert row.factor == "F6_dependencies" and row.actor == "dependency-analyst"


@pytest.mark.parametrize("changes", [
    {"operation": "dependency-assess", "answers": None, "teams": []},
    {"run_id": str(uuid4())}, {"task_key": "OTHER"}, {"factor": "F6"}, {"evidence": ["foreign-source"]},
])
def test_cross_scope_forbidden_before_write(fixture, changes):
    run, credential = grant(fixture)
    assert call(fixture, run, credential, **changes).status_code == 403
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 0
        assert session.scalar(select(func.count()).select_from(tools.receipts)) == 0


@pytest.mark.parametrize("extra", [{"url": "https://example.invalid"}, {"sql": "DROP TABLE task"},
    {"user_id": 1}, {"actor": "methodologist"}, {"operation": "attribution-run"}, {"path": "C:/secret"}])
def test_strict_input_no_arbitrary_identity_sql_files_or_admin(fixture, extra):
    run, credential = grant(fixture)
    assert call(fixture, run, credential, **extra).status_code == 422
    assert not fixture[3]


def test_revoke_and_expiry_apply_to_receipt_reads(fixture):
    run, credential = grant(fixture)
    assert call(fixture, run, credential).status_code == 200
    response = fixture[0].post(f"/internal/tools/v1/grants/{credential['grant_id']}/revoke",
        headers={"X-Prioritiser-Secret": "synthetic-coordinator-secret"})
    assert response.status_code == 200
    assert call(fixture, run, credential).status_code == 401
    run, credential = grant(fixture)
    with fixture[1].begin() as conn:
        conn.execute(tools.grants.update().values(expires_at=tools.now()-timedelta(seconds=1)))
    assert call(fixture, run, credential).status_code == 401


@pytest.mark.parametrize("change", ["source", "rubric"])
def test_changed_source_or_methodology_invalidates_grant(fixture, change):
    run, credential = grant(fixture)
    if change == "source":
        with Session(fixture[1]) as session:
            session.scalar(select(Task)).title = "Edited synthetic input"
            session.commit()
    else:
        fixture[4]["strategy_fit"]["rubric_version"] += 1
    assert call(fixture, run, credential).status_code == 409


def test_cancelled_parent_forbids_late_tool_and_candidate_publication(fixture):
    from dmb_agent_contracts.run_store import runs
    run, credential = grant(fixture)
    assert call(fixture,run,credential).json()['status'] == 'staged'
    with fixture[1].begin() as connection:
        connection.execute(runs.update().where(runs.c.id==run).values(status='cancelled',version=2))
    assert call(fixture,run,credential,call_id='late').status_code == 409
    with Session(fixture[1]) as session, pytest.raises(HTTPException) as error:
        tools.promote_staged(session,run)
    assert error.value.status_code == 409
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 0
        assert session.scalar(select(Task)).strategy_fit_raw is None
        assert session.scalar(select(func.count()).select_from(tools.receipts)) == 1


def test_failed_parent_commit_rolls_back_promoted_product(fixture):
    run, credential = grant(fixture)
    assert call(fixture,run,credential).status_code == 200
    with pytest.raises(RuntimeError,match='synthetic_parent_cas_lost'):
        with Session(fixture[1]) as session:
            tools.promote_staged(session,run)
            session.flush()
            raise RuntimeError('synthetic_parent_cas_lost')
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 0
        assert session.scalar(select(Task)).strategy_fit_raw is None
    assert promote(fixture,run)


@pytest.mark.parametrize('change',['source','rubric'])
def test_staged_candidate_rechecks_current_source_and_rubric(fixture,change):
    run, credential = grant(fixture)
    assert call(fixture,run,credential).status_code == 200
    if change == 'source':
        with Session(fixture[1]) as session:
            session.scalar(select(Task)).title = 'Changed after candidate'
            session.commit()
    else:
        fixture[4]['strategy_fit']['rubric_version'] += 1
    with Session(fixture[1]) as session, pytest.raises(HTTPException) as error:
        tools.promote_staged(session,run)
    assert error.value.status_code == 409
    with Session(fixture[1]) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 0


def test_token_cannot_mint_grants_or_revoke(fixture):
    run, credential = grant(fixture)
    response = fixture[0].post(f"/internal/tools/v1/grants/{credential['grant_id']}/revoke",
        headers={"X-Prioritiser-Secret": credential["token"]})
    assert response.status_code == 401
    assert fixture[0].post("/internal/tools/v1/grants", json={},
        headers={"X-Prioritiser-Secret": credential["token"]}).status_code == 401


def test_reads_and_budget_do_not_load_retrieval_or_call_model(fixture):
    run, credential = grant(fixture)
    for index in range(12):
        response = call(fixture, run, credential, call_id=str(index), operation="rubric-read", answers=None,
                        rationale="", evidence=[])
        assert response.status_code == 200
    assert call(fixture, run, credential, call_id="excess", operation="rubric-read", answers=None,
                rationale="", evidence=[]).status_code == 429
    assert not fixture[3]


def test_node_bridge_calls_actual_python_http_kernel(fixture):
    import os, shutil, socket, subprocess, threading, time
    from pathlib import Path
    import uvicorn
    from fastapi.encoders import jsonable_encoder
    node = shutil.which("node")
    if not node:
        pytest.skip("Node required for isolated HTTP bridge integration")
    run, credential = grant(fixture)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(fixture[0].app, log_level="critical", access_log=False, lifespan="off"))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]))
    thread.start()
    try:
        deadline = time.monotonic()+5
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        route = f"http://127.0.0.1:{sock.getsockname()[1]}"
        env = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
        env.update(PRIORITISER_TOOL_MODE="http", PRIORITISER_TOOL_BASE_URL=route,
            PRIORITISER_TOOL_TOKEN=credential["token"], PRIORITISER_TOOL_RUN_ID=run,
            PRIORITISER_PYTHON="/nonexistent/python")
        helper = (Path(__file__).parents[1]/".opencode/lib/run-cli.js").as_uri()
        code = f"import {{runCli}} from {helper!r}; const args=['assess-strategy','SYNTHETIC-1','--answers','{{\"synthetic\":\"direct\"}}','--rationale','Synthetic']; const a=await runCli('/no/project',args); const b=await runCli('/no/project',args); if(a!==b) throw new Error('unstable receipt'); console.log(JSON.parse(a).assessment.raw_score);"
        result = subprocess.run([node, "--input-type=module", "-e", code], env=env,
                                text=True, capture_output=True, timeout=15)
        assert result.returncode == 0, "Isolated Node-to-Python tool call failed"
        assert result.stdout.strip() == "10"
        assert not fixture[3]
        assert promote(fixture, run)
        assert len(fixture[3]) == 1
        with Session(fixture[1]) as session:
            assert session.scalar(select(func.count()).select_from(FactorAssessment)) == 1
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive()


def test_manifest_matches_current_strict_schemas():
    import json
    from pathlib import Path
    manifest = json.loads((Path(__file__).parents[1]/".opencode/remote-tools.manifest.json").read_text(encoding="utf-8"))
    assert manifest["input_schema"] == tools.ToolCall.model_json_schema()
    assert manifest["grant_schema"] == tools.GrantRequest.model_json_schema()
    assert {entry["tool"] for entry in manifest["tools"]} == set.union(*tools.OPERATIONS.values())
    assert "attribution-run" in manifest["excluded"]


def test_snapshot_hash_is_controller_only(fixture):
    client, _, digest, _, _ = fixture
    assert client.get("/internal/tools/v1/snapshots/SYNTHETIC-1").status_code == 401
    response = client.get("/internal/tools/v1/snapshots/SYNTHETIC-1", headers={"X-Prioritiser-Secret": "synthetic-coordinator-secret"})
    assert response.status_code == 200 and response.json()["source_hash"] == digest


def test_frozen_migration_matches_runtime_schema():
    import importlib.util
    from pathlib import Path
    from sqlalchemy.schema import CreateTable
    from sqlalchemy.dialects import postgresql
    path = Path(__file__).parents[1]/"alembic/versions/20261102_01_remote_tools.py"
    spec = importlib.util.spec_from_file_location("frozen_tool_schema", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    for runtime in (tools.grants, tools.receipts):
        frozen = migration.metadata.tables[runtime.name]
        assert str(CreateTable(runtime).compile(dialect=postgresql.dialect())) == str(CreateTable(frozen).compile(dialect=postgresql.dialect()))


def test_migration_rejects_partial_schema_before_ddl(monkeypatch):
    import importlib.util
    from pathlib import Path
    from sqlalchemy import inspect, text
    path = Path(__file__).parents[1]/"alembic/versions/20261102_01_remote_tools.py"
    spec = importlib.util.spec_from_file_location("rejected_tool_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE agent_tool_grants (unexpected INTEGER)"))
        monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
        with pytest.raises(RuntimeError, match="Incomplete remote tool schema"):
            migration.upgrade()
        assert inspect(connection).get_table_names() == ["agent_tool_grants"]
    engine.dispose()


def test_tool_token_cannot_authenticate_actual_coordinator_or_admin_policy(fixture):
    from value_priority_assessor.service_auth import verify_secret
    _, credential = grant(fixture)
    for capability in ("coordinator", "methodologist"):
        with pytest.raises(HTTPException) as error:
            verify_secret(credential["token"], "synthetic-controller-only-secret", capability, debug=False)
        assert error.value.status_code == 401
