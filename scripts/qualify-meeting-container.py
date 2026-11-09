"""Functional API/worker acceptance from an existing image, without source mounts.

Only a fresh technical database in the migration qualification container is used.
The model transport is explicitly synthetic; this never spends the live Go budget.
"""
import argparse
import json
import subprocess
from pathlib import Path
from uuid import uuid4


HARNESS = r'''
import hashlib,json,threading,time
from uuid import uuid4
import httpx,uvicorn
from sqlalchemy import create_engine,inspect,select,func
from dmb_agent_contracts.go import GoModel
from meeting_analyzer.api import create_app
from meeting_analyzer.config import Settings
from meeting_analyzer.migrate import migrate
from meeting_analyzer.store import Store,runs
from meeting_analyzer.worker import execute
from dmb_agent_contracts.entry import prepare_runtime
from dmb_agent_contracts.limiter import from_environment
from dmb_agent_contracts.limiter_health import LimiterReadiness
import os

database=os.environ['QUALIFICATION_DATABASE']
assert database.startswith('meeting_container_') and database.replace('_','').isalnum()
os.environ.update(DMB_AGENT_SERVICE_ID='meeting-analyzer',DMB_AGENT_LIMITER_MODE='standalone',
    DMB_AGENT_LIMITER_REDIS_URL=os.environ['QUALIFICATION_REDIS_URL'],DMB_AGENT_LIMITER_STATE_DIR='/tmp/limiter-state',
    DMB_AGENT_LIMITER_NAMESPACE='qualification-'+database)
profile=prepare_runtime()
assert profile['limit']==1
engine=create_engine('postgresql+psycopg://postgres@127.0.0.1:5432/'+database,connect_args={'connect_timeout':5})
assert not inspect(engine).get_table_names(), 'fresh technical database required'
migrate(engine)
store=Store(engine)
settings=Settings(_env_file=None,database_url=str(engine.url),service_secret='synthetic-container-secret',model_api_key='synthetic-model-key',queue_limit=100)
app=LimiterReadiness(create_app(settings,engine))
server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=19500,log_level='error',access_log=False))
thread=threading.Thread(target=server.run,daemon=True)
thread.start()
deadline=time.monotonic()+15
while not server.started:
    assert thread.is_alive() and time.monotonic()<deadline, 'container API startup deadline'
    time.sleep(.05)
prefix='/internal/agent/v1/runs'
headers={'X-Agent-Secret':'synthetic-container-secret','X-Agent-Caller':'dmb','X-Actor-Ref':'synthetic-actor'}
model_calls=[]
def provider(request):
    model_calls.append(str(request.url))
    return httpx.Response(200,json={'choices':[{'message':{'content':'{"items":[]}'},'finish_reason':'stop'}],'model':'synthetic'})
def body():
    text='Synthetic meeting without decisions.'
    return {'contract_version':'1.0','operation':'meeting.extract','source':{'kind':'meeting_capture','ref':str(uuid4()),'revision':1,'snapshot_hash':'sha256:'+hashlib.sha256(text.encode()).hexdigest()},'input':{'transcript':text}}
checks=[]
latencies=[]
try:
    with httpx.Client(base_url='http://127.0.0.1:19500',timeout=10,follow_redirects=False) as client:
        ready=client.get('/health/ready')
        assert ready.status_code==200 and 'x-agent-operation-limit' not in ready.headers
        assert client.get('/internal/agent/v1/capabilities',headers=headers).json()['limiter']['operation_limit']==1
        assert client.post(prefix,json=body()).status_code==401
        checks.append('real_http_auth_and_readiness')
        request=body()
        scoped={**headers,'Idempotency-Key':str(uuid4())}
        start=time.monotonic();accepted=client.post(prefix,json=request,headers=scoped);latencies.append(time.monotonic()-start)
        assert accepted.status_code==202
        identifier=accepted.json()['run_id'];url=prefix+'/'+identifier
        assert client.post(prefix,json=request,headers=scoped).json()['run_id']==identifier
        claimed=store.claim();assert claimed['id']==identifier
        with httpx.Client(transport=httpx.MockTransport(provider)) as transport:
            execute(store,claimed,GoModel(base_url='https://opencode.ai/zen/go/v1',api_key='synthetic-model-key',model='synthetic',client=transport))
        result=client.get(url+'/result',headers=headers)
        assert result.status_code==200 and result.json()['result']=={'items':[]}
        assert result.json()['payload_hash']==hashlib.sha256(b'{"items":[]}').hexdigest()
        assert client.get(url+'/result',headers={**headers,'X-Actor-Ref':'other'}).status_code==404
        stream=client.get(url+'/events',headers=headers)
        assert stream.status_code==200 and 'event: result_ready' in stream.text
        assert client.post(url+'/acknowledgements',headers=headers).json()=={'acknowledged':True}
        store.expire()
        assert client.get(url+'/result',headers=headers).status_code==410
        assert len(model_calls)==1 and store.claim() is None
        checks.append('api_pg_worker_result_scope_sse_ack_retention')
        request=body();scoped={**headers,'Idempotency-Key':str(uuid4())}
        cancelled=client.post(prefix+'/cancellations',json=request,headers=scoped)
        assert cancelled.status_code==200 and cancelled.json()['status']=='cancelled'
        late=client.post(prefix,json=request,headers=scoped)
        assert late.status_code==200 and late.json()['run_id']==cancelled.json()['run_id'] and late.json()['status']=='cancelled'
        assert store.claim() is None and len(model_calls)==1
        checks.append('unknown_create_cancellation_tombstone_no_inference')
        for _ in range(19):
            request=body();scoped={**headers,'Idempotency-Key':str(uuid4())}
            start=time.monotonic();queued=client.post(prefix,json=request,headers=scoped);latencies.append(time.monotonic()-start)
            assert queued.status_code==202
            assert client.get(prefix+'/'+queued.json()['run_id'],headers=headers).status_code==200
            assert client.post(prefix+'/'+queued.json()['run_id']+'/cancel',headers=headers).status_code==200
        checks.append('twenty_sequential_technical_admissions')
        assert store.claim() is None and len(model_calls)==1
        with engine.connect() as connection:
            count=connection.scalar(select(func.count()).select_from(runs))
        limiter=from_environment()
        assert limiter.client.command('HLEN',limiter.keys[2])==0
        report={'standalone_limiter':'PASS','status':'PASS','scope':'container_real_http_pg_worker_mock_model','source_mounts':0,'runtime_package_installs':0,'live_go_calls':0,'mock_model_calls':len(model_calls),'checks':checks,'runs':count,'admission_samples':len(latencies),'admission_p95_seconds':sorted(latencies)[18],'global_limiter':'NOT_TESTED','production_compose':'NOT_TESTED'}
finally:
    server.should_exit=True
    thread.join(15)
    engine.dispose()
assert not thread.is_alive(), 'ASGI shutdown did not finish'
print(json.dumps(report),flush=True)
'''


def command(args, timeout=30):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("container_qualification_command_failed")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="dmb-agent/meeting-analyzer:migration-20261103")
    parser.add_argument("--postgres-container-id", required=True)
    parser.add_argument("--redis-container-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise RuntimeError("evidence_exists_no_replacement")
    if len(args.postgres_container_id) != 64 or any(c not in "0123456789abcdef" for c in args.postgres_container_id):
        raise RuntimeError("full_disposable_container_id_required")
    info = json.loads(command(["inspect", args.postgres_container_id]))[0]
    if info["Id"] != args.postgres_container_id:
        raise RuntimeError("owned_disposable_postgres_required")
    if len(args.redis_container_id) != 64 or any(c not in "0123456789abcdef" for c in args.redis_container_id):
        raise RuntimeError("full_disposable_redis_container_id_required")
    redis_info = json.loads(command(["inspect", args.redis_container_id]))[0]
    shared = sorted(set(info["NetworkSettings"]["Networks"]) & set(redis_info["NetworkSettings"]["Networks"]))
    if not shared:
        raise RuntimeError("qualification_containers_require_shared_network")
    import ipaddress
    redis_ip = str(ipaddress.IPv4Address(redis_info["NetworkSettings"]["Networks"][shared[0]]["IPAddress"]))
    redis_url = "redis://" + redis_ip + ":6379/0"
    image_id = command(["image", "inspect", args.image, "--format", "{{.Id}}"])
    database = "meeting_container_" + uuid4().hex
    command(["exec", args.postgres_container_id, "createdb", "-U", "postgres", database])
    name = "meeting-container-qualification-" + uuid4().hex[:12]
    marker = uuid4().hex
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {"status": "NOT_RUN", "image_id": image_id, "database": database, "live_go_calls": 0}
    try:
        # The image must already exist; no registry access or source/secret mounts.
        result = subprocess.run(["docker", "run", "--rm", "--pull=never", "--name", name,
            "--label", "dmb.agent.qualification=" + marker,
            "--network", "container:" + args.postgres_container_id,
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--env", "QUALIFICATION_DATABASE=" + database,
            "--env", "QUALIFICATION_REDIS_URL=" + redis_url,
            args.image, "python", "-c", HARNESS], capture_output=True, text=True, timeout=90)
        if result.returncode:
            # This process only sees its fresh technical DB and synthetic profile.
            (args.output.parent / "container-runtime.log").write_text(result.stdout+result.stderr, encoding="utf-8")
            raise RuntimeError("synthetic_container_runtime_failed")
        report.update(json.loads(result.stdout.strip().splitlines()[-1]))
    except (RuntimeError, subprocess.TimeoutExpired, ValueError):
        report["status"] = "FAIL"
        raise
    finally:
        if report["status"] != "PASS":
            # Never leave a timed-out synthetic API container behind or kill an
            # unrelated container merely because it occupies the expected name.
            try:
                remaining = json.loads(command(["inspect", name], timeout=10))[0]
                labels = remaining.get("Config", {}).get("Labels", {}) or {}
                if labels.get("dmb.agent.qualification") != marker:
                    raise RuntimeError("qualification_container_ownership_mismatch")
                command(["rm", "--force", remaining["Id"]], timeout=15)
                report["failure_cleanup"] = "owned_container_removed"
            except (RuntimeError, subprocess.TimeoutExpired, ValueError):
                report["failure_cleanup"] = "not_confirmed"
        args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
