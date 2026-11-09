"""Execute all frozen product cases with isolated imports and external-network denial."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
SERVICES={
    'business-analyst':('.venv',['business_analyst/tests/test_corpus_replay.py']),
    # The runtime environment has no pytest; the root test interpreter is
    # explicit here. Artifact independence has a separate image qualification.
    'business-analyst-experimental':('.venv',['business_analyst_experimental/tests/test_corpus_documents.py','business_analyst_experimental/tests/test_corpus_operational.py']),
    'meeting-analyzer':('.venv',['tests/test_corpus_replay.py']),
    'value-priority-assessor':('.venv-prioritiser',['tests/test_corpus_recorded_go.py','tests/test_corpus_tools.py']),
    'backlog-assistant':('agents/backlog-assistant/.venv',['tests/test_corpus_replay.py']),
}
GUARD=r'''
import ipaddress,os,socket
def allowed(host):
    if host is None or host in ('','localhost'):return True
    try:return ipaddress.ip_address(host).is_loopback
    except ValueError:return False
def deny():
    with open(os.environ['CORPUS_NETWORK_GUARD_LOG'],'a',encoding='utf-8') as stream:
        stream.write('blocked_external_connection\n')
    raise RuntimeError('corpus_external_network_forbidden')
original_lookup=socket.getaddrinfo
def lookup(host,*args,**kwargs):
    if not allowed(host):deny()
    return original_lookup(host,*args,**kwargs)
socket.getaddrinfo=lookup
original_connect=socket.socket.connect
def connect(self,address):
    if isinstance(address,tuple) and not allowed(address[0]):deny()
    return original_connect(self,address)
socket.socket.connect=connect
original_connect_ex=socket.socket.connect_ex
def connect_ex(self,address):
    if isinstance(address,tuple) and not allowed(address[0]):deny()
    return original_connect_ex(self,address)
socket.socket.connect_ex=connect_ex
'''


def budget_snapshot():
    path=ROOT/'.runtime/agent-services-evidence/model-budget.json'
    if not path.exists():return None
    value=json.loads(path.read_text(encoding='utf-8'))
    if value.get('active_reservations'):
        raise RuntimeError('wait_for_active_live_qualification_before_offline_budget_comparison')
    return {key:value[key] for key in ('max_calls','max_seconds','reserved_calls','reserved_seconds')}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--service',action='append',choices=SERVICES)
    args=parser.parse_args()
    output=args.output.resolve()
    if not output.is_relative_to(ROOT/'.runtime') or output.exists():
        parser.error('New workspace evidence directory required')
    selected=args.service or list(SERVICES)
    if len(set(selected))!=len(selected):parser.error('Duplicate service selection')
    start_budget=budget_snapshot()
    output.mkdir(parents=True)
    guard_dir=output/'network-guard'
    guard_dir.mkdir()
    (guard_dir/'sitecustomize.py').write_text(GUARD,encoding='utf-8')
    corpus_root=ROOT/'docs/dev-testing/agent-services/corpus/v1'
    corpus=json.loads((corpus_root/'manifest.json').read_text(encoding='utf-8'))
    report={'scope':'offline_product_fixture_replay','model_quality_claim':False,'real_remote':'NOT_RUN',
        'canonical_denominator':60,'selected_denominator':12*len(selected),'live_model_calls':0,
        'protected_writes':0,'services':[],'budget_before':start_budget}
    for service in selected:
        environment,files=SERVICES[service]
        candidate=ROOT/environment/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        python=str(candidate) if candidate.is_file() else sys.executable
        own_dir=ROOT/'agents'/service
        guard_log=output/(service+'.network-guard.log')
        guard_log.write_text('',encoding='utf-8')
        junit=output/(service+'.junit.xml')
        log=output/(service+'.pytest.log')
        env={key:value for key,value in os.environ.items() if key.upper() in {
            'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA'}}
        env.update(PYTHONPATH=os.pathsep.join((str(guard_dir),str(own_dir))),PYTHONUTF8='1',
            PYTHONDONTWRITEBYTECODE='1',CORPUS_NETWORK_GUARD_LOG=str(guard_log))
        arguments=[python,'-X','utf8','-m','pytest',*files,'--noconftest','-p','no:cacheprovider','-q',
            '--basetemp='+str(output/(service+'.pytest-temp')),'--junitxml='+str(junit)]
        entry={'service':service,'status':'NOT_RUN','test_interpreter':python,'tests':files,
            'evidence_type':'authored_model_fixtures_and_validated_projections','junit':str(junit)}
        try:
            with log.open('w',encoding='utf-8') as stream:
                result=subprocess.run(arguments,cwd=own_dir,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=300)
            raw=(corpus_root/corpus['services'][service]['file']).read_bytes()
            assert hashlib.sha256(raw).hexdigest()==corpus['services'][service]['sha256']
            expected={case['case_id'] for case in json.loads(raw)['cases']}
            tree=ET.parse(junit)
            cases=tree.findall('.//testcase')
            seen=[]
            for case in cases:
                matches=re.findall(r'(?:business-analyst-experimental|business-analyst|meeting-analyzer|value-priority-assessor|backlog-assistant)-\d{2}',case.attrib['name'])
                assert len(matches)==1,'Missing or ambiguous frozen case identity'
                seen.append(matches[0])
            failed=sum(case.find('failure') is not None or case.find('error') is not None for case in cases)
            skipped=sum(case.find('skipped') is not None for case in cases)
            blocked=guard_log.read_text(encoding='utf-8').count('blocked_external_connection')
            entry.update(status='PASS' if result.returncode==0 and failed==0 and skipped==0 and blocked==0 and len(seen)==12 and set(seen)==expected else 'FAIL',
                cases=seen,failed=failed,skipped=skipped,blocked_external_connections=blocked,
                junit_sha256=hashlib.sha256(junit.read_bytes()).hexdigest())
        except (subprocess.TimeoutExpired,AssertionError,ET.ParseError,OSError):
            entry.update(status='FAIL',reason='Bounded offline replay or evidence assertion failed; see private log')
        report['services'].append(entry)
        (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'service':service,'status':entry['status'],'cases':len(entry.get('cases',[]))}),flush=True)
    report['budget_after']=budget_snapshot()
    report['budget_unchanged']=start_budget==report['budget_after']
    report['status']='PASS' if report['budget_unchanged'] and all(entry['status']=='PASS' for entry in report['services']) else 'FAIL'
    (output/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return 0 if report['status']=='PASS' else 1


if __name__=='__main__':
    raise SystemExit(main())
