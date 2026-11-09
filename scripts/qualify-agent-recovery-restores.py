"""Restore combined synthetic histories and open them through hashed recovery artifacts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
from uuid import uuid4


def main():
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--postgres-container-id',required=True)
    args=parser.parse_args();source=args.source.resolve();output=args.output.resolve()
    if not source.is_relative_to(root/'.runtime') or not output.is_relative_to(root/'.runtime') or output.exists():
        parser.error('Existing workspace evidence and new output required')
    if not re.fullmatch('[a-f0-9]{64}',args.postgres_container_id):parser.error('Exact container identity required')
    def docker(*arguments,data=None):
        result=subprocess.run(['docker',*arguments],input=data,capture_output=True,timeout=120)
        if result.returncode:raise RuntimeError('disposable_docker_command_failed')
        return result.stdout
    identity=json.loads(docker('inspect','dmb-agent-qualification'))[0]
    if identity['Id']!=args.postgres_container_id or identity['Name']!='/dmb-agent-qualification':
        raise RuntimeError('disposable_container_identity_mismatch')
    if not any(value['HostPort']=='51600' for value in identity['NetworkSettings']['Ports'].get('5432/tcp',[])):
        raise RuntimeError('disposable_postgres_port_mismatch')
    previous=json.loads(source.read_text(encoding='utf-8'))
    if previous['status']!='PASS' or len(previous['services'])!=5:raise RuntimeError('five_successful_source_drills_required')
    tables=runpy.run_path(str(root/'scripts/qualify-agent-storage.py'))['TABLES']
    child=runpy.run_path(str(root/'scripts/agent_recovery_cases.py'))['CHILD']
    environments={'business-analyst':'.venv','business-analyst-experimental':'.venv-agent-v2',
      'meeting-analyzer':'.venv','value-priority-assessor':'.venv-prioritiser','backlog-assistant':'agents/backlog-assistant/.venv'}
    report={'scope':'restore_combined_histories_and_read_only_application','status':'NOT_RUN',
      'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
      'driver_sha256':hashlib.sha256(child.encode()).hexdigest(),'model_calls':0,'protected_writes':0,
      'working_services_changed':False,'real_remote':'NOT_RUN','services':[]}
    output.mkdir(parents=True)
    def save():
        temporary=output/'manifest.json.tmp'
        with temporary.open('w',encoding='utf-8') as stream:
            stream.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,output/'manifest.json')
    def sql(database,query):
        return docker('exec',args.postgres_container_id,'psql','-U','postgres','-d',database,'-At','-c',query).decode().strip()
    def fingerprint(database,service):
        names=sql(database,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
        if not set(names)<=tables[service]|{'agent_runtime_bindings','agent_runtime_migrations'}:
            raise RuntimeError('synthetic_table_allowlist_mismatch')
        values={}
        for name in names:
            if not re.fullmatch('[a-z_][a-z0-9_]*',name):raise RuntimeError('unexpected_table_name')
            query="SELECT count(*),md5(COALESCE(string_agg(v,'' ORDER BY v),'')) FROM (SELECT row_to_json(t)::text AS v FROM \""+name+"\" t) x"
            values[name]=sql(database,query)
        if 'reference' in values and not values['reference'].startswith('0|'):raise RuntimeError('protected_reference_rows')
        return values
    for row in previous['services']:
        service=row['service'];entry={'service':service,'status':'NOT_RUN'};report['services'].append(entry);save()
        try:
            database=row['database']
            if not re.fullmatch('agent_recovery_[a-f0-9]{32}',database):raise RuntimeError('disposable_database_scope_mismatch')
            bundle=source.parent/'artifacts'/service
            for name,digest in row['artifact_files'].items():
                path=(bundle/name).resolve()
                if not path.is_relative_to(bundle.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
                    raise RuntimeError('recovery_artifact_changed')
            before=fingerprint(database,service)
            dump=docker('exec',args.postgres_container_id,'pg_dump','-U','postgres','-d',database,'-Fc','--no-owner','--no-acl')
            if not dump:raise RuntimeError('empty_dump')
            (output/(service+'-combined-synthetic.dump')).write_bytes(dump)
            restored='agent_recovery_restore_'+uuid4().hex
            sql('postgres','CREATE DATABASE '+restored)
            docker('exec','-i',args.postgres_container_id,'pg_restore','-U','postgres','-d',restored,'--no-owner','--no-acl','--exit-on-error',data=dump)
            if fingerprint(restored,service)!=before:raise RuntimeError('combined_restore_mismatch')
            config={'service':service,'action':'read','database_url':'postgresql+psycopg://postgres@127.0.0.1:51600/'+restored,
              'record':str(source.parent/(service+'-synthetic.json')),
              'adapter':str(bundle/service.replace('-','_')/'recovery.py')}
            env={name:value for name,value in os.environ.items() if name.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
            env.update(PYTHONPATH=os.pathsep.join((str(bundle/'sdk'),str(bundle))),PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1')
            result=subprocess.run([str(root/environments[service]/'Scripts/python.exe'),'-X','utf8','-c',child],
              input=json.dumps(config),cwd=output,env=env,capture_output=True,text=True,encoding='utf-8',timeout=180)
            (output/(service+'-reader.log')).write_text(result.stderr,encoding='utf-8')
            if result.returncode:raise RuntimeError('restored_application_reader_failed')
            reader=json.loads(result.stdout.strip().splitlines()[-1])
            # Nonces are intentionally excluded by the child, but source must be exactly unchanged.
            if reader['status']!='PASS' or fingerprint(database,service)!=before:raise RuntimeError('restored_reader_or_source_changed')
            entry.update(status='PASS',restored_database=restored,reader=reader,
              dump_sha256=hashlib.sha256(dump).hexdigest(),table_fingerprints=before)
        except Exception as error:
            entry.update(status='FAIL',reason=str(error) if isinstance(error,RuntimeError) else type(error).__name__)
        save()
    report['status']='PASS' if all(row['status']=='PASS' for row in report['services']) else 'FAIL';save()
    print(json.dumps({'status':report['status'],'services':{row['service']:row['status'] for row in report['services']}}))
    return 0 if report['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
