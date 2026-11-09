"""Actual V2 settings record an explicit process-only inherited profile."""
import os
from pathlib import Path
import subprocess
from test_service_settings import service_python


def test_v2_inheritance_provenance_is_frozen_without_file_writes(tmp_path):
    root=Path(__file__).resolve().parents[3]
    env={key:value for key,value in os.environ.items() if key.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP'}}
    env.update(PYTHONPATH=str(root/'agents/business-analyst-experimental'),
        AGENT_V2_EXPLICIT_INHERITANCE='true',AGENT_V2_LLM_PROVIDER='openai_compat',
        AGENT_V2_MODEL_API_KEY='synthetic-inheritance-private',AGENT_V2_MODEL_BASE_URL='https://opencode.ai/zen/go/v1',
        AGENT_V2_MODEL_NAME='synthetic-model')
    code=r'''
import os,hashlib
from pathlib import Path
from business_analyst_experimental.config import Settings
path=Path('.env')
before=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
inherited=Settings(_env_file=None)
for field in ('LLM_PROVIDER','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'):
    origin=inherited.configuration_sources()[field]
    assert origin['source']=='inheritance' and origin['from_service']=='business-analyst'
assert 'synthetic-inheritance-private' not in str(inherited.configuration_sources())
explicit=Settings(_env_file=None,OPENAI_MODEL='explicit-synthetic')
assert explicit.configuration_sources()['OPENAI_MODEL']['source']=='explicit'
os.environ.pop('AGENT_V2_EXPLICIT_INHERITANCE')
assert Settings(_env_file=None).configuration_sources()['OPENAI_MODEL']['source']=='process'
assert inherited.configuration_sources()['OPENAI_MODEL']['source']=='inheritance'
after=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
assert before==after
print('PASS')
'''
    result=subprocess.run([service_python(root,'business-analyst-experimental'),'-X','utf8','-c',code],
        cwd=root/'agents/business-analyst-experimental',env=env,capture_output=True,text=True,encoding='utf-8',timeout=45)
    assert result.returncode==0,'V2 inheritance configuration contract failed'
    assert result.stdout.strip()=='PASS'
