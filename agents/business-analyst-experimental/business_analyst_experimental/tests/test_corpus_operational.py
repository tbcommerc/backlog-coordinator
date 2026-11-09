"""Frozen operational corpus through document actions, real persistence and transport.

Fixed model replies are authored fixtures. This does not claim model quality.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from business_analyst_experimental.tests.test_document_workspace import session,fake_model,perform
from business_analyst_experimental.v2 import document_workspace as workspace
from business_analyst_experimental.api.schemas import DocumentActionRequest
from business_analyst_experimental.session import SessionStore,state_to_dict
from business_analyst_experimental.llm.openai_compat import OpenAICompatProvider,settings

ROOT=Path(__file__).resolve().parents[4]/'docs/dev-testing/agent-services/corpus/v1'
INFO=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['services']['business-analyst-experimental']
RAW=(ROOT/INFO['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==INFO['sha256']
CASES=[case for case in json.loads(RAW)['cases'] if int(case['case_id'].rsplit('-',1)[1]) in {5,7,8,9,10,12}]


@pytest.mark.parametrize('case',CASES,ids=lambda item:item['case_id'])
def test_frozen_operational_document_corpus(session,monkeypatch,tmp_path,case):
    number=int(case['case_id'].rsplit('-',1)[1])
    store,orchestrator,identity=session
    instruction=case['input']['text']
    if number==5:
        original=store.get(identity).document_sources[0]
        perform(session,'add_source',source={'id':original['id'],'title':'SYN-source','content':instruction})
        assert max(s['version'] for s in store.get(identity).document_sources if s['id']==original['id'])==2
        fake_model(monkeypatch,{'operations':[{'field':'business_goal','after':'Предложенная цель'}]})
        proposed=perform(session,'propose_change',instruction=instruction)
        proposal=proposed.document_proposals[-1]
        before=deepcopy(store.get(identity).draft)
        perform(session,'add_source',source={'id':original['id'],'title':'SYN-source','content':instruction+' Новое основание revision 3.'})
        assert max(s['version'] for s in store.get(identity).document_sources if s['id']==original['id'])==3
        result=perform(session,'apply_proposal',proposal_id=proposal['id'],operation_ids=[proposal['operations'][0]['id']])
        assert result.action=='revision_conflict' and store.get(identity).draft==before
    elif number in (7,12):
        before=deepcopy(store.get(identity).draft)
        calls=[]
        monkeypatch.setattr(settings,'EXECUTION_BACKEND','direct')
        monkeypatch.setattr(settings,'MODEL_PROTOCOL','chat_completions')
        monkeypatch.setattr(settings,'OPENAI_API_KEY','synthetic-no-provider')
        provider=OpenAICompatProvider()
        def truncated(path,payload,**options):
            calls.append(payload)
            return {'choices':[{'message':{'content':'{"operations":[{"field":"business_goal","after":"Новая цель"}]'},'finish_reason':'length'}]}
        monkeypatch.setattr(provider,'_post',truncated)
        monkeypatch.setattr(workspace,'get_llm',lambda:provider)
        result=perform(session,'propose_change',instruction=instruction)
        assert result.action=='unavailable' and result.message
        assert store.get(identity).draft==before and not result.document_proposals
        assert len(calls)==1  # No hidden repair after an incomplete document.
    elif number==8:
        before=state_to_dict(store.get(identity))
        with pytest.raises(ValidationError):
            DocumentActionRequest(session_id=identity,user_id=17,action='approve',instruction=instruction)
        assert state_to_dict(store.get(identity))==before
        assert not store.get(identity).final_summary_confirmed
    elif number==9:
        while store.get(identity).draft['revision']<4:
            revision=store.get(identity).draft['revision']
            perform(session,'save_sections',sections={'title':'Synthetic revision '+str(revision+1)})
        before=deepcopy(store.get(identity).draft)
        assert before['revision']==4
        first=perform(session,'save_sections',sections={'business_goal':instruction})
        second=perform(session,'save_sections',expected_draft_hash=before['fingerprint'],sections={'business_goal':'Потерянная параллельная правка'})
        assert first.draft['revision']==5 and second.action=='revision_conflict'
        assert store.get(identity).draft==first.draft
    else:
        url='sqlite:///'+(tmp_path/'synthetic-document-history.sqlite').as_posix()
        first=SessionStore(database_url=url)
        state=first.new_session(17)
        workspace.save_sections(state,{'title':'CSV v1','problem_statement':instruction})
        workspace.save_sections(state,{'title':'CSV v2'})
        first.save(state)
        receipt={'action':'draft_ready','revision':2,'fingerprint':state.draft['fingerprint']}
        first.cache_response(state.session_id,case['case_id'],receipt)
        expected=state_to_dict(first.get(state.session_id))
        first.engine.dispose()
        restored=SessionStore(database_url=url,initialize=False)
        try:
            assert state_to_dict(restored.get(state.session_id))==expected
            assert restored.get_cached_response(state.session_id,case['case_id'])==receipt
            assert restored.get(state.session_id).draft['revision']==2
            assert len(restored.get(state.session_id).artifact_revision_history)==2
        finally:
            restored.engine.dispose()
