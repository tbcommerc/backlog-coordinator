"""Compare frozen pre-migration and candidate formula kernels without a database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

CHILD=r'''
import datetime as dt,json,socket
from dataclasses import asdict
def forbidden(*args,**kwargs):raise AssertionError('Formula replay must not open a network connection')
socket.socket.connect=forbidden
from value_priority_assessor.core.models import Task
from value_priority_assessor.core.references import ReferenceBundle
from value_priority_assessor.core.scoring import ScoringContext,score_task
tasks=[]
for index,(manual,regulatory,rnd) in enumerate(((0.,False,False),(1.5,False,False),
    (20.,False,False),(1.5,True,False),(1.5,False,True),(20.,True,True))):
    tasks.append(Task(task_key='SYN-FORMULA-'+str(index),title='Synthetic formula snapshot',
      team_class='serving',value_manual_mln=manual,value_internal_mln=manual,value_source='manual',
      cost_rub=10,cost_to_value=.1,effort_man_days=3,strategy_fit_raw=7,dependency_score=.8,
      is_regulatory=regulatory,is_rnd=rnd,created_date=dt.date(2026,10,1),deadline=dt.date(2026,12,31)))
context=ScoringContext.from_tasks(tasks,today=dt.date(2026,11,2))
references=ReferenceBundle(None)  # Read-only versioned YAML, never seed/reference rows.
print(json.dumps({'snapshot_id':'synthetic-priority-formula-v1','today':'2026-11-02',
  'results':{task.task_key:asdict(score_task(task,references,context)) for task in tasks}},
  ensure_ascii=False,sort_keys=True))
'''


def main():
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepared',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    prepared=args.prepared.resolve();output=args.output.resolve()
    if not prepared.is_relative_to(root/'.runtime') or not output.is_relative_to(root/'.runtime') or output.exists():
        parser.error('Existing workspace capsule and new workspace evidence directory required')
    plan=json.loads((prepared/'plan.json').read_text(encoding='utf-8'))
    service='agents/value-priority-assessor/'
    report={'scope':'frozen_formula_kernel_comparison','status':'NOT_RUN','protected_writes':0,
      'database_connections':0,'live_model_calls':0,'real_remote':'NOT_RUN',
      'baseline_revision':plan['baseline_revision'],'snapshot_cases':6,
      'driver_sha256':hashlib.sha256(CHILD.encode()).hexdigest(),'phases':{}}
    output.mkdir(parents=True)
    python=root/'.venv-prioritiser/Scripts/python.exe'
    for phase in ('baseline','candidate'):
        exported=prepared/(phase+'-src')
        hashes={name:digest for name,digest in plan[phase+'_files'].items() if name.startswith(service)}
        assert hashes and all(hashlib.sha256((exported/name).read_bytes()).hexdigest()==digest
                              for name,digest in hashes.items()),'frozen_formula_source_changed'
        env={name:value for name,value in os.environ.items() if name.upper() in {
          'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
        env.update(PYTHONPATH=str(exported/service),PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1')
        result=subprocess.run([str(python),'-X','utf8','-c',CHILD],cwd=output,env=env,
          capture_output=True,text=True,encoding='utf-8',timeout=60)
        if result.returncode:raise RuntimeError('frozen_formula_child_failed')
        value=json.loads(result.stdout)
        report['phases'][phase]={'result':value,'source_sha256':hashes,
          'result_sha256':hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()}
    assert report['phases']['baseline']['result']==report['phases']['candidate']['result'],'formula_regression'
    report['status']='PASS'
    (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':'PASS','snapshot_cases':6,'baseline_candidate_equal':True,
                     'model_calls':0,'protected_writes':0}))


if __name__=='__main__':main()
