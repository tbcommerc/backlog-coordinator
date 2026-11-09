"""Actual V1 container API/worker/PG replay with an authored model fixture."""
import argparse
import json
from pathlib import Path
import runpy
import subprocess
from uuid import uuid4

HARNESS = r'''
import json,os,threading,time
from pathlib import Path
database=os.environ['QUALIFICATION_DATABASE']
assert database.startswith('v1_container_') and database.replace('_','').isalnum()
os.environ.update(AGENT_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:5432/'+database,
 AGENT_MODEL_API_KEY='synthetic-not-sent',AGENT_MODEL_BASE_URL='https://opencode.ai/zen/go/v1',
 AGENT_MODEL_NAME='synthetic',AGENT_LLM_PROVIDER='openai_compat',
 AGENT_SERVICE_SECRET='synthetic-container-service-secret',AGENT_UNIT_TEST_MODE='false',
 DMB_AGENT_SERVICE_ID='business-analyst',DMB_AGENT_LIMITER_MODE='standalone',
 DMB_AGENT_LIMITER_REDIS_URL=os.environ['QUALIFICATION_REDIS_URL'],
 DMB_AGENT_LIMITER_STATE_DIR='/tmp/limiter',DMB_AGENT_LIMITER_NAMESPACE=database)
from dmb_agent_contracts.entry import prepare_runtime
prepare_runtime()
from business_analyst import audit
audit.LOG_DIR=Path('/tmp/audit')
from business_analyst.session import session_store
from dmb_agent_contracts.run_migration import migrate
session_store.migrate_schema()
migrate(session_store.engine,backup_verified=True,allowed_existing=('sessions','message_receipts'))
from business_analyst.dialogue import agentic
from business_analyst.kb.retrieval import retrieval
from business_analyst.composer import composer
calls=[]
class Fixture:
    name='authored-fixture'
    model='synthetic'
    def available(self):return True
    def chat_json(self,messages,**options):
        calls.append(1)
        return json.dumps({'facts':[{'field':'need_statement','value':'Добавить в карточку сделки клиента и ИНН',
          'confidence':0.95,'evidence':'Добавить в карточку сделки клиента и ИНН'}],
          'next_action':'ask','focus':'role','reply':'Кто работает с карточкой сделки?'},ensure_ascii=False)
    chat=chat_json
agentic.get_llm=lambda:Fixture()
retrieval.answer_from_kb=lambda *args,**kwargs:[]
composer.check_duplicates=lambda *args,**kwargs:[]
import httpx,urllib.request,uvicorn
original=httpx.HTTPTransport.handle_request
def restricted(self,request):
    assert request.url.host=='127.0.0.1','unexpected_external_http'
    return original(self,request)
httpx.HTTPTransport.handle_request=restricted
urllib.request.OpenerDirector.open=lambda *args,**kwargs:(_ for _ in ()).throw(AssertionError('external_http_forbidden'))
from business_analyst.main import app
server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=19000,log_level='warning'))
thread=threading.Thread(target=server.run,daemon=True)
thread.start()
try:
    with httpx.Client(base_url='http://127.0.0.1:19000',timeout=20,trust_env=False) as client:
        for _ in range(100):
            try:
                if client.get('/health/ready').status_code==200:break
            except httpx.TransportError:pass
            time.sleep(.1)
        else:raise AssertionError('container_not_ready')
        headers={'X-Agent-Secret':'synthetic-container-service-secret'}
        assert client.post('/api/agent/new-session',json={'user_id':123}).status_code==403
        created=client.post('/api/agent/new-session',json={'user_id':123},headers=headers)
        assert created.status_code==200,created.status_code
        sid=created.json()['session_id']
        body={'session_id':sid,'message_id':'stable-container-message',
          'message':'Добавить в карточку сделки клиента и ИНН','context':{'user_id':123,'is_ba':True}}
        first=client.post('/api/agent/chat',json=body,headers=headers)
        assert first.status_code==200,first.text
        assert first.json()['slots']['need_statement']==body['message'] and len(calls)==1
        again=client.post('/api/agent/chat',json=body,headers=headers)
        assert again.json()==first.json() and len(calls)==1
        conflict=client.post('/api/agent/chat',json={**body,'message':'Другое сообщение'},headers=headers)
        assert conflict.status_code==409 and len(calls)==1
        restored=client.get('/api/agent/session/'+sid,headers=headers)
        assert restored.status_code==200 and restored.json()['slots']['need_statement']==body['message']
        from sqlalchemy import select,func
        from dmb_agent_contracts.run_store import runs
        with session_store.engine.connect() as connection:
            assert connection.scalar(select(func.count()).select_from(runs))==1
            row=connection.execute(select(runs)).mappings().one()
            assert row['status']=='completed'
        report={'status':'PASS','scope':'v1_container_real_http_pg_worker_authored_fixture',
          'checks':['real_lifespan_readiness','service_secret','legacy_dto','durable_worker',
          'grounded_fact','stable_repeat_one_dispatch','changed_body_409','history_read'],
          'source_mounts':0,'runtime_package_installs':0,'live_model_calls':0,
          'fixture_model_calls':len(calls),'protected_writes':0,'real_remote':'NOT_RUN',
          'model_quality_claim':False,'production_compose':'NOT_TESTED'}
finally:
    server.should_exit=True
    thread.join(15)
    session_store.engine.dispose()
assert not thread.is_alive(),'lifespan_shutdown_incomplete'
print(json.dumps(report),flush=True)
'''


def main(*, harness=HARNESS, prefix='v1_container_', label='v1', runtime_input=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--image',required=True)
    parser.add_argument('--postgres-container-id',required=True)
    parser.add_argument('--redis-container-id',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    output=args.output.resolve()
    if not output.is_relative_to(root/'.runtime') or output.exists():
        parser.error('New workspace evidence path required')
    command=runpy.run_path(str(root/'scripts/qualify-meeting-container.py'))['command']
    infos=[]
    for identity in (args.postgres_container_id,args.redis_container_id):
        if len(identity)!=64 or any(c not in '0123456789abcdef' for c in identity):
            parser.error('Exact disposable container identities required')
        info=json.loads(command(['inspect',identity]))[0]
        if info['Id']!=identity:raise RuntimeError('container_identity_mismatch')
        infos.append(info)
    if infos[0]['Name']!='/dmb-agent-qualification' or infos[1]['Name']!='/dmb-agent-gate-qualification':
        raise RuntimeError('disposable_infrastructure_required')
    networks=sorted(set(infos[0]['NetworkSettings']['Networks'])&set(infos[1]['NetworkSettings']['Networks']))
    if not networks:raise RuntimeError('shared_qualification_network_required')
    import ipaddress
    address=str(ipaddress.IPv4Address(infos[1]['NetworkSettings']['Networks'][networks[0]]['IPAddress']))
    image=command(['image','inspect',args.image,'--format','{{.Id}}'])
    database=prefix+uuid4().hex
    command(['exec',args.postgres_container_id,'createdb','-U','postgres',database])
    marker=uuid4().hex
    name=label+'-container-qualification-'+marker[:12]
    output.parent.mkdir(parents=True,exist_ok=True)
    report={'status':'FAIL','image_id':image,'database':database,'live_model_calls':0}
    try:
        result=subprocess.run(['docker','run',*(['-i'] if runtime_input is not None else []),'--rm','--pull=never','--name',name,
          '--label','dmb.agent.qualification='+marker,'--network','container:'+args.postgres_container_id,
          '--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--cap-drop','ALL',
          '--security-opt','no-new-privileges','--env','QUALIFICATION_DATABASE='+database,
          '--env','QUALIFICATION_REDIS_URL=redis://'+address+':6379/0',image,'python','-c',harness],
          input=runtime_input,capture_output=True,text=True,timeout=120)
        (output.parent/'container-runtime.log').write_text(result.stdout+result.stderr,encoding='utf-8')
        if result.returncode:raise RuntimeError('synthetic_container_workflow_failed')
        report.update(json.loads(result.stdout.strip().splitlines()[-1]))
    finally:
        if report['status']!='PASS':
            try:
                remaining=json.loads(command(['inspect',name],timeout=10))[0]
                if remaining['Config']['Labels'].get('dmb.agent.qualification')!=marker:
                    raise RuntimeError('ownership_mismatch')
                command(['rm','--force',remaining['Id']],timeout=15)
                report['cleanup']='owned_container_removed'
            except (RuntimeError,subprocess.TimeoutExpired,ValueError):
                report['cleanup']='not_confirmed_or_already_removed'
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    main()
