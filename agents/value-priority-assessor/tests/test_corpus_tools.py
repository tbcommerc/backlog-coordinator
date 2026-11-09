"""Frozen operational corpus over HTTP tools and the unchanged scoring kernel."""
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path

import pytest
from sqlalchemy import select,func
from sqlalchemy.orm import Session
from value_priority_assessor import remote_tools as tools
from value_priority_assessor.core import service
from value_priority_assessor.core.models import Task,FactorAssessment,PriorityHistory
from value_priority_assessor.core.references import ReferenceBundle
from value_priority_assessor.core.scoring import ScoringContext,score_task
from test_remote_tools import fixture,grant,call,promote

ROOT=Path(__file__).resolve().parents[3]/'docs/dev-testing/agent-services/corpus/v1'
MANIFEST=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
SPEC=MANIFEST['services']['value-priority-assessor']
RAW=(ROOT/SPEC['file']).read_bytes()
assert hashlib.sha256(RAW).hexdigest()==SPEC['sha256']
CASES=json.loads(RAW)['cases'][4:]
TODAY=date(2026,11,2)


@pytest.mark.parametrize('case',CASES,ids=lambda case:case['case_id'])
def test_frozen_factor_tools_corpus(fixture,monkeypatch,case):
    client,engine,_,recalculations,rubric=fixture
    PriorityHistory.__table__.create(engine)
    references=ReferenceBundle(None)  # Read-only file configuration, no reference rows.
    monkeypatch.setattr(service,'ReferenceBundle',lambda _:references)
    def forbidden(*args,**kwargs):
        raise AssertionError('A factor tool may not invoke model, Value or retrieval')
    for name in ('get_adapter','get_strategy_analyst','get_dependency_analyst','AnalogyIndex','_prepare_task'):
        monkeypatch.setattr(service,name,forbidden)
    def rescore(session,task,**kwargs):
        recalculations.append(task.task_key)
        return service.recompute_factor_priority(session,task,today=TODAY)
    monkeypatch.setattr(tools,'recompute_factor_priority',rescore)
    with Session(engine) as session:
        task=session.scalar(select(Task))
        task.title=case['input']['text']
        task.team_class='serving'
        task.value_manual_mln=task.value_internal_mln=4
        task.value_source='manual'
        task.cost_rub=10
        task.cost_to_value=.1
        task.effort_man_days=3
        session.commit()
        digest=tools.source_hash(task)
    environment=(client,engine,digest,recalculations,rubric)
    run,credential=grant(environment)
    number=int(case['case_id'].rsplit('-',1)[1])
    if number==5:
        assert call(environment,run,credential,operation='dependency-assess',answers=None,teams=[]).status_code==403
    elif number in (6,7,11):
        first=call(environment,run,credential)
        assert first.status_code==200 and first.json()['status']=='staged'
        if number==7:
            assert call(environment,run,credential,answers={'synthetic':'none'}).status_code==409
        else:
            assert call(environment,run,credential).json()==first.json()
        assert promote(environment,run)
        with Session(engine) as session:
            task=session.scalar(select(Task))
            expected=score_task(task,references,ScoringContext.from_tasks([task],today=TODAY))
            assert task.priority==expected.priority and task.priority_score==expected.score
            assert task.factor_scores==expected.factors
            assert (task.value_manual_mln,task.value_internal_mln,task.value_source,task.cost_rub)==(4,4,'manual',10)
            assert session.scalar(select(func.count()).select_from(FactorAssessment))==1
            assert session.scalar(select(func.count()).select_from(PriorityHistory))==1
            assert session.scalar(select(func.count()).select_from(tools.receipts))==1
        assert len(recalculations)==1
        return
    elif number==8:
        with engine.begin() as connection:
            connection.execute(tools.grants.update().where(tools.grants.c.id==credential['grant_id']).values(
                expires_at=tools.now()-timedelta(seconds=1)))
        assert call(environment,run,credential).status_code==401
    elif number==9:
        rubric['strategy_fit']['rubric_version']+=1
        assert call(environment,run,credential).status_code==409
    elif number==10:
        assert call(environment,run,credential).json()['status']=='staged'
        with pytest.raises(RuntimeError,match='synthetic_parent_commit_failure'):
            with Session(engine) as session:
                tools.promote_staged(session,run)
                session.flush()
                raise RuntimeError('synthetic_parent_commit_failure')
        from dmb_agent_contracts.run_store import runs
        with engine.begin() as connection:
            connection.execute(runs.update().where(runs.c.id==run).values(status='failed',version=2))
        assert call(environment,run,credential).status_code==409
        with engine.connect() as connection:
            # A durable staged audit receipt is never a publication receipt.
            assert connection.execute(select(tools.receipts.c.response)).scalar_one()['status']=='staged'
    elif number==12:
        for index in range(12):
            assert call(environment,run,credential,call_id='read-'+str(index),operation='rubric-read',
                answers=None,rationale='',evidence=[]).status_code==200
        assert call(environment,run,credential,call_id='thirteenth').status_code==429
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(FactorAssessment))==0
        assert session.scalar(select(func.count()).select_from(PriorityHistory))==0
        task=session.scalar(select(Task))
        assert task.strategy_fit_raw is None and task.dependency_score is None and task.priority is None
        assert task.value_manual_mln==task.value_internal_mln==4
