"""Authenticated legacy coordinator requests share the persistent run queue."""
import os
from pathlib import Path
import subprocess

from test_service_settings import service_python


def test_assessor_legacy_delivery_key_and_actor_are_preserved(tmp_path):
    root = Path(__file__).resolve().parents[3]
    env = {key:value for key,value in os.environ.items()
           if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
    env.update(PYTHONPATH=os.pathsep.join([str(root/'packages/dmb-agent-contracts'),
        str(root/'agents/value-priority-assessor')]),PYTHONUTF8='1',
        PRIORITISER_DATABASE_URL='sqlite:///'+(tmp_path/'queue.sqlite').as_posix())
    child = r'''
from dmb_agent_contracts.run_migration import migrate
from dmb_agent_contracts.run_worker import execute
from dmb_agent_contracts.model import AgentError
from value_priority_assessor import compatibility as compat, runs
from value_priority_assessor.api.contract import TaskAttributes
migrate(runs.store.engine)
calls=[]
original_wait=compat.wait_result
def pump(store,row):
    claimed=store.claim()
    if claimed:
        def handle(current,connection):
            calls.append((current['actor'],current['key'],current['source']['revision']))
            return {'quality':'full','payload':{'synthetic':True,'actor':current['actor']}}
        execute(store,claimed,handle)
    return original_wait(store,row)
compat.wait_result=pump
task=TaskAttributes(task_id='SYN-1',task_type='Synthetic',team='Synthetic',title='Synthetic')
options={'caller':'dmb','actor':'123','key':'stable-delivery','revision':7}
result=compat.estimate(task,'value',**options)
assert compat.estimate(task,'value',**options)==result
assert calls==[('123','stable-delivery',7)]
try:
    compat.estimate(task.model_copy(update={'title':'Changed'}),'value',**options)
except AgentError as error:
    assert error.code=='idempotency_conflict'
else:
    raise AssertionError('Changed snapshot accepted')
assert compat.estimate(task,'value',**{**options,'actor':'124'})['actor']=='124'
assert len(calls)==2
try:
    compat.estimate(task,'value',caller='dmb',actor='123',key='')
except AgentError as error:
    assert error.code=='operation_forbidden'
else:
    raise AssertionError('Incomplete identity accepted')
print('PASS')
'''
    result = subprocess.run([service_python(root,'value-priority-assessor'),'-X','utf8','-c',child],
        cwd=tmp_path,env=env,capture_output=True,text=True,encoding='utf-8',timeout=60)
    assert result.returncode == 0, result.stderr[-2400:]
    assert result.stdout.strip() == 'PASS'
