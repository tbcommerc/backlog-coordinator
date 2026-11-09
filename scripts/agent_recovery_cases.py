"""Isolated synthetic history writer/read-only application reader for rollback QA."""
CHILD=r'''
import asyncio,hashlib,importlib,importlib.util,json,os,sys
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
from sqlalchemy import create_engine,inspect,MetaData,Table,select
from fastapi.testclient import TestClient

config=json.load(sys.stdin)
service=config['service'];package=service.replace('-','_')
database=config['database_url'];record_path=Path(config['record'])
secret='synthetic-recovery-service-'+'x'*32
admin_secret='synthetic-recovery-admin-'+'x'*32
env={'AGENT_DATABASE_URL':database,'AGENT_SESSION_DATABASE_URL':database,'SESSION_DATABASE_URL':database,
 'AGENT_V2_DATABASE_URL':database,'AGENT_V2_SESSION_DATABASE_URL':database,
 'MEETING_ANALYZER_DATABASE_URL':database,'PRIORITISER_DATABASE_URL':database,'PRIORITISER_DB_URL':database,
 'ASSISTANT_DATABASE_URL':database,'BACKLOG_ASSISTANT_DATABASE_URL':database,
 'AGENT_SECRET':secret,'AGENT_SERVICE_SECRET':secret,'AGENT_V2_SECRET':secret,'AGENT_V2_SERVICE_SECRET':secret,
 'PRIORITISER_SERVICE_SECRET':secret,'PRIORITISER_METHODOLOGIST_SECRET':admin_secret,
 'MEETING_ANALYZER_SERVICE_SECRET':secret,'AGENT_UNIT_TEST_MODE':'true','AGENT_V2_UNIT_TEST_MODE':'true',
 'PRIORITISER_UNIT_TEST_MODE':'true','PRIORITISER_RAG_VECTOR':'false','PRIORITISER_VALUE_ANALOGY':'false',
 'PRIORITISER_STRATEGY_USE_RAG':'false','RUN_STARTUP_SEED':'false'}
os.environ.update(env)
module=importlib.import_module(package+'.config') if service!='backlog-assistant' else None
settings=module.settings if hasattr(module,'settings') else module.get_settings() if hasattr(module,'get_settings') else None
if settings is not None:
    for name in ('UNIT_TEST_MODE','unit_test_mode'):
        if hasattr(settings,name):setattr(settings,name,True)
    for name in ('AGENT_SECRET','service_secret'):
        if hasattr(settings,name):setattr(settings,name,secret)
    if hasattr(settings,'methodologist_secret'):settings.methodologist_secret=admin_secret

def fingerprint(engine,exclude=()):
    result={}
    with engine.connect() as connection:
        for name in sorted(set(inspect(connection).get_table_names())-set(exclude)):
            table=Table(name,MetaData(),autoload_with=connection)
            rows=connection.execute(select(table)).mappings().all()
            encoded=sorted(json.dumps(dict(row),sort_keys=True,ensure_ascii=False,default=str) for row in rows)
            result[name]={'rows':len(rows),'sha256':hashlib.sha256(json.dumps(encoded).encode()).hexdigest()}
    return result

if config['action']=='write':
    record=json.loads(record_path.read_text(encoding='utf-8')) if config.get('generation')=='new' else {'service':service,'refs':[]}
    def generations(values):
        return values[:1] if config.get('generation')=='old' else values[1:] if config.get('generation')=='new' else values
    if service.startswith('business-analyst'):
        persistence=importlib.import_module(package+'.session')
        store=persistence.session_store
        if hasattr(store,'migrate_schema'):store.migrate_schema(backup_verified=bool(config.get('backup_verified')))
        for archived,label in generations(((True,'Synthetic old history'),(False,'Synthetic new history'))):
            state=store.new_session(17)
            state.add_message('user',label,'synthetic-'+str(archived))
            state.add_message('assistant',label+' preserved reply')
            state.archived=archived
            if service.endswith('experimental'):
                state.operator_role='BA';state.product_mode='requirement_copilot';state.artifact_type='business_requirement_v2'
                workspace=importlib.import_module(package+'.v2.document_workspace')
                workspace.save_sections(state,{'title':label+' v1','problem_statement':label})
                workspace.save_sections(state,{'title':label+' v2'})
            store.save(state)
            store.cache_response(state.session_id,'synthetic-client',{'message':label+' cached reply'})
            record['refs'].append({'id':state.session_id,'label':label,'archived':archived,
                'draft_hash':state.draft.get('fingerprint') if state.draft else None})
        store.engine.dispose()
    elif service=='meeting-analyzer':
        from meeting_analyzer.migrate import migrate
        from meeting_analyzer.store import Store,now,fingerprint as payload_hash
        engine=create_engine(database);migrate(engine);store=Store(engine)
        for label in generations(('Synthetic old result','Synthetic new result')):
            body={'input':{'transcript':label},'source':{'kind':'meeting_capture','ref':label,'revision':1}}
            row,_=store.create('dmb','17',uuid4().hex,body,{'model':'synthetic-history'},300,100)
            for stage in ('preparing','running','validating'):row=store.transition(row,stage)
            payload={'items':[{'id':str(uuid4()),'kind':'action','title':label,'quote':label,
                'origin':'ai','selected':False,'owner_text':'','due_text':''}]}
            row=store.transition(row,'completed',result=payload,payload_hash=payload_hash(payload),finished_at=now())
            record['refs'].append({'id':row['id'],'payload_hash':row['payload_hash'],'items':payload['items']})
        engine.dispose()
    elif service=='value-priority-assessor':
        from value_priority_assessor.core.db import get_engine
        from value_priority_assessor.core.models import Base,Task,PriorityHistory
        from sqlalchemy.orm import Session
        import value_priority_assessor.api.main  # Register models without startup or seed.
        engine=get_engine();Base.metadata.create_all(engine)
        with Session(engine) as session:
            task=session.query(Task).filter_by(task_key='SYN-RECOVERY').one_or_none()
            if task is None:
                task=Task(task_key='SYN-RECOVERY',title='Synthetic recovery',value_manual_mln=12.5,value_internal_mln=12.5)
                session.add(task);session.flush()
            for index,score in generations(tuple(enumerate((.2,.8)))):
                row=PriorityHistory(task_id=task.id,old_priority=None if index==0 else 'P4',new_priority='P4' if index==0 else 'P2',
                    old_score=None if index==0 else .2,new_score=score,reason='manual_override',
                    actor='synthetic-operator',detail={'label':'old' if index==0 else 'new'})
                session.add(row)
            session.commit()
            record['refs']=[{'task_key':task.task_key,'scores':[.2,.8]}]
        assert fingerprint(engine)['reference']['rows']==0
        engine.dispose()
    else:
        from backlog_assistant.migrate import migrate
        from backlog_assistant.store import Store
        from backlog_assistant.security import Identity
        from backlog_assistant.worker import Worker
        from fixtures.data import FakeData
        from runtime.fake import FakeRuntime
        from contracts.models import Context
        engine=create_engine(database)
        if database.startswith('sqlite:'):
            from backlog_assistant.store import metadata
            metadata.create_all(engine)  # Explicit synthetic unit fixture only.
        else:
            if config.get('backup_verified'):
                migrate(database,backup_verified=True)
            else:
                migrate(database)
        store=Store(engine);data=FakeData();runtime=FakeRuntime()
        data.receipts.update(record.get('receipts',{}))
        owner=Identity('dmb','one').owner
        for label in generations(('Synthetic old conversation','Synthetic new conversation')):
            session=store.create(owner,uuid4().hex,{'context':Context().model_dump(mode='json')})
            body={'text':label,'context_revision':1,'context':Context().model_dump(mode='json'),'execution_ref':data.register(owner)}
            row=store.enqueue(owner,session['id'],uuid4().hex,body)
            worker=Worker(store,data,runtime)
            asyncio.run(worker.execute(store.claim(worker.id)))
            assert store.get_run(owner,row['id'])['status']=='completed'
            record['refs'].append({'id':row['id'],'session_id':session['id']})
        assert not runtime.instances
        record['receipts']=data.receipts  # Synthetic server evidence only; no grants/tokens.
        engine.dispose()
    record_path.write_text(json.dumps(record,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'status':'PASS','scope':'synthetic_history_preparation','service':service,'histories':2,'model_calls':0}))
    raise SystemExit()

# A separate process now opens committed history through the recovery adapter.
from dmb_agent_contracts.recovery import guard_engine
from sqlalchemy.engine import Engine
nonce_tables=('backlog_assistant_nonces',) if service=='backlog-assistant' else ()
guard_engine(Engine,auth_nonce_tables=nonce_tables)
record=json.loads(record_path.read_text(encoding='utf-8'))
engine=create_engine(database)
before=fingerprint(engine,nonce_tables)
model_calls=[]
class Trap:
    name='forbidden-recovery-model';model='synthetic'
    def available(self):return True
    def chat(self,*args,**kwargs):model_calls.append(1);raise AssertionError('Recovery attempted inference')
    chat_json=chat
    complete=chat
if service.startswith('business-analyst'):
    factory=importlib.import_module(package+'.llm.factory');factory.get_llm=lambda:Trap()
elif service=='value-priority-assessor':
    factory=importlib.import_module(package+'.llm.factory');factory.get_adapter=lambda:Trap()

if service=='meeting-analyzer':
    from dmb_agent_contracts.recovery import load_without_singleton
    adapter=load_without_singleton(package+'.recovery','app',
        lambda module:module.create_recovery_app(engine=engine),source_path=config['adapter'])
else:
    spec=importlib.util.spec_from_file_location(package+'.recovery',config['adapter'])
    adapter=importlib.util.module_from_spec(spec);sys.modules[spec.name]=adapter;spec.loader.exec_module(adapter)
data=None
if service=='backlog-assistant':
    from backlog_assistant.store import Store
    from fixtures.data import FakeData
    from backlog_assistant.security import sign,Identity
    data=FakeData();data.receipts=record['receipts']
    app=adapter.create_recovery_app(Store(engine),data,secret)
else:app=adapter.app
with TestClient(app) as client:
    assert client.get('/health/ready').status_code==200, client.get('/health/ready').text
    assert client.get('/health/ready').json()['mode']=='recovery_read_only'
    headers={'X-Agent-Secret':secret,'X-Agent-Caller':'dmb','X-Actor-Ref':'17'}
    if service.startswith('business-analyst'):
        prefix='/api/agent-v2' if service.endswith('experimental') else '/api/agent'
        assert client.get(prefix+'/sessions?user_id=17',headers=headers).status_code==200
        for ref in record['refs']:
            response=client.get(prefix+'/session/'+ref['id']+'?user_id=17',headers=headers)
            assert response.status_code==200,response.text
            value=response.json()
            assert ref['label'] in json.dumps(value['history'],ensure_ascii=False)
            if ref['draft_hash']:assert value['draft']['fingerprint']==ref['draft_hash']
            assert client.get(prefix+'/session/'+ref['id']+'?user_id=18',headers={**headers,'X-Actor-Ref':'18'}).status_code==404
        assert client.post(prefix+'/chat',json={'session_id':record['refs'][-1]['id'],'message':'Must not dispatch'},headers=headers).status_code==503
    elif service=='meeting-analyzer':
        for ref in record['refs']:
            path='/internal/agent/v1/runs/'+ref['id']+'/result'
            response=client.get(path,headers=headers)
            assert response.status_code==200,response.text
            assert response.json()['payload_hash']==ref['payload_hash'] and response.json()['result']['items']==ref['items']
            assert client.get(path,headers={**headers,'X-Actor-Ref':'18'}).status_code==404
        assert client.post('/internal/agent/v1/runs',json={},headers=headers).status_code==503
    elif service=='value-priority-assessor':
        headers={'X-Prioritiser-Secret':secret,'X-Methodologist-Secret':admin_secret}
        path='/tasks/SYN-RECOVERY/history'
        assert client.get(path,headers={'X-Prioritiser-Secret':secret}).status_code==403
        response=client.get(path,headers=headers)
        assert response.status_code==200,response.text
        assert [row['new_score'] for row in response.json()]==[.2,.8]
        assert client.patch('/tasks/SYN-RECOVERY',json={'title':'Must not change'},headers=headers).status_code==503
    else:
        def read(path,subject='one'):
            token=sign(secret,subject,'GET',path,b'','')
            return client.get(path,headers={'X-Gateway-Attestation':token,'X-Read-Proof':'synthetic-current-read'})
        for ref in record['refs']:
            path='/v1/runs/'+ref['id'];response=read(path)
            assert response.status_code==200 and response.json()['answer']['verified_blocks'][0]['total']==1,response.text
            foreign=read('/v1/sessions/'+ref['session_id'],subject='two')
            assert foreign.status_code==404,foreign.text
        data.revoked_owners.add(Identity('dmb','one').owner)
        assert read('/v1/runs/'+record['refs'][-1]['id']).json()['answer'] is None
        assert client.post('/v1/sessions',json={}).status_code==503
after=fingerprint(engine,nonce_tables)
assert before==after,'Recovery changed persisted business history'
assert not model_calls,'Recovery attempted a model call'
engine.dispose()
print(json.dumps({'status':'PASS','service':service,'histories_read':2,'business_fingerprint_unchanged':True,
    'model_calls':0,'read_authorization_preserved':True,'mutations_blocked':True,
    'nonce_bookkeeping_allowed':bool(nonce_tables),'scope':'read_only_application_recovery'}))
'''
