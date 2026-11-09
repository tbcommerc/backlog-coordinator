"""Frozen dialogue fixtures through actual strict parsing, guards and persistence.

These fixed model decisions prove product invariants, not live model quality.
The conservative uncertainty metadata policy is reported explicitly.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
import httpx
import urllib.request
from business_analyst import audit
from business_analyst.agentic_orchestrator import AgenticOrchestrator
from business_analyst.dialogue import agentic
from business_analyst.kb.retrieval import retrieval
from business_analyst.composer import composer
from business_analyst.session import SessionStore

ROOT=Path(__file__).resolve().parents[4]/'docs/dev-testing/agent-services/corpus/v1'
MANIFEST=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
INFO=MANIFEST['offline_fixtures']['business-analyst']
RAW=(ROOT/INFO['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==INFO['sha256']
FIXTURES=json.loads(RAW)['cases']
ORIGINAL=MANIFEST['services']['business-analyst']
SOURCE=(ROOT/ORIGINAL['file']).read_bytes()
assert hashlib.sha256(SOURCE).hexdigest()==ORIGINAL['sha256']
CASES={case['case_id']:case for case in json.loads(SOURCE)['cases']}


@pytest.mark.parametrize('fixture',FIXTURES,ids=lambda item:item['case_id'])
def test_fixed_dialogue_corpus_uses_original_guards(tmp_path,monkeypatch,fixture):
    case=CASES[fixture['case_id']]
    assert hashlib.sha256(case['input']['text'].encode()).hexdigest()==fixture['input_sha256']
    number=int(case['case_id'].rsplit('-',1)[1])
    replies=[turn['response'] for turn in fixture['turns'] if turn['response'] is not None]
    class Provider:
        name='fixed-dialogue-fixture'
        model='not-a-live-model'
        calls=0
        def available(self):return True
        def chat_json(self,messages,**options):
            assert 'Не выдумывай факты' in options['system_prompt']
            if self.calls>=len(replies):raise AssertionError('Unexpected additional model/repair request')
            response=deepcopy(replies[self.calls])
            self.calls+=1
            return json.dumps(response,ensure_ascii=False)
        chat=chat_json
    provider=Provider()
    monkeypatch.setattr(agentic,'get_llm',lambda:provider)
    monkeypatch.setattr(audit,'LOG_DIR',tmp_path/'audit')
    monkeypatch.setattr(retrieval,'answer_from_kb',lambda *args,**options:[])
    monkeypatch.setattr(composer,'check_duplicates',lambda *args,**options:[])
    def forbidden(*args,**options):raise AssertionError('Offline corpus attempted external HTTP')
    monkeypatch.setattr(urllib.request,'urlopen',forbidden)
    monkeypatch.setattr(httpx.Client,'send',forbidden)
    async def forbidden_async(*args,**options):raise AssertionError('Offline corpus attempted external HTTP')
    monkeypatch.setattr(httpx.AsyncClient,'send',forbidden_async)
    store=SessionStore(str(tmp_path/'own-dialogue.sqlite'))
    orchestrator=AgenticOrchestrator(store)
    identity=orchestrator.new_session(17).session_id
    if number==12:
        state=store.get(identity)
        state.question_count=100  # Explicit bounded-interview fixture, no added facts.
        store.save(state)
    try:
        if number==9:
            # Delivery idempotency belongs to the public route/receipt layer,
            # not the internal planner's handle_message method.
            from business_analyst.api import router as api
            from business_analyst.api.schemas import ChatRequest
            monkeypatch.setattr(api,'_orchestrator',orchestrator)
            monkeypatch.setattr(api.settings,'UNIT_TEST_MODE',True)
            request=ChatRequest(session_id=identity,message=fixture['turns'][0]['message'],
                message_id=case['case_id']+'-0',context={'user_id':17,'is_ba':True})
            response=api.chat(request,None)
            history=deepcopy(store.get(identity).history)
            again=api.chat(request,None)
            first_message=response['message'] if isinstance(response,dict) else response.message
            second_message=again['message'] if isinstance(again,dict) else again.message
            assert second_message==first_message and provider.calls==1
            assert store.get(identity).history==history
            assert sum(item['role']=='user' for item in history)==1
            return
        response=None
        for index,turn in enumerate(fixture['turns']):
            response=orchestrator.handle_message(identity,turn['message'],message_id=case['case_id']+'-'+str(index))
        state=store.get(identity)
        active={key:slot.value for key,slot in state.slots.items() if slot.handled}
        rendered=json.dumps(active,ensure_ascii=False)
        assert provider.calls==len(replies)
        if number==1:
            assert state.get('role')=='оператор'
            assert 'вручную' in state.get('as_is') and '2 часа' in state.get('as_is')
            assert 'CSV' in rendered and 'пятниц' in rendered
        elif number==2:
            assert response.action=='question' and all(word in response.message.lower() for word in ('формат','получ','частот'))
            assert 'CSV' not in rendered and 'PDF' not in rendered
        elif number==3:
            assert 'пятниц' in state.get('business_rules') and 'ежеднев' not in state.get('business_rules')
            assert any('ежеднев' in str(item.get('old_value','')) for item in state.get_slot_history('business_rules'))
            reopened=SessionStore(database_url=store.database_url,initialize=False)
            try:
                restored=reopened.get(identity)
                assert restored.get('business_rules')==state.get('business_rules')
                assert 'ежеднев' not in restored.get('business_rules')
                assert restored.get_slot('business_rules').provenance==state.get_slot('business_rules').provenance
                assert restored.get_slot_history('business_rules')==state.get_slot_history('business_rules')
                assert restored.history==state.history
            finally:
                reopened.engine.dispose()
        elif number==4:
            assert 'поиск заявки по номеру' in state.get('need_statement')
            assert all(word not in rendered.lower() for word in ('ключ модели','администратор','system'))
        elif number==5:
            assert 'ручной просмотр' in state.get('need_statement')
            assert 'не нужны' in state.get('business_rules')
        elif number==6:
            symptom=next(item for item in state.requirement_assumptions if item['field']=='as_is')
            assert symptom['text']=='Экран иногда тормозит.' and symptom['evidence']=='Экран иногда тормозит.'
            assert symptom['message_id']==case['case_id']+'-0'
            assert not state.get('risks')  # An unverified network cause is not promoted.
            assert any('сети' in item['text'] for item in state.requirement_assumptions)
        elif number==7:
            assert 'поиск по номеру' in state.get('need_statement')
            assert 'будущей задачей' in state.get('business_rules')
            assert 'История' not in state.get('to_be')
        elif number==8:
            conflicts=[item for item in state.requirement_conflicts if item['status']=='open']
            assert conflicts and '7' in json.dumps(conflicts) and '30' in json.dumps(conflicts)
            assert not state.get('business_rules')
        elif number==10:
            assert response.action=='question' and provider.calls==0
            assert not any(item['role']=='user' for item in state.history)
            assert not active
        elif number==11:
            assert state.get('business_rules')=='CSV' and not state.get_slot('business_rules').assumption
            assert 'PDF' not in rendered
            assert any(item['text']=='PDF' and item['status']=='open' for item in state.requirement_assumptions)
        else:
            assert response.action=='summarize'
            assert all(value in response.message for value in ('точному номеру','3 секунд','права доступа'))
            assert not state.confirmed and not state.review_status
    finally:
        store.engine.dispose()
