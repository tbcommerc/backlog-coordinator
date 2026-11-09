"""Exercise the actual replay controller with fake workers and a private ledger."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


@pytest.fixture
def replay(tmp_path, monkeypatch):
    scripts=Path(__file__).resolve().parents[3]/'scripts'
    monkeypatch.syspath_prepend(str(scripts))
    spec=importlib.util.spec_from_file_location('qualification_replay_test',scripts/'replay-agent-products.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root=tmp_path/'workspace'
    (root/'scripts').mkdir(parents=True)
    driver=root/'scripts/agent_product_cases.py'
    driver.write_text('# synthetic controller-only fixture\n')
    digest=hashlib.sha256(driver.read_bytes()).hexdigest()
    mappings=root/'packages/dmb-agent-contracts/dmb_agent_contracts/profiles.json'
    mappings.parent.mkdir(parents=True)
    mappings.write_text(json.dumps({'business-analyst':{'OPENAI_API_KEY':['AGENT_MODEL_API_KEY']}}))
    prepared=root/'.runtime/prepared'
    prepared.mkdir(parents=True)
    plan={'baseline_revision':module.BASELINE,'driver_sha256':digest,
      'scope':'frozen_live_product_selection','baseline_files':{},'candidate_files':{},
      'execution_sources':{'agent_product_cases.py':digest},'cases':[
        {'phase':phase,'service':'business-analyst','case_id':'business-analyst-01'}
        for phase in ('baseline','candidate')]}
    (prepared/'plan.json').write_text(json.dumps(plan))
    case={'case_id':'business-analyst-01','expected':{'assertions':[{'assertion_id':'required'}]}}
    monkeypatch.setattr(module,'ROOT',root)
    monkeypatch.setattr(module,'load_corpus',lambda:({},[case]))
    monkeypatch.setattr(module,'profile',lambda service:('synthetic-key','https://opencode.ai/zen/go/v1','synthetic','',{}))
    commands=[]
    def command(arguments,**options):
        commands.append(arguments)
        if arguments[:2]==['docker','inspect']:return json.dumps([{'Id':'a'*64}]).encode()
        return b''
    monkeypatch.setattr(module,'command',command)
    ledger=root/'.runtime/budget.json'
    ledger.write_text(json.dumps({'max_calls':2,'max_seconds':2000,'reserved_calls':0,'reserved_seconds':0}))
    from agent_live_budget import LiveBudget
    def install_worker(count=2, unknown=False):
        def run(arguments,**options):
            assert arguments[-1]=='--worker'
            config=json.loads(options['input'])
            attempts=[]
            for _ in range(count):
                if unknown:
                    with pytest.raises(ConnectionError):
                        with LiveBudget(ledger).request(650):raise ConnectionError('synthetic')
                else:
                    with LiveBudget(ledger).request(1):pass
                attempts.append({'outcome':'unknown' if unknown else 'transport_closed','http_status':200})
            result={'case_id':case['case_id'],'phase':config['phase'],
              'status':'FAIL' if unknown else 'REVIEW_REQUIRED','attempts':attempts}
            return subprocess.CompletedProcess(arguments,0,stdout=json.dumps(result),stderr='')
        monkeypatch.setattr(module.subprocess,'run',run)
    return module,root,prepared,ledger,commands,install_worker


def test_exhaustion_keeps_unsent_case_and_does_not_create_its_database(replay):
    module,root,prepared,ledger,commands,worker=replay
    worker()
    report=module.execute(prepared,root/'.runtime/first',ledger,'a'*64)
    assert report['canonical_logical_cases']==report['selected_logical_cases']==2
    assert [row['status'] for row in report['cases']]==['REVIEW_REQUIRED','NOT_RUN']
    assert report['cases'][1]['attempted'] is False
    assert report['cases'][1]['reason']=='live_budget_exhausted'
    assert report['cases'][1]['assertions']=={'required':'NOT_RUN'}
    assert report['model_calls']==2
    assert sum('createdb' in command for command in commands)==1


def test_continuation_retries_only_explicitly_unsent_cases(replay):
    module,root,prepared,ledger,commands,worker=replay
    worker()
    module.execute(prepared,root/'.runtime/first',ledger,'a'*64)
    value=json.loads(ledger.read_text())
    value['max_calls']=3  # Separate synthetic authorization; never the live ledger.
    ledger.write_text(json.dumps(value))
    worker(count=1)
    report=module.execute(prepared,root/'.runtime/next',ledger,'a'*64,
        continue_from=root/'.runtime/first/manifest.json')
    assert report['canonical_logical_cases']==2 and report['selected_logical_cases']==1
    assert report['cases'][0]['phase']=='candidate'
    assert report['continuation_from']['preserved_cases']==1
    assert report['model_calls']==1 and json.loads(ledger.read_text())['reserved_calls']==3


def test_unknown_outcome_is_not_retried_and_remaining_denominator_is_visible(replay):
    module,root,prepared,ledger,commands,worker=replay
    worker(count=1,unknown=True)
    output=root/'.runtime/unknown'
    with pytest.raises(RuntimeError,match='product_replay_unknown_outcome_stopped'):
        module.execute(prepared,output,ledger,'a'*64)
    report=json.loads((output/'manifest.json').read_text())
    assert [row['status'] for row in report['cases']]==['FAIL','NOT_RUN']
    assert report['cases'][0]['attempted'] is True
    assert report['cases'][1]['reason']=='prior_outcome_unconfirmed_or_provider_blocked'
    assert json.loads(ledger.read_text())['reserved_seconds']==650


def test_no_time_for_full_reservation_stops_before_any_worker_or_database(replay):
    module,root,prepared,ledger,commands,worker=replay
    value=json.loads(ledger.read_text());value['max_seconds']=649
    ledger.write_text(json.dumps(value))
    worker()
    before=ledger.read_bytes()
    report=module.execute(prepared,root/'.runtime/no-time',ledger,'a'*64)
    assert all(row['status']=='NOT_RUN' and not row['attempted'] for row in report['cases'])
    assert not any('createdb' in command for command in commands)
    assert report['model_calls']==0 and ledger.read_bytes()==before


def test_parent_interruption_fences_unknown_worker_before_a_possible_call(replay,monkeypatch):
    module,root,prepared,ledger,commands,worker=replay
    def interrupted(*args,**options):
        raise KeyboardInterrupt('synthetic controller interruption')
    monkeypatch.setattr(module.subprocess,'run',interrupted)
    output=root/'.runtime/interrupted'
    with pytest.raises(KeyboardInterrupt):
        module.execute(prepared,output,ledger,'a'*64)
    report=json.loads((output/'manifest.json').read_text())
    assert report['cases'][0]['status']=='BLOCKED' and report['cases'][0]['attempted'] is True
    assert report['cases'][0]['reason']=='worker_outcome_pending'
    assert report['cases'][1]['attempted'] is False
    worker(count=1)
    continued=module.execute(prepared,root/'.runtime/after-interruption',ledger,'a'*64,
        continue_from=output/'manifest.json')
    assert len(continued['cases'])==1 and continued['cases'][0]['phase']=='candidate'
