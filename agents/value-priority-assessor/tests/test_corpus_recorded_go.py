"""Offline replay of validated synthetic Go assessment projections; no new model requests."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import select,func
from sqlalchemy.orm import Session
from value_priority_assessor import remote_tools as tools
from value_priority_assessor.core.models import Task,LlmCall,FactorAssessment
from value_priority_assessor.strategy.analysts import AgentStrategyAnalyst
from test_remote_tools import fixture,grant,call,promote

ROOT=Path(__file__).resolve().parents[3]/'docs/dev-testing/agent-services/corpus/v1'
MANIFEST=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
FIXTURE=MANIFEST['offline_fixtures']['value-priority-assessor']
RAW=(ROOT/FIXTURE['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==FIXTURE['sha256']
RECORDED=json.loads(RAW)['cases']
CASES={case['case_id']:case for case in json.loads((ROOT/'value-priority-assessor.json').read_text(encoding='utf-8'))['cases']}


@pytest.mark.parametrize('record',RECORDED,ids=lambda record:record['case_id'])
def test_assessor_recorded_go_corpus(fixture,monkeypatch,record):
    client,engine,digest,recalculations,rubric=fixture
    LlmCall.__table__.create(engine)
    rubric['strategy_fit']['criteria'][0]['options']['unknown']={'value':0,'title':'Недостаточно данных'}
    responses=iter(record['responses'])
    calls=[]
    class Adapter:
        name='captured-synthetic-go'
        model='glm-5.3-flash'
        def complete(self,system,user,schema):
            calls.append(user)
            return next(responses)
    @contextmanager
    def history():
        with Session(engine) as session:
            yield session
            session.commit()
    analyst=AgentStrategyAnalyst(Adapter(),use_rag=False,session_factory=history)
    hits=[]
    number=int(record['case_id'].rsplit('-',1)[1])
    if number==3:
        old='SYN-TASK-3: подтверждений synthetic критерия стратегии нет.'
        first=analyst.assess(old,None,rubric)
        hits.append(analyst.last_cache_hit)
        assert analyst.assess(old,None,rubric).as_dict()==first.as_dict()
        hits.append(analyst.last_cache_hit)
        run,old_grant=grant(fixture)
        with Session(engine) as session:
            task=session.scalar(select(Task))
            task.title='Updated synthetic evidence'
            session.commit()
            digest=tools.source_hash(task)
        assert call(fixture,run,old_grant).status_code==409
    text=CASES[record['case_id']]['input']['text']
    if number==3:
        text+=' Разрешённое evidence SYN-EVIDENCE-2: инициатива явно выполняет synthetic критерий стратегии.'
    assessment=analyst.assess(text,None,rubric)
    hits.append(analyst.last_cache_hit)
    assert assessment.raw_score==(10 if number in (1,3) else 1)
    assert set(assessment.answers)=={'synthetic'}
    if number==3:
        assert hits==[False,True,False] and len(calls)==2
        current=(client,engine,digest,recalculations,rubric)
        run,credential=grant(current)
        assert call(current,run,credential,answers=assessment.answers,rationale=assessment.rationale).status_code==200
        assert promote(current,run)
    else:
        assert len(calls)==1
        if number==4:
            run,credential=grant(fixture)
            assert call(fixture,run,credential,sql='DROP TABLE task').status_code==422
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(LlmCall))==len(calls)
        assert session.scalar(select(func.count()).select_from(FactorAssessment))==(1 if number==3 else 0)
        assert session.scalar(select(Task)).dependency_score is None
