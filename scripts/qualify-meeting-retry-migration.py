"""Restore a verified synthetic v1 backup; qualify additive retry migration.

Only newly created technical databases in the exact qualification container are
used. No production DSN, protected records, drops or provider calls.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text
from meeting_analyzer.migrate import migrate, validate
from meeting_analyzer.store import Store, now


def command(arguments, *, data=None):
    result=subprocess.run(['docker',*arguments],input=data,capture_output=True,timeout=90)
    if result.returncode:
        raise RuntimeError('owned_retry_migration_command_failed')
    return result.stdout


def fingerprints(engine, *, ignore_retry=False):
    if set(inspect(engine).get_table_names())!={'meeting_runs','meeting_events'}:
        raise RuntimeError('synthetic_meeting_schema_required')
    output={}
    with engine.connect() as connection:
        for table in ['meeting_runs','meeting_events']:
            values=[]
            for raw in connection.execute(text('SELECT row_to_json(t)::text FROM '+table+' t')).scalars():
                value=json.loads(raw)
                if ignore_retry:
                    value.pop('retry_of',None)
                values.append(json.dumps(value,sort_keys=True,separators=(',',':')))
            output[table]={'rows':len(values),'sha256':hashlib.sha256('\n'.join(sorted(values)).encode()).hexdigest()}
    return output


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--postgres-container-id',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    output=args.output.resolve()
    if not output.is_relative_to(root/'.runtime') or output.exists():
        raise RuntimeError('new_workspace_evidence_required')
    identity=command(['inspect','--format','{{.Id}}','dmb-agent-qualification']).decode().strip()
    if identity!=args.postgres_container_id:
        raise RuntimeError('disposable_postgres_identity_mismatch')
    backup=root/'.runtime/agent-services-evidence/storage-20261104/meeting-analyzer-synthetic.dump'
    expected=json.loads(backup.with_name('manifest.json').read_text(encoding='utf-8'))
    expected=next(entry['sha256'] for entry in expected['services'] if entry['service']=='meeting-analyzer' and entry['status']=='PASS')
    raw=backup.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected:
        raise RuntimeError('verified_legacy_dump_changed')
    output.mkdir(parents=True)
    database='meeting_retry_upgrade_'+uuid4().hex
    command(['exec',identity,'createdb','-U','postgres',database])
    command(['exec','-i',identity,'pg_restore','-U','postgres','-d',database,'--no-owner','--no-acl','--exit-on-error'],data=raw)
    engine=create_engine('postgresql+psycopg://postgres@127.0.0.1:51600/'+database)
    report={'scope':'disposable_meeting_retry_migration','status':'NOT_RUN','model_calls':0,
        'protected_writes':0,'database':database,'legacy_backup_sha256':expected,'application_rollback':'NOT_TESTED'}
    try:
        before=fingerprints(engine,ignore_retry=True)
        assert 'retry_of' not in {column['name'] for column in inspect(engine).get_columns('meeting_runs')}
        try:
            migrate(engine)
        except RuntimeError as error:
            assert 'verified backup' in str(error)
        else:
            raise RuntimeError('migration_did_not_require_backup')
        assert fingerprints(engine,ignore_retry=True)==before
        migrate(engine,backup_verified=True)
        validate(engine)
        assert fingerprints(engine,ignore_retry=True)==before
        with engine.connect() as connection:
            original=json.loads(connection.scalar(text('SELECT row_to_json(t)::text FROM meeting_runs t LIMIT 1')))
        store=Store(engine)
        body={'input':original['input'],'source':original['source']}
        row,replayed=store.create(original['caller'],original['actor'],original['key'],body,original['profile'],300,100)
        assert replayed and row['id']==original['id'] and row['retry_of'] is None
        retry={**body,'retry_of':row['id']}
        linked,replayed=store.create(row['caller'],row['actor'],'synthetic-explicit-retry',retry,row['profile'],300,100)
        assert not replayed and linked['retry_of']==row['id']
        assert store.transition(linked,'cancelled',finished_at=now())
        late,replayed=store.create(row['caller'],row['actor'],'synthetic-explicit-retry',retry,row['profile'],300,100)
        assert replayed and late['id']==linked['id'] and late['status']=='cancelled'
        after=fingerprints(engine)
        upgraded=command(['exec',identity,'pg_dump','-U','postgres','-d',database,'-Fc','--no-owner','--no-acl'])
        (output/'upgraded-synthetic.dump').write_bytes(upgraded)
        restored='meeting_retry_roundtrip_'+uuid4().hex
        command(['exec',identity,'createdb','-U','postgres',restored])
        command(['exec','-i',identity,'pg_restore','-U','postgres','-d',restored,'--no-owner','--no-acl','--exit-on-error'],data=upgraded)
        restored_engine=create_engine('postgresql+psycopg://postgres@127.0.0.1:51600/'+restored)
        try:
            validate(restored_engine)
            assert fingerprints(restored_engine)==after
        finally:
            restored_engine.dispose()
        report.update(status='PASS',legacy_rows_preserved=True,old_key_replayed=True,
            retry_link_preserved=True,backup_required=True,new_history_restored=True,
            restored_database=restored,upgraded_backup_sha256=hashlib.sha256(upgraded).hexdigest(),fingerprints=after)
    finally:
        engine.dispose()
        (output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    main()
