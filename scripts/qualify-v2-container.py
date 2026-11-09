"""Actual V2 document review through container HTTP/worker, without live inference."""
from pathlib import Path
import runpy

HARNESS = r'''
import json,os,threading,time
from pathlib import Path
database=os.environ['QUALIFICATION_DATABASE']
assert database.startswith('v2_container_') and database.replace('_','').isalnum()
os.environ.update(AGENT_V2_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:5432/'+database,
 AGENT_V2_MODEL_API_KEY='synthetic-not-sent',AGENT_V2_MODEL_BASE_URL='https://opencode.ai/zen/go/v1',
 AGENT_V2_MODEL_NAME='synthetic',AGENT_V2_LLM_PROVIDER='openai_compat',
 AGENT_V2_SERVICE_SECRET='synthetic-container-service-secret',AGENT_V2_UNIT_TEST_MODE='false',
 AGENT_V2_ENABLED='true',AGENT_V2_KILL_SWITCH='false',
 DMB_AGENT_SERVICE_ID='business-analyst-experimental',DMB_AGENT_LIMITER_MODE='standalone',
 DMB_AGENT_LIMITER_REDIS_URL=os.environ['QUALIFICATION_REDIS_URL'],
 DMB_AGENT_LIMITER_STATE_DIR='/tmp/limiter',DMB_AGENT_LIMITER_NAMESPACE=database)
from dmb_agent_contracts.entry import prepare_runtime
prepare_runtime()
from business_analyst_experimental import audit
audit.LOG_DIR=Path('/tmp/audit')
from business_analyst_experimental.session import session_store
from dmb_agent_contracts.run_migration import migrate
session_store.migrate_schema()
migrate(session_store.engine,backup_verified=True,allowed_existing=('sessions','message_receipts'))
from business_analyst_experimental.v2 import document_workspace as workspace
calls=[]
class Fixture:
    name='authored-fixture'
    model='synthetic'
    def available(self):return True
    def chat_json(self,messages,**options):
        calls.append(1)
        return json.dumps({'coverage':[],'questions':[],'unsupported':[],'findings':[],
           'summary':'Синтетическое независимое ревью завершено.'},ensure_ascii=False)
    chat=chat_json
workspace.get_llm=lambda:Fixture()
state=session_store.new_session(123)
state.operator_role='BA'
state.product_mode='requirement_copilot'
state.artifact_type='business_requirement_v2'
workspace.save_sections(state,{'title':'Синтетическое БТ','problem_statement':'Нужен экспорт CSV.'})
session_store.save(state)
sid=state.session_id
before=state.draft['fingerprint']
import httpx,urllib.request,uvicorn
original=httpx.HTTPTransport.handle_request
def restricted(self,request):
    assert request.url.host=='127.0.0.1','unexpected_external_http'
    return original(self,request)
httpx.HTTPTransport.handle_request=restricted
urllib.request.OpenerDirector.open=lambda *args,**kwargs:(_ for _ in ()).throw(AssertionError('external_http_forbidden'))
from business_analyst_experimental.main import app
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
        body={'session_id':sid,'user_id':123,'idempotency_key':'stable-container-review',
              'action':'review','expected_draft_hash':before}
        assert client.post('/api/agent-v2/document-action',json=body).status_code==403
        first=client.post('/api/agent-v2/document-action',json=body,headers=headers)
        assert first.status_code==200,first.text
        # Review performs the existing source-transfer check and independent review.
        assert len(calls)==2,{'fixture_calls':len(calls),'action':first.json().get('action')}
        after=session_store.get(sid)
        assert after.draft['fingerprint']==before and after.review_status!='approved'
        assert after.document_review['status']=='completed'
        assert after.document_review['transfer_check']['status']=='complete'
        again=client.post('/api/agent-v2/document-action',json=body,headers=headers)
        assert again.json()==first.json() and len(calls)==2
        conflict=client.post('/api/agent-v2/document-action',json={**body,'instruction':'Другая инструкция'},headers=headers)
        assert conflict.status_code==409 and len(calls)==2
        foreign=client.post('/api/agent-v2/document-action',json={**body,'user_id':124},headers=headers)
        assert foreign.status_code==404 and len(calls)==2
        from sqlalchemy import select,func
        from dmb_agent_contracts.run_store import runs
        with session_store.engine.connect() as connection:
            assert connection.scalar(select(func.count()).select_from(runs))==1
            assert connection.execute(select(runs)).mappings().one()['status']=='completed'
        report={'status':'PASS','scope':'v2_container_real_http_pg_worker_authored_fixture',
          'checks':['real_lifespan_readiness','service_secret','legacy_document_dto','durable_worker',
          'independent_review_no_document_mutation','no_auto_approval','stable_repeat_one_dispatch',
          'changed_body_409','foreign_owner_404','two_original_transfer_and_review_model_steps'],
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


if __name__=='__main__':
    helper=runpy.run_path(str(Path(__file__).with_name('qualify-v1-container.py')))
    helper['main'](harness=HARNESS,prefix='v2_container_',label='v2')
