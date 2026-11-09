"""Frozen corpus against product Worker/Store and broker/runtime boundaries.

Synthetic runtime responses are authored fixtures, never model-quality evidence.
No Docker or provider requests and no protected DMB records are used here.
"""
import hashlib
import json
from pathlib import Path
from uuid import uuid4
from datetime import datetime,timezone

import httpx
import pytest
from contracts.models import Answer,Context,Coverage,DataBlock
from backlog_assistant.worker import Worker
from runtime.opencode import OpenCodeRuntime
from bridge.model import ModelBroker
from tests.test_service import setup,send,SECRET
from backlog_assistant.security import Identity
from tests.test_boundaries import bridge
from backlog_assistant.app import create_app
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[3]/'docs/dev-testing/agent-services/corpus/v1'
INFO=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['services']['backlog-assistant']
RAW=(ROOT/INFO['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==INFO['sha256']
CASES=json.loads(RAW)['cases']


@pytest.mark.asyncio
@pytest.mark.parametrize('case',CASES,ids=lambda item:item['case_id'])
async def test_frozen_backlog_product_corpus(setup,monkeypatch,case):
    number=int(case['case_id'].rsplit('-',1)[1])
    store,data,runtime=setup
    if number==9:
        b=await bridge()
        requests=[]
        def response(request):
            requests.append(request)
            return httpx.Response(200,json={'choices':[]})
        broker=ModelBroker(b,'https://synthetic.invalid/v1','synthetic','model',transport=httpx.MockTransport(response))
        try:
            with pytest.raises(ValueError,match='provider_usage_not_qualified'):
                await broker.completion({'model':'model','messages':[{'role':'user','content':case['input']['text']}]})
            assert len(requests)==1 and broker.requests==1 and broker.output_reserved==1500
        finally:
            await broker.client.aclose()
        return
    if number in (10,11):
        b=await bridge()
        adapter=OpenCodeRuntime(None,model='synthetic')
        handle={'instance':'synthetic','session':'ses_synthetic','message':'msg_synthetic'}
        requests=[]
        async def response(request):
            requests.append((request.method,request.url.path))
            if number==11:return httpx.Response(500)
            if request.url.path=='/permission':
                return httpx.Response(200,json=[{'id':'per_synthetic','sessionID':'ses_synthetic'}])
            assert request.method=='POST' and request.url.path=='/permission/per_synthetic/reply'
            assert json.loads(request.content)=={'reply':'reject'}
            return httpx.Response(200,json=True)
        client=httpx.AsyncClient(base_url='http://synthetic.invalid',transport=httpx.MockTransport(response))
        adapter.clients['synthetic']=client
        adapter.bridges['synthetic']=b
        try:
            if number==10:
                with pytest.raises(ValueError,match='unexpected_permission'):
                    await adapter.inspect(handle)
                assert requests==[('GET','/permission'),('POST','/permission/per_synthetic/reply')]
            else:
                destroyed=[]
                class Launcher:
                    async def destroy(self,identity):
                        destroyed.append(identity)
                adapter.launcher=Launcher()
                await adapter.dispose(handle)
                assert requests==[('DELETE','/session/ses_synthetic')]
                assert destroyed==['synthetic'] and not adapter.clients and not adapter.bridges
        finally:
            await client.aclose()
        return
    if number==12:
        first,second=await bridge('first'),await bridge('second')
        assert first._grant!=second._grant and first.execution!=second.execution
        one=await runtime.prepare({'execution_ref':first.execution},first,Answer.model_json_schema())
        two=await runtime.prepare({'execution_ref':second.execution},second,Answer.model_json_schema())
        try:
            assert one['instance']!=two['instance'] and one['session']!=two['session']
            with pytest.raises(ValueError):
                await first.data.check(first.execution,second._grant)
            assert runtime.instances[one['instance']]['bridge'] is first
            assert runtime.instances[two['instance']]['bridge'] is second
        finally:
            await runtime.dispose(one)
            await runtime.dispose(two)
        assert not runtime.instances
        return
    # Bind the original immutable scenario to the actual queued request. These
    # cases are operational scenarios; the fixed runtime does no interpretation.
    owner=Identity('dmb','one').owner
    context=Context().model_dump(mode='json')
    session=store.create(owner,case['case_id'],{'context':context})
    content={'text':case['input']['text'],'context':context,'context_revision':1,
        'execution_ref':data.register(owner)}
    row=store.enqueue(owner,session['id'],case['case_id'],content)
    if number==2:
        async def submit(handle,envelope,dispatch):
            state=runtime.instances[handle['instance']]
            state['answer']=Answer(kind='clarification',context=Context.model_validate(envelope['context']),
                as_of=datetime.now(timezone.utc),coverage=Coverage(),
                clarification={'question':'Уточните период, объект и фильтр.','options':[]})
            state['state']='completed'
            return 'accepted'
        monkeypatch.setattr(runtime,'submit',submit)
    if number==5:
        original=data.tool
        async def empty(*args,**kwargs):
            value=await original(*args,**kwargs)
            value=value.model_copy(update={'data':{'items':[],'total':0},'coverage':Coverage(matched_total=0,displayed_count=0)})
            data.receipts[value.snapshot_ref]['result']=value.model_dump(mode='json')
            return value
        monkeypatch.setattr(data,'tool',empty)
    if number in (6,8):
        original=runtime.collect
        async def collect(handle):
            value=await original(handle)
            if number==6:data.revoked_owners.add(row['owner'])
            else:value=value.model_copy(update={'data_blocks':[DataBlock(type='list',server_result_ref=str(uuid4()))]})
            return value
        monkeypatch.setattr(runtime,'collect',collect)
    if number==4:
        data.allowed_tools={'search_work_items'}
    worker=Worker(store,data,runtime)
    await worker.execute(store.claim(worker.id))
    saved=store.get_run(row['owner'],row['id'])
    assert not runtime.instances and data.executions[row['execution_ref']]['revoked']
    if number==6:
        assert saved['answer'] is None and saved['status']=='failed'
        return
    assert saved['status'] in ('completed','partial')
    answer=saved['answer']
    if number==2:
        assert answer['kind']=='clarification' and not answer['sources'] and not saved['receipts']
    else:
        assert all(block['server_result_ref'] in saved['receipts'] for block in answer['data_blocks'])
        assert answer['verified_blocks'][0]['total']==(0 if number==5 else 1)
    if number==3:
        duplicate=store.enqueue(row['owner'],row['session_id'],row['key'],row['input'])
        assert duplicate['id']==row['id'] and store.claim(worker.id) is None
    if number==5:assert answer['kind']=='no_results'
    if number==7:
        data.revoked_owners.add(row['owner'])
        client=TestClient(create_app(store,data,runtime,SECRET,run_workers=False))
        assert send(client,'GET','/v1/runs/'+row['id']).json()['answer'] is None
    if number==8:assert saved['status']=='partial' and not answer['summary_claims']
