"""Frozen semantic fixtures over the actual document workspace; no model-quality claim."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

import pytest
from business_analyst_experimental.session import SessionStore
from business_analyst_experimental.v2 import document_workspace as workspace
from business_analyst_experimental.v2.orchestrator import V2Orchestrator

ROOT=Path(__file__).resolve().parents[4]/'docs/dev-testing/agent-services/corpus/v1'
MANIFEST=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
INFO=MANIFEST['offline_fixtures']['business-analyst-experimental']
RAW=(ROOT/INFO['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==INFO['sha256']
FIXTURES=json.loads(RAW)['cases']
ORIGINAL=MANIFEST['services']['business-analyst-experimental']
ORIGINAL_RAW=(ROOT/ORIGINAL['file']).read_bytes()
assert hashlib.sha256(ORIGINAL_RAW).hexdigest()==ORIGINAL['sha256']
CASES={case['case_id']:case for case in json.loads(ORIGINAL_RAW)['cases']}


@pytest.mark.parametrize('fixture',FIXTURES,ids=lambda item:item['case_id'])
def test_fixed_document_model_responses_use_real_workflow(tmp_path,monkeypatch,fixture):
    case=CASES[fixture['case_id']]
    assert hashlib.sha256(case['input']['text'].encode()).hexdigest()==fixture['input_sha256']
    number=int(case['case_id'].rsplit('-',1)[1])
    store=SessionStore(database_url='sqlite:///'+(tmp_path/'own-documents.sqlite').as_posix())
    state=store.new_session(17)
    state.product_mode='requirement_copilot'
    state.operator_role='BA'
    state.artifact_type='business_requirement_v2'
    orchestrator=V2Orchestrator(store)
    approved=None
    if number==3:
        workspace.save_sections(state,{'title':'Synthetic CSV requirement','problem_statement':'Оператор экспортирует CSV по пятницам.'})
        state.review_status='approved'
        state.artifact_revision_history[-1]['review_status']='approved'
        approved=deepcopy(state.artifact_revision_history)
        store.save(state)
        orchestrator.document_action(state.session_id,17,{'action':'next_revision',
            'expected_draft_hash':state.draft['fingerprint'],'reason':'Явное решение заказчика'})
        state=store.get(state.session_id)
    sources=[workspace.add_source(state,source) for source in fixture['sources']]
    store.save(state)
    def bind(value):
        if isinstance(value,str):
            for index,source in enumerate(sources,1):
                value=value.replace('$SOURCE'+str(index),source['id']+'@1#L1')
            return value
        if isinstance(value,list):return [bind(item) for item in value]
        if isinstance(value,dict):return {key:bind(item) for key,item in value.items()}
        return value
    class Provider:
        name='synthetic-document-fixture'
        model='fixed-fixture-not-live-model'
        def available(self):return True
        def chat_json(self,messages,**options):
            assert 'недоверенные' in options['system_prompt']
            context=json.loads(messages[0]['content'])
            if 'candidate_document' in context:
                coverage=[]
                for fact in context['source_facts']:
                    index=next(i for i,source in enumerate(sources) if fact['source_ref'].startswith(source['id']+'@'))
                    coverage.append({'fact_id':fact['id'],'status':'covered','field':fixture['coverage_field'],
                        'quote':fixture['coverage_quotes'][index],'reason':'Фиксированный ответ проверяющего fixture'})
                return {'coverage':coverage,'questions':[{'index':index,'decision':'keep','priority':'behavior',
                    'reason':'Источник не даёт ответа'} for index,_ in enumerate(context['candidate_document'].get('open_questions',[]))],
                    'unsupported':[]}
            return bind(deepcopy(fixture['model_response']))
    monkeypatch.setattr(workspace,'get_llm',Provider)
    try:
        result=orchestrator.document_action(state.session_id,17,{'action':'propose_change' if number==3 else 'create_draft',
            'expected_draft_hash':(state.draft or {}).get('fingerprint',''),'instruction':case['input']['text']})
        assert result.action in {'draft_ready','document_proposed'},result.action
        if number==3:
            proposal=result.document_proposals[-1]
            result=orchestrator.document_action(state.session_id,17,{'action':'apply_proposal',
                'proposal_id':proposal['id'],'operation_ids':[item['id'] for item in proposal['operations']],
                'expected_draft_hash':result.draft['fingerprint']})
        current=store.get(state.session_id)
        draft=current.draft
        requirements=draft['business_requirements']
        rendered=json.dumps(draft,ensure_ascii=False)
        # Applying the selected proposal above is an explicit human edit and
        # confirms that local draft; it must not approve the new review edition.
        assert current.review_status!='approved'
        if number!=3:
            assert not current.final_summary_confirmed
        assert draft['status']=='Draft'
        if number==1:
            assert all(term in rendered for term in ('CSV','пятниц','3 секунд'))
            refs={ref for item in requirements for ref in item.get('source_refs',[])}
            assert all(any(ref.startswith(source['id']+'@') for ref in refs) for source in sources)
        elif number==2:
            assert any('объект' in question.lower() for question in draft['open_questions'])
            assert any('пользоват' in question.lower() for question in draft['open_questions'])
            assert not draft['data_integrations'] and not draft['user_roles']
        elif number==3:
            assert current.artifact_revision_history[:len(approved)]==approved
            assert 'PDF' in json.dumps(requirements,ensure_ascii=False) and 'CSV' in json.dumps(requirements,ensure_ascii=False)
        elif number==4:
            assert any('Поиск по номеру' in item['text'] for item in requirements)
            assert not any(word in item['text'].lower() for item in requirements for word in ('shell','секрет','удали'))
            assert all(item['source_refs'] for item in requirements)
        elif number==6:
            csv=[item for item in requirements if 'CSV' in item['text']]
            assert len(csv)==1 and 'UTF-8' in csv[0]['text']
            assert all(any(ref.startswith(source['id']+'@') for ref in csv[0]['source_refs']) for source in sources)
        else:
            assert 'точного SLA нет' in draft['problem_statement']
            assert not re.search(r'\d',draft['problem_statement'])
            assert any('SLA' in question for question in draft['open_questions'])
    finally:
        store.engine.dispose()
