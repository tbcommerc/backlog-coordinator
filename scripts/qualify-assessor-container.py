"""Container coordinator contract on a declared light deterministic test profile."""
from pathlib import Path
import runpy

HARNESS = r'''
import json,os,threading,time
database=os.environ['QUALIFICATION_DATABASE']
assert database.startswith('assessor_container_') and database.replace('_','').isalnum()
os.environ.update(PRIORITISER_DATABASE_URL='postgresql+psycopg://postgres@127.0.0.1:5432/'+database,
 PRIORITISER_MODEL_API_KEY='synthetic-not-sent',PRIORITISER_MODEL_BASE_URL='https://opencode.ai/zen/go/v1',
 PRIORITISER_MODEL_NAME='synthetic',PRIORITISER_LLM_PROVIDER='openai_compat',
 PRIORITISER_SERVICE_SECRET='synthetic-container-service-secret',PRIORITISER_UNIT_TEST_MODE='false',
 PRIORITISER_RAG_VECTOR='false',PRIORITISER_VALUE_ANALOGY='false',PRIORITISER_STRATEGY_USE_RAG='false',
 DMB_AGENT_SERVICE_ID='value-priority-assessor',DMB_AGENT_LIMITER_MODE='standalone',
 DMB_AGENT_LIMITER_REDIS_URL=os.environ['QUALIFICATION_REDIS_URL'],
 DMB_AGENT_LIMITER_STATE_DIR='/tmp/limiter',DMB_AGENT_LIMITER_NAMESPACE=database)
from dmb_agent_contracts.entry import prepare_runtime
prepare_runtime()
from alembic import command
from alembic.config import Config
command.upgrade(Config('alembic.ini'),'head')
from value_priority_assessor.config import get_settings
settings=get_settings()
assert not settings.rag_vector and not settings.value_analogy and not settings.strategy_use_rag
import httpx,urllib.request,uvicorn
original=httpx.HTTPTransport.handle_request
def restricted(self,request):
    assert request.url.host=='127.0.0.1','unexpected_external_http'
    return original(self,request)
httpx.HTTPTransport.handle_request=restricted
urllib.request.OpenerDirector.open=lambda *args,**kwargs:(_ for _ in ()).throw(AssertionError('external_http_forbidden'))
from value_priority_assessor.api.main import app
from value_priority_assessor.api.contract import TaskAttributes
from dmb_agent_contracts.run_store import fingerprint
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
        prefix='/internal/agent/v1/runs'
        task=TaskAttributes(task_id='SYN-ONLY-1',task_type='Synthetic',team='Synthetic',title='Synthetic priority')
        data=task.model_dump(mode='json')
        body={'contract_version':'1.0','operation':'priority.estimate','conversation_ref':None,
          'source':{'kind':'work_item','ref':task.task_id,'revision':1,'snapshot_hash':'sha256:'+fingerprint(data)},
          'input':data}
        headers={'X-Prioritiser-Secret':'synthetic-container-service-secret','X-Agent-Caller':'dmb',
          'X-Actor-Ref':'123','Idempotency-Key':'stable-container-priority'}
        assert client.post(prefix,json=body).status_code==401
        first=client.post(prefix,json=body,headers=headers)
        assert first.status_code==202,first.text
        rid=first.json()['run_id']
        assert client.post(prefix,json=body,headers=headers).json()['run_id']==rid
        for _ in range(100):
            status=client.get(prefix+'/'+rid,headers=headers)
            if status.json()['status'] in ('completed','failed','cancelled'):break
            time.sleep(.1)
        assert status.json()['status']=='completed',status.text
        result=client.get(prefix+'/'+rid+'/result',headers=headers)
        assert result.status_code==200,result.text
        payload=result.json()['result']['payload']
        assert payload['status']=='insufficient_data' and payload['request_type']=='priority'
        assert payload['missing_attributes']
        assert client.get(prefix+'/'+rid+'/result',headers=headers).json()==result.json()
        foreign=client.get(prefix+'/'+rid+'/result',headers={**headers,'X-Actor-Ref':'124'})
        assert foreign.status_code==404
        from sqlalchemy import text
        from value_priority_assessor.core.db import get_engine
        with get_engine().connect() as connection:
            assert connection.scalar(text('SELECT count(*) FROM reference'))==0
            assert connection.scalar(text('SELECT count(*) FROM task'))==0
            assert connection.scalar(text('SELECT count(*) FROM llm_call'))==0
            assert connection.scalar(text('SELECT count(*) FROM agent_runs'))==1
        report={'status':'PASS','scope':'assessor_container_real_http_pg_worker_insufficient_priority',
          'test_profile':'light_deterministic_no_rag_no_analogy','heavy_profile':'NOT_TESTED_IN_CONTAINER',
          'checks':['real_lifespan_readiness','service_auth','durable_acceptance','stable_run_id',
          'missing_data_not_invented','stable_result_hash','foreign_actor_404','no_protected_rows'],
          'source_mounts':0,'runtime_package_installs':0,'live_model_calls':0,
          'protected_writes':0,'real_remote':'NOT_RUN','production_compose':'NOT_TESTED'}
finally:
    server.should_exit=True
    thread.join(15)
assert not thread.is_alive(),'lifespan_shutdown_incomplete'
print(json.dumps(report),flush=True)
'''


if __name__=='__main__':
    helper=runpy.run_path(str(Path(__file__).with_name('qualify-v1-container.py')))
    helper['main'](harness=HARNESS,prefix='assessor_container_',label='assessor')
