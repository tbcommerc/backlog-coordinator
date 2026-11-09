"""Export actual product APIs without lifespan, database access or inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {
    'business-analyst': ('.venv','business_analyst.main'),
    'business-analyst-experimental': ('.venv-agent-v2','business_analyst_experimental.main'),
    'meeting-analyzer': ('.venv','meeting_analyzer.api'),
    'value-priority-assessor': ('.venv-prioritiser','value_priority_assessor.api.main'),
    'backlog-assistant': ('agents/backlog-assistant/.venv',None),
}


def schema(service):
    import httpx
    import urllib.request
    def forbidden(*args, **kwargs):
        raise RuntimeError('schema_export_network_forbidden')
    httpx.HTTPTransport.handle_request = forbidden
    httpx.AsyncHTTPTransport.handle_async_request = forbidden
    urllib.request.OpenerDirector.open = forbidden
    from sqlalchemy.engine import Engine
    Engine.connect = forbidden
    if service == 'backlog-assistant':
        from sqlalchemy import create_engine
        from types import SimpleNamespace
        from backlog_assistant.app import create_app
        engine = create_engine('sqlite://')
        try:
            app = create_app(SimpleNamespace(engine=engine),None,None,
                'schema-export-only-'+'x'*32,run_workers=False)
            return app.openapi()
        finally:
            engine.dispose()
    import importlib
    return importlib.import_module(SERVICES[service][1]).app.openapi()


def export(service, *, check=False):
    environment = {name:value for name,value in os.environ.items()
        if name.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
    environment.update(PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1',
        AGENT_DATABASE_URL='sqlite://', AGENT_V2_DATABASE_URL='sqlite://',
        PRIORITISER_DATABASE_URL='sqlite://', RUN_STARTUP_SEED='false',
        AGENT_UNIT_TEST_MODE='true', AGENT_V2_UNIT_TEST_MODE='true', PRIORITISER_UNIT_TEST_MODE='true')
    source = ROOT/'agents'/service
    environment['PYTHONPATH'] = str(source)
    python = ROOT/SERVICES[service][0]/'Scripts/python.exe'
    if not python.is_file():
        python = Path(sys.executable)
    result = subprocess.run([str(python),'-X','utf8',str(Path(__file__).resolve()),'--worker',service],
        cwd=source,env=environment,capture_output=True,text=True,encoding='utf-8',timeout=60)
    if result.returncode:
        raise RuntimeError('openapi_export_failed:'+service)
    document = json.loads(result.stdout)
    assert document['openapi'].startswith('3.') and '/internal/agent/v1/runs' in document['paths']
    content = json.dumps(document,ensure_ascii=False,indent=2,sort_keys=True)+'\n'
    destination = source/'contracts/agent.openapi.json'
    if check:
        if not destination.is_file() or destination.read_text(encoding='utf-8') != content:
            raise RuntimeError('openapi_snapshot_changed:'+service)
    else:
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(content,encoding='utf-8')
    return {'service':service,'sha256':hashlib.sha256(content.encode()).hexdigest(),'paths':len(document['paths'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--service',action='append',choices=SERVICES)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--worker',choices=SERVICES,help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        print(json.dumps(schema(args.worker),ensure_ascii=False))
        return
    for service in args.service or SERVICES:
        print(json.dumps(export(service,check=args.check)))


if __name__ == '__main__':
    main()
