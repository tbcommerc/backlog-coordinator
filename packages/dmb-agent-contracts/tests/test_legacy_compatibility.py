"""Legacy HTTP reconnects reuse a real durable product run, without model IO."""
import os
from pathlib import Path
import subprocess

import pytest
from test_service_settings import service_python


CHILD = r'''
import importlib, sys
from pathlib import Path
from dmb_agent_contracts.run_migration import migrate
from dmb_agent_contracts.run_worker import execute
from dmb_agent_contracts.model import AgentError
from fastapi import HTTPException

service = sys.argv[1]
package = service.replace('-', '_')
api = importlib.import_module(package+'.api.router')
runs = importlib.import_module(package+'.runs')
compat = importlib.import_module(package+'.compatibility')
schemas = importlib.import_module(package+'.api.schemas')
session = importlib.import_module(package+'.session').session_store
response_type = importlib.import_module(package+'.orchestrator').AgentResponse
api.settings.UNIT_TEST_MODE = False
if service.endswith('experimental'):
    api.settings.ENABLED = True
    api.settings.KILL_SWITCH = False
session.migrate_schema()
migrate(session.engine, backup_verified=True, allowed_existing=('sessions','message_receipts'))
state = session.new_session(123)
calls = []
def answer(sid, text, context, message_id):
    calls.append(message_id)
    assert message_id != 'stable-client-key'
    return response_type(session_id=sid, action='question', message='Synthetic response')
api._orchestrator.handle_message = answer
original_wait = compat.wait_result
def pump(store, row, **options):
    claimed = store.claim()
    if claimed is not None:
        execute(store, claimed, runs.handle, transaction_scope=session.transaction)
    return original_wait(store, row, **options)
compat.wait_result = pump
request = schemas.ChatRequest(session_id=state.session_id, message_id='stable-client-key',
    message='Synthetic message', context={'user_id':123,'is_ba':True,'operator_role':'BA'})
first = api.chat(request, None)
assert first['message'] == 'Synthetic response', first
# A committed later change may not turn a reconnect into a second operation.
state = session.get(state.session_id)
session.save(state)
second = api.chat(request, None)
assert second == first and len(calls) == 1
try:
    api.chat(request.model_copy(update={'message':'Different input'}), None)
except AgentError as error:
    assert error.code == 'idempotency_conflict'
else:
    raise AssertionError('Changed input reused a key')
try:
    api.chat(request.model_copy(update={'context':{'user_id':124}}), None)
except HTTPException as error:
    assert error.status_code == 404
else:
    raise AssertionError('Foreign dialogue accepted')
assert len(calls) == 1
from sqlalchemy import update
from dmb_agent_contracts.run_store import runs as technical_runs
with runs.store.engine.begin() as connection:
    connection.execute(update(technical_runs).values(result_expired=1,input=None,result=None,profile={}))
try:
    api.chat(request,None)
except AgentError as error:
    assert error.code == 'result_expired' and error.status == 410
else:
    raise AssertionError('Expired legacy receipt was not retained as 410')
assert len(calls) == 1
missing = api.chat(request.model_copy(update={'message_id':''}), None)
assert missing['message'] == 'Synthetic response' and len(calls) == 2
assert calls[0] != calls[1]
# Preserve a receipt produced by the previous application before cutover.
legacy = request.model_copy(update={'message_id':'pre-cutover'})
session.cache_response(state.session_id, 'pre-cutover', {'message':'Saved legacy result'})
assert api.chat(legacy,None) == {'message':'Saved legacy result'} and len(calls) == 2
if service.endswith('experimental'):
    documents = []
    def document(sid, user_id, content):
        documents.append(content['action'])
        return response_type(session_id=sid,action='document_proposed',message='Synthetic proposal')
    api._orchestrator.document_action = document
    doc = schemas.DocumentActionRequest(session_id=state.session_id,user_id=123,
        idempotency_key='stable-document-key',action='propose_change',instruction='Synthetic change')
    result = api.document_action(doc,None)
    assert result['message'] == 'Synthetic proposal' and documents == ['propose_change']
    assert api.document_action(doc,None) == result and len(documents) == 1
    try:
        api.document_action(doc.model_copy(update={'action':'create_draft'}),None)
    except AgentError as error:
        assert error.code == 'idempotency_conflict'
    else:
        raise AssertionError('Changed input reused a key within document.generate')
    # The same key in document.review belongs to a distinct operation.
    review = api.document_action(doc.model_copy(update={'action':'review'}),None)
    assert review['message'] == 'Synthetic proposal' and documents == ['propose_change','review']
    assert api.document_action(doc.model_copy(update={'action':'review'}),None) == review
    assert len(documents) == 2
session.engine.dispose()
print('PASS')
'''


@pytest.mark.parametrize('service', ['business-analyst', 'business-analyst-experimental'])
def test_legacy_chat_reconnect_reads_original_run(tmp_path, service):
    root = Path(__file__).resolve().parents[3]
    env = {key:value for key,value in os.environ.items()
           if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
    database = 'sqlite:///'+(tmp_path/'technical.sqlite').as_posix()
    env.update(PYTHONPATH=os.pathsep.join([str(root/'packages/dmb-agent-contracts'), str(root/'agents'/service)]),
               PYTHONUTF8='1', AGENT_DATABASE_URL=database, AGENT_V2_DATABASE_URL=database)
    result = subprocess.run([service_python(root,service), '-X','utf8','-c',CHILD,service],
        cwd=tmp_path,env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
    assert result.returncode == 0, result.stderr[-2400:]
    assert result.stdout.strip() == 'PASS'
