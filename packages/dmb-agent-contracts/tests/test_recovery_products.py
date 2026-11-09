"""Each product recovery entry reads committed histories in a fresh process."""
import json
import os
from pathlib import Path
import runpy
import subprocess

import pytest
from test_service_settings import service_python

ROOT=Path(__file__).resolve().parents[3]
CHILD=runpy.run_path(str(ROOT/'scripts/agent_recovery_cases.py'))['CHILD']


@pytest.mark.parametrize('service',['business-analyst','business-analyst-experimental',
    'meeting-analyzer','value-priority-assessor','backlog-assistant'])
def test_product_recovery_keeps_history_and_cannot_dispatch(tmp_path,service):
    env={name:value for name,value in os.environ.items() if name.upper() in
        {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
    own=ROOT/'agents'/service
    env.update(PYTHONPATH=os.pathsep.join((str(ROOT/'packages/dmb-agent-contracts'),str(own))),
        PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1')
    config={'service':service,'database_url':'sqlite:///'+(tmp_path/'history.sqlite').as_posix(),
        'record':str(tmp_path/'synthetic-record.json'),'adapter':str(own/service.replace('-','_')/'recovery.py')}
    for action in ('write','read'):
        result=subprocess.run([service_python(ROOT,service),'-X','utf8','-c',CHILD],
            input=json.dumps({**config,'action':action}),cwd=tmp_path,env=env,
            capture_output=True,text=True,encoding='utf-8',timeout=90)
        assert result.returncode==0,result.stderr[-3000:]
        assert json.loads(result.stdout.strip().splitlines()[-1])['status']=='PASS'
