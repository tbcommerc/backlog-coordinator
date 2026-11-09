"""Ten logical operations from the five independent Python environments."""
import argparse
import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4


CHILD = r'''
import json,os,time
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from dmb_agent_contracts.chat import ChatCompletionModel
from dmb_agent_contracts.limiter import Redis
from dmb_agent_contracts.model import ModelRequest
from dmb_agent_contracts.operation import operation_scope,reserve_model_attempt
redis=Redis(os.environ['DMB_AGENT_LIMITER_REDIS_URL'])
prefix='dmb:agent-gate:'+os.environ['DMB_AGENT_LIMITER_NAMESPACE']+':qualification-'
def provider(path,payload,timeout):
    reserve_model_attempt()
    count=redis.command('INCR',prefix+'current')
    redis.command('EVAL',"local v=tonumber(ARGV[1]);local old=tonumber(redis.call('GET',KEYS[1]) or '0');if v>old then redis.call('SET',KEYS[1],v) end;return v",1,prefix+'maximum',count)
    try:
        assert count<=2,'global_limit_exceeded'
        time.sleep(.15)
        return {'choices':[{'message':{'content':'{"items":[]}'},'finish_reason':'stop'}],'model':'synthetic'}
    finally:
        redis.command('DECR',prefix+'current')
run_id=uuid4()
deadline=datetime.now(timezone.utc)+timedelta(seconds=30)
with operation_scope(run_id=run_id,deadline_at=deadline,max_model_attempts=1,actor_ref='synthetic:'+os.environ['DMB_AGENT_SERVICE_ID']) as operation:
    result=ChatCompletionModel(transport=provider,model='synthetic').complete(ModelRequest(
        request_id=uuid4(),run_id=run_id,purpose='extraction',messages=[{'role':'user','content':'Synthetic'}],system_prompt='JSON',
        output_schema={},model_profile='qualification',deadline_at=deadline,max_output_tokens=100))
    assert result.structured=={'items':[]} and operation.model_attempts==1
print(json.dumps({'service':os.environ['DMB_AGENT_SERVICE_ID'],'status':'PASS','model_attempts':1}),flush=True)
'''


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():
        raise RuntimeError("evidence_exists_no_replacement")
    redis_url=os.environ.get("AGENT_LIMITER_TEST_REDIS_URL")
    if not redis_url:
        raise RuntimeError("explicit_disposable_redis_required")
    from dmb_agent_contracts.limiter import RedisLimiter,LimiterConfig
    root=Path(__file__).resolve().parents[1]
    namespace="cross-process-"+uuid4().hex
    config=LimiterConfig(redis_url,namespace,uuid4().hex,args.output.parent.resolve()/"leases")
    gate=RedisLimiter(config)
    gate.bootstrap(initialize=True)
    environments={"business-analyst":root/".venv", "business-analyst-experimental":root/".venv-agent-v2",
        "meeting-analyzer":root/".venv", "value-priority-assessor":root/".venv-prioritiser",
        "backlog-assistant":root/"agents/backlog-assistant/.venv"}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    from agent_evidence import evidence_header
    report={**evidence_header("NFR-01,NFR-02,NFR-05,NFR-10","ten_processes_five_runtime_environments_mock_provider","limiter-ten-logical-operations-v1"), "status":"FAIL",
        "live_go_calls":0,"global_limit":2,"namespace":namespace,"operations":[]}
    children=[]
    try:
        for service,environment in environments.items():
            for _ in range(2):
                env=dict(os.environ)
                env.pop("PYTHONPATH",None)  # Verify installed SDK, not repository imports.
                env.update(DMB_AGENT_LIMITER_MODE="global",DMB_AGENT_LIMITER_REDIS_URL=redis_url,
                    DMB_AGENT_LIMITER_NAMESPACE=namespace,DMB_AGENT_LIMITER_EPOCH=config.epoch,
                    DMB_AGENT_LIMITER_JOURNAL_DIR=str(config.journal_dir),DMB_AGENT_SERVICE_ID=service,
                    DMB_AGENT_REQUIRE_LIMITER="true")
                python=environment/("Scripts/python.exe" if os.name=="nt" else "bin/python")
                children.append(subprocess.Popen([str(python),"-u","-c",CHILD],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
        for child in children:
            output,error=child.communicate(timeout=45)
            if child.returncode:
                # These children only receive synthetic model credentials/data.
                (args.output.parent/"failed-process.log").write_text(error,encoding="utf-8")
                raise RuntimeError("logical_operation_failed")
            report["operations"].append(json.loads(output.strip().splitlines()[-1]))
        prefix="dmb:agent-gate:"+namespace+":qualification-"
        report["maximum_observed_model_operations"]=int(gate.client.command("GET",prefix+"maximum"))
        report["active_after"]=gate.client.command("HLEN",gate.keys[2])
        report["queued_after"]=gate.client.command("ZCARD",gate.keys[3])
        assert report["maximum_observed_model_operations"]==2 and report["active_after"]==0 and report["queued_after"]==0
        assert len(report["operations"])==10
        report["status"]="PASS"
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()  # Exact owned Popen handles, never PID/name scans.
                child.wait(timeout=5)
        args.output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report),flush=True)


if __name__=="__main__":
    main()
