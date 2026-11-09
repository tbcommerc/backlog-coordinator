"""Sequential application rollback drill on fresh disposable PostgreSQL only.

Current code writes synthetic history; pinned old business code reads it through
an explicit current read-only adapter. No production DSN or writable old worker.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import shutil
from uuid import uuid4


def main():
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepared',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--postgres-container-id',required=True)
    parser.add_argument('--two-releases',action='store_true')
    args=parser.parse_args()
    prepared=args.prepared.resolve();output=args.output.resolve()
    if not prepared.is_relative_to(root/'.runtime') or not output.is_relative_to(root/'.runtime') or output.exists():
        parser.error('Existing capsule and new workspace evidence directory required')
    if not re.fullmatch('[a-f0-9]{64}',args.postgres_container_id):
        parser.error('Exact disposable container identity required')
    def docker(*arguments):
        result=subprocess.run(['docker',*arguments],capture_output=True,timeout=90)
        if result.returncode:raise RuntimeError('disposable_docker_command_failed')
        return result.stdout.decode().strip()
    identity=json.loads(docker('inspect','dmb-agent-qualification'))[0]
    if identity['Id']!=args.postgres_container_id or identity['Name']!='/dmb-agent-qualification':
        raise RuntimeError('disposable_container_identity_mismatch')
    ports=identity['NetworkSettings']['Ports'].get('5432/tcp',[])
    if not any(item['HostPort']=='51600' for item in ports):
        raise RuntimeError('disposable_postgres_port_mismatch')
    plan=json.loads((prepared/'plan.json').read_text(encoding='utf-8'))
    child=runpy.run_path(str(root/'scripts/agent_recovery_cases.py'))['CHILD']
    services={'business-analyst':'.venv','business-analyst-experimental':'.venv-agent-v2',
      'meeting-analyzer':'.venv','value-priority-assessor':'.venv-prioritiser',
      'backlog-assistant':'agents/backlog-assistant/.venv'}
    report={'scope':'compatible_read_only_application_rollback','status':'NOT_RUN',
      'baseline_revision':plan['baseline_revision'],'model_calls':0,'protected_writes':0,
      'working_services_changed':False,'real_remote':'NOT_RUN',
      'driver_sha256':hashlib.sha256(child.encode()).hexdigest(),'services':[]}
    output.mkdir(parents=True)
    def save():
        temporary=output/'manifest.json.tmp'
        with temporary.open('w',encoding='utf-8') as stream:
            stream.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,output/'manifest.json')
    save()
    for service,venv in services.items():
        entry={'service':service,'status':'NOT_RUN','phases':[]};report['services'].append(entry);save()
        try:
            own=root/'agents'/service
            # Meeting had no standalone historical service: qualify the explicit bridge.
            baseline=own if service=='meeting-analyzer' else prepared/'baseline-src/agents'/service
            hashes={name:digest for name,digest in plan['baseline_files'].items()
                    if name.startswith('agents/'+service+'/')}
            if service!='meeting-analyzer':
                if not hashes or any(hashlib.sha256((prepared/'baseline-src'/name).read_bytes()).hexdigest()!=digest
                                     for name,digest in hashes.items()):
                    raise RuntimeError('frozen_recovery_source_changed')
            entry['reader_kind']='current_read_only_bridge' if service=='meeting-analyzer' else 'pinned_baseline_with_read_only_adapter'
            entry['baseline_files']=hashes
            adapter=own/service.replace('-','_')/'recovery.py'
            entry['adapter_sha256']=hashlib.sha256(adapter.read_bytes()).hexdigest()
            bundle=output/'artifacts'/service
            bundle.mkdir(parents=True)
            if service=='meeting-analyzer':
                inputs=[path for path in own.rglob('*') if path.is_file() and
                        path.suffix in {'.py','.json','.yaml','.yml','.txt','.j2','.toml'} and
                        not any(part in {'.venv','__pycache__','.git','node_modules'} for part in path.relative_to(own).parts)]
                for path in inputs:
                    target=bundle/path.relative_to(own);target.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copyfile(path,target)
            else:
                for name in hashes:
                    relative=Path(name).relative_to(Path('agents')/service)
                    target=bundle/relative;target.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copyfile(prepared/'baseline-src'/name,target)
            overlay=bundle/service.replace('-','_')/'recovery.py'
            overlay.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(adapter,overlay)
            if service=='backlog-assistant':
                shutil.copyfile(own/'backlog_assistant/config.py',bundle/'backlog_assistant/config.py')
            sdk=bundle/'sdk/dmb_agent_contracts';sdk.mkdir(parents=True)
            for path in (root/'packages/dmb-agent-contracts/dmb_agent_contracts').rglob('*'):
                if path.is_file() and path.suffix in {'.py','.json'}:
                    target=sdk/path.relative_to(root/'packages/dmb-agent-contracts/dmb_agent_contracts')
                    target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
            entry['artifact_files']={path.relative_to(bundle).as_posix():hashlib.sha256(path.read_bytes()).hexdigest()
                                     for path in bundle.rglob('*') if path.is_file()}
            adapter=overlay
            database='agent_recovery_'+uuid4().hex
            docker('exec',args.postgres_container_id,'psql','-U','postgres','-c','CREATE DATABASE '+database)
            entry['database']=database
            config={'service':service,'database_url':'postgresql+psycopg://postgres@127.0.0.1:51600/'+database,
              'record':str(output/(service+'-synthetic.json')),'adapter':str(adapter)}
            phases=(('write',baseline,'old'),('write',own,'new'),('read',bundle,None)) if args.two_releases and service!='meeting-analyzer' else (('write',own,None),('read',bundle,None))
            for action,source,generation in phases:
                if generation=='new':
                    dump=subprocess.run(['docker','exec',args.postgres_container_id,'pg_dump','-U','postgres','-d',database,'-Fc','--no-owner','--no-acl'],capture_output=True,timeout=120)
                    if dump.returncode or not dump.stdout:raise RuntimeError('recovery_backup_failed')
                    backup=output/(service+'-old-synthetic.dump');backup.write_bytes(dump.stdout)
                    restored='agent_recovery_restore_'+uuid4().hex
                    docker('exec',args.postgres_container_id,'psql','-U','postgres','-c','CREATE DATABASE '+restored)
                    restore=subprocess.run(['docker','exec','-i',args.postgres_container_id,'pg_restore','-U','postgres','-d',restored,'--no-owner','--no-acl','--exit-on-error'],input=dump.stdout,capture_output=True,timeout=120)
                    if restore.returncode:raise RuntimeError('recovery_backup_restore_failed')
                    def snapshot(db):
                        names=docker('exec',args.postgres_container_id,'psql','-U','postgres','-d',db,'-At','-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
                        values={}
                        for name in names:
                            if not re.fullmatch('[a-z_][a-z0-9_]*',name):raise RuntimeError('unexpected_table_name')
                            query="SELECT count(*),md5(COALESCE(string_agg(v,'' ORDER BY v),'')) FROM (SELECT row_to_json(t)::text AS v FROM \""+name+"\" t) x"
                            values[name]=docker('exec',args.postgres_container_id,'psql','-U','postgres','-d',db,'-At','-c',query)
                        if 'reference' in values and not values['reference'].startswith('0|'):raise RuntimeError('protected_reference_rows')
                        return values
                    old_snapshot=snapshot(database)
                    if snapshot(restored)!=old_snapshot:raise RuntimeError('restored_old_history_mismatch')
                    entry['verified_old_backup']={'sha256':hashlib.sha256(dump.stdout).hexdigest(),'restored_database':restored,'table_fingerprints':old_snapshot}
                    save()
                env={name:value for name,value in os.environ.items() if name.upper() in
                     {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'}}
                env.update(PYTHONPATH=os.pathsep.join((str(bundle/'sdk') if action=='read' else str(root/'packages/dmb-agent-contracts'),str(source))),
                  PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',OMP_NUM_THREADS='1',MKL_NUM_THREADS='1')
                result=subprocess.run([str(root/venv/'Scripts/python.exe'),'-X','utf8','-c',child],
                  input=json.dumps({**config,'action':action,'generation':generation,'backup_verified':generation=='new'}),cwd=output,env=env,
                  capture_output=True,text=True,encoding='utf-8',timeout=180)
                (output/(service+'-'+action+('-'+generation if generation else '')+'.log')).write_text(result.stderr,encoding='utf-8')
                if result.returncode:raise RuntimeError('recovery_'+action+'_child_failed')
                value=json.loads(result.stdout.strip().splitlines()[-1])
                if value['status']!='PASS':raise RuntimeError('recovery_child_not_passed')
                entry['phases'].append({**value,'writer_generation':generation});save()
            entry['status']='PASS'
        except Exception as error:
            entry.update(status='FAIL',reason=type(error).__name__+':'+str(error) if isinstance(error,RuntimeError) else type(error).__name__)
        save()
    report['status']='PASS' if all(row['status']=='PASS' for row in report['services']) else 'FAIL'
    save()
    print(json.dumps({'status':report['status'],'services':{row['service']:row['status'] for row in report['services']}}))
    return 0 if report['status']=='PASS' else 1


if __name__=='__main__':raise SystemExit(main())
