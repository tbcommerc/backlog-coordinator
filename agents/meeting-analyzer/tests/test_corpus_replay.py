"""Frozen corpus through the real worker/store; explicit offline model fixtures."""
import hashlib
import json
from pathlib import Path

import pytest
from dmb_agent_contracts.model import ModelResult, Usage
from meeting_analyzer.store import now
from meeting_analyzer.worker import execute
from test_contract import storage, body

CORPUS = Path(__file__).resolve().parents[3]/'docs/dev-testing/agent-services/corpus/v1'
MANIFEST = json.loads((CORPUS/'manifest.json').read_text(encoding='utf-8'))
FIXTURE = MANIFEST['offline_fixtures']['meeting-analyzer']
RAW = (CORPUS/FIXTURE['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest() == FIXTURE['sha256']
CASES = json.loads(RAW)['cases']


@pytest.mark.parametrize('case',CASES,ids=lambda case:case['case_id'])
def test_frozen_meeting_worker_replay(storage,case):
    request = body(case['transcript'])
    profile = {'model':'offline-corpus-fixture'}
    row,_ = storage.create('dmb','synthetic-actor',case['case_id'],request,profile,600,10)
    calls=[]
    class Model:
        def complete(self, request):
            calls.append(request)
            assert request.purpose=='extraction' and not request.allowed_tools
            if case['case_id'].endswith('-12'):
                current=storage.get(row['id'])
                assert storage.transition(current,'cancelled',finished_at=now())
            return ModelResult(text=json.dumps(case['model_response'],ensure_ascii=False),
                structured=case['model_response'],finish_reason='stop',
                usage=Usage(unavailable_reason='explicit_offline_fixture'),
                model_actual='offline-fixture',elapsed_ms=0)
    execute(storage,storage.claim(),Model())
    current=storage.get(row['id'])
    assert len(calls)==1
    if case['case_id'].endswith('-12'):
        assert current['status']=='cancelled' and current['result'] is None
        return
    if case['reject']:
        assert current['status']=='failed' and current['result'] is None
        return
    assert current['status']=='completed', current.get('error')
    items=current['result']['items']
    for item in items:
        assert item['quote'] in case['transcript']
        assert item['origin']=='ai' and item['selected'] is False
        assert item['due_date'] is item['link_choice'] is item['task_id'] is None
        assert 'user_id' not in item
    number=int(case['case_id'].rsplit('-',1)[1])
    if number in (2,4,8):
        assert items==[]
    elif number==6:
        assert len(items)==1 and items[0]['owner_text']=='' and items[0]['due_text']=='до конца недели'
    elif number==7:
        assert len(items)==1
    elif number==10:
        assert items[0]['due_text']=='завтра'
    if number==11:
        replay,replayed=storage.create('dmb','synthetic-actor',case['case_id'],request,profile,600,10)
        assert replayed and replay['id']==row['id']
        assert storage.get(row['id'])['result']==current['result']
        assert storage.claim() is None and len(calls)==1
