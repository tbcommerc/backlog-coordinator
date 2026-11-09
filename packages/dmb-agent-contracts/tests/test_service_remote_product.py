"""Actual product parsing/scoring over independent reference HTTP fixtures.

Each subprocess imports one product source root. External IO is blocked; no
DMB/protected tables or real provider calls are involved.
"""
import json
import os
from pathlib import Path
import subprocess

import pytest
from test_service_settings import service_python


CHILD = r'''
import importlib,json,sys,runpy
from pathlib import Path
from datetime import datetime,timedelta,timezone
from uuid import uuid4
import httpx
from sqlalchemy import create_engine
from dmb_agent_contracts.operation import operation_scope
from dmb_agent_contracts.runtime_records import RuntimeRecords,migrate
from dmb_agent_contracts.remote_configuration import RemoteProfile
from dmb_agent_contracts.remote import RemoteOpenCode

service,root,temporary=sys.argv[1:]
root,temporary=Path(root),Path(temporary)
reference=runpy.run_path(str(root/'packages/dmb-agent-contracts/tests/http_reference.py'))
config=temporary/'remote.json'
config.write_text(json.dumps(reference['CONFIG']),encoding='utf-8')
sync_transport=httpx.HTTPTransport.handle_request
def restricted(transport,request):
    if request.url.host!='127.0.0.1':
        raise RuntimeError('unexpected_external_io')
    return sync_transport(transport,request)
httpx.HTTPTransport.handle_request=restricted
async def no_external_async(*args,**kwargs):
    raise RuntimeError('unexpected_external_io')
httpx.AsyncHTTPTransport.handle_async_request=no_external_async
import urllib.request
urllib.request.OpenerDirector.open=lambda *args,**kwargs: (_ for _ in ()).throw(RuntimeError('unexpected_external_io'))

if service.startswith('business-analyst'):
    package=service.replace('-','_')
    settings=importlib.import_module(package+'.config').settings
    values={'EXECUTION_BACKEND':'opencode','RUNTIME_LOCATION':'remote','REMOTE_ENABLED':True,
        'REMOTE_BASE_URL':'https://reference.invalid','REMOTE_CONFIG_FILE':str(config),
        'REMOTE_PROVIDER_ID':'controlled','REMOTE_MODEL_ID':'synthetic','REMOTE_AGENT':'bounded',
        'LLM_PROVIDER':'openai_compat','OPENAI_API_KEY':'synthetic-not-sent','OPENAI_MODEL':'synthetic'}
else:
    from value_priority_assessor.config import get_settings
    settings=get_settings()
    values={'execution_backend':'opencode','runtime_location':'remote','remote_enabled':True,
        'remote_base_url':'https://reference.invalid','remote_config_file':str(config),
        'remote_provider_id':'controlled','remote_model_id':'synthetic','remote_agent':'bounded'}
for name,value in values.items():
    setattr(settings,name,value)

if service=='business-analyst':
    candidate={'facts':[{'field':'need_statement','value':'Добавить в карточку сделки клиента и ИНН',
        'confidence':0.95,'evidence':'Добавить в карточку сделки клиента и ИНН'}],
        'next_action':'ask','focus':'role','reply':'Кто будет выполнять экспорт?'}
elif service=='business-analyst-experimental':
    candidate={'coverage':[],'questions':[],'unsupported':[],'findings':[],
        'summary':'Проверка синтетического документа завершена.'}
else:
    candidate={'answers':{'synthetic':'direct'},'rationale':'Явное выполнение synthetic критерия.'}

engine=create_engine('sqlite:///'+(temporary/'private-runtime.sqlite').as_posix())
migrate(engine)
with reference['emulator'](disconnect=True,candidate=candidate) as (url,state), httpx.Client(
        base_url=url,timeout=2,trust_env=False) as client:
    RemoteProfile.runtime=lambda self:RemoteOpenCode(base_url=self.base_url,expected_config=self.config,
        model=self.model,agent=self.agent,client=client,enabled=True)
    with operation_scope(run_id=uuid4(),deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20),
            acquire_gate=False) as context:
        context.runtime_checkpoint=RuntimeRecords(engine,context.check).checkpoint
        if service=='business-analyst':
            from business_analyst import audit
            audit.LOG_DIR=temporary/'audit'
            from business_analyst.session import SessionStore
            from business_analyst.agentic_orchestrator import AgenticOrchestrator
            store=SessionStore(database_url='sqlite:///'+(temporary/'dialogue.sqlite').as_posix())
            orchestrator=AgenticOrchestrator(store)
            sid=orchestrator.new_session(123).session_id
            response=orchestrator.handle_message(sid,'Добавить в карточку сделки клиента и ИНН')
            assert response.action=='question',response.action
            assert store.get(sid).get('need_statement')=='Добавить в карточку сделки клиента и ИНН',store.get(sid).get('need_statement')
            store.engine.dispose()
        elif service=='business-analyst-experimental':
            from business_analyst_experimental.dialogue.state import DialogueState
            from business_analyst_experimental.v2 import document_workspace as workspace
            state_document=DialogueState(session_id=uuid4().hex,user_id=123)
            state_document.operator_role='BA'
            state_document.product_mode='requirement_copilot'
            state_document.artifact_type='business_requirement_v2'
            workspace.save_sections(state_document,{'title':'Синтетическое БТ','problem_statement':'Нужен экспорт CSV.'})
            before=state_document.draft['fingerprint']
            review=workspace.review_document(state_document)
            assert review['status']=='completed',review.get('failure_code')
            assert state_document.draft['fingerprint']==before
            assert state_document.review_status!='approved'
        else:
            from value_priority_assessor.strategy.analysts import AgentStrategyAnalyst
            from value_priority_assessor.llm.openai_compat import OpenAICompatAdapter
            rubric={'strategy_fit':{'rubric_version':1,'criteria':[{'id':'synthetic','weight':1,
                'options':{'direct':{'value':1},'none':{'value':0}}}], 'scale':{'raw_min':1,'raw_max':10}}}
            adapter=OpenAICompatAdapter(api_key='synthetic-not-sent',base_url='https://opencode.ai/zen/go/v1',model='synthetic')
            assessment=AgentStrategyAnalyst(adapter,use_rag=False,session_factory=None).assess(
                'Инициатива явно выполняет synthetic критерий стратегии.',None,rubric)
            assert assessment.raw_score==10 and assessment.answers=={'synthetic':'direct'}
        assert not context._cleanup_pending
    assert state['dispatch_count'] in (1,2)
engine.dispose()
print('PASS')
'''


@pytest.mark.parametrize('service', ['business-analyst','business-analyst-experimental','value-priority-assessor'])
def test_service_remote_profile_preserves_product_workflow(tmp_path,service):
    root=Path(__file__).resolve().parents[3]
    env={key:value for key,value in os.environ.items()
         if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
    own='sqlite:///'+(tmp_path/'module-store.sqlite').as_posix()
    env.update(PYTHONPATH=os.pathsep.join([str(root/'packages/dmb-agent-contracts'),str(root/'agents'/service)]),
        PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1', AGENT_DATABASE_URL=own,
        AGENT_V2_DATABASE_URL=own,PRIORITISER_DATABASE_URL=own)
    result=subprocess.run([service_python(root,service),'-X','utf8','-c',CHILD,service,str(root),str(tmp_path)],
        cwd=root/'agents'/service,env=env,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=60)
    assert result.returncode==0, 'Isolated product reference test failed: '+result.stderr[-1800:]
    assert result.stdout.strip()=='PASS'
