"""Core deployment onto an existing DBA-prepared DB; no DDL or migrations.

No seed/account changes. Keep the env file and reports in restricted operator
storage. The external trusted ingress terminates HTTPS.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]


def validate_config(config):
    services = config['services']
    core = {'redis','backend','nginx','clamav','otel-collector'}
    if not core.issubset(services) or set(services)-core-{'postgres','migration'}:
        raise RuntimeError('Unexpected services in core deployment')
    for helper in set(services)-core:
        if 'dba-test-only' not in services[helper].get('profiles',[]):
            raise RuntimeError('Database preparation helpers are not part of the bank profile')
    if 'migration' in services['backend'].get('depends_on',{}):
        raise RuntimeError('Backend must not trigger a database migration')
    env = services['backend']['environment']
    for key in ['DEBUG','RUN_STARTUP_SEED','RUN_STARTUP_MAINTENANCE','RUN_NOTIFICATION_SCHEDULER',
                'AGENT_READINESS_REQUIRED','PRIORITISER_ENABLED','AGENT_V2_ENABLED','BACKLOG_ASSISTANT_ENABLED']:
        if str(env.get(key)).lower() != 'false':
            raise RuntimeError('Unsafe core deployment setting: '+key)
    if str(env.get('DATABASE_REQUIRE_RESTRICTED_ROLE')).lower() != 'true':
        raise RuntimeError('Bank profile requires a restricted runtime database role')
    origins = json.loads(env['AUTH_ORIGINS'])
    if not origins or set(origins) != set(json.loads(env['CORS_ORIGINS'])):
        raise RuntimeError('AUTH_ORIGINS and CORS_ORIGINS must describe the same HTTPS origins')
    hosts = json.loads(env['AUTH_ALLOWED_HOSTS'])
    for origin in origins:
        url = urlsplit(origin)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment or url.hostname not in hosts:
            raise RuntimeError('Invalid external HTTPS origin or missing allowed host')
    db = urlsplit(env['DATABASE_URL'])
    if db.scheme != 'postgresql+psycopg' or not db.hostname or not db.path.lstrip('/'):
        raise RuntimeError('An existing DBA-prepared PostgreSQL database is required')
    redis = urlsplit(env['REDIS_URL'])
    if redis.scheme != 'redis' or redis.hostname != 'redis' or redis.port not in (None,6379) or unquote(redis.password or '') != services['redis']['environment']['REDIS_PASSWORD']:
        raise RuntimeError('Redis URL must match the managed Redis service')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',type=Path,required=True)
    parser.add_argument('--report-dir',type=Path,required=True)
    parser.add_argument('--project-name',default='dmb-platform-production')
    parser.add_argument('--compose-file',type=Path,default=ROOT/'compose.production-core.yaml')
    parser.add_argument('--compose-override',type=Path,action='append',default=[])
    parser.add_argument('--wait-timeout',type=int,default=600)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,45}',args.project_name):
        parser.error('Invalid Compose project name')
    compose = ['docker','compose','--env-file',str(args.env_file.resolve(strict=True)),
               '-p',args.project_name,'-f',str(args.compose_file.resolve(strict=True))]
    for override in args.compose_override:
        compose += ['-f',str(override.resolve(strict=True))]
    work = args.report_dir.resolve()/('release-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(3))
    work.mkdir(parents=True,mode=0o700)
    report = {'result':'running','project':args.project_name,'checks':[],'writers_stopped':False,'database_schema_action':'validate_only'}
    lock_id = None
    stop_attempted = False

    def run(label,command,*,output=None,input=None,timeout=300,accepted=(0,)):
        # DDL diagnostics may contain private parameters. Never echo raw Docker
        # output; save failures only in the operator-controlled release folder.
        if output:
            with output.open('xb') as stream:
                os.chmod(output,0o600)
                process = subprocess.run(command,cwd=ROOT,stdout=stream,stderr=subprocess.PIPE,stdin=input,timeout=timeout)
        else:
            process = subprocess.run(command,cwd=ROOT,capture_output=True,stdin=input,timeout=timeout)
        if process.returncode:
            diagnostic = work/(label+'-error.txt')
            diagnostic.write_bytes(process.stderr)
            os.chmod(diagnostic,0o600)
            if process.returncode not in accepted:
                raise RuntimeError(label+' failed; inspect operator diagnostics in the release directory')
        return process.stdout if not output else None

    def dc(label,*command,**kwargs):
        return run(label,compose+list(command),**kwargs)

    def check(label):
        report['checks'].append(label)
        (work/'deployment-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('PASS: '+label,flush=True)

    try:
        # Read all profile definitions for ownership checks, without enabling
        # them in subsequent startup commands. DBA helpers exist only in tests.
        config = json.loads(dc('config','--profile','*','config','--format','json'))
        validate_config(config)
        services = config['services']
        image = json.loads(run('image',['docker','image','inspect',services['backend']['image']]))[0]
        if image['Os'] != 'linux' or image['Config']['User'] != 'dmb':
            raise RuntimeError('Expected the Linux release image with runtime user dmb')
        report['image_id'] = image['Id']
        # This never-started container is an exclusive lock on the Docker
        # daemon, shared across checkouts. A stale lock is resolved manually.
        lock_id = run('deployment-lock',['docker','create','--name','dmb-deploy-lock-'+args.project_name,
            '--label','dmb.release.project='+args.project_name,'--entrypoint','python',image['Id'],'--version']).decode().strip()
        for name in ['redis-data','attachments','clamav-data']:
            volume = config['volumes'][name]['name']
            for container_id in run('volume-owners',['docker','ps','-aq','--filter','volume='+volume]).decode().split():
                owner = run('volume-owner',['docker','inspect',container_id,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).decode().strip()
                if owner != args.project_name:
                    raise RuntimeError('A target volume belongs to another Docker project; do not start another database on it')
        actual = run('existing-services',['docker','ps','-a','--filter','label=com.docker.compose.project='+args.project_name,
            '--format','{{.Label "com.docker.compose.service"}}']).decode().split()
        if set(actual)-set(services):
            raise RuntimeError('Existing project has services outside core; quiesce/migrate that topology explicitly')
        frozen = work/'release-image.compose.json'
        frozen.write_text(json.dumps({'services':{'backend':{'image':image['Id']}}}),encoding='utf-8')
        compose.extend(['-f',str(frozen)])
        dc('runtime-config','run','--rm','--no-deps','-T','backend','python','-c','from config import validate_runtime_settings; validate_runtime_settings()')
        check('configuration and immutable image validated')
        raw_status = dc('schema-check','run','--rm','--no-deps','-T','backend','python','-m','schema_guard',accepted=(0,1))
        try:
            status = json.loads(raw_status)
        except (ValueError,TypeError):
            raise RuntimeError('Cannot inspect the existing database; check network, TLS and runtime credentials') from None
        if status['status'] != 'ok' or status.get('runtime_role') != 'restricted':
            raise RuntimeError('DBA preparation required: '+status['status']+'; expected revision '+','.join(status.get('expected',[])))
        report['schema'] = status
        check('existing schema and DML-only runtime role verified without DDL')
        dc('data-services','up','-d','--wait','--wait-timeout',str(args.wait_timeout),'redis',timeout=args.wait_timeout+60)
        stop_attempted = True
        report['writers_stopped'] = True
        dc('stop-writers','stop','nginx','backend')
        check('application writers stopped for the release')
        dc('infrastructure','up','-d','clamav','otel-collector')
        dc('application','up','-d','--no-deps','--wait','--wait-timeout',str(args.wait_timeout),'backend',timeout=args.wait_timeout+60)
        scanner = """import socket,time
deadline=time.monotonic()+LIMIT
while True:
 try:
  with socket.create_connection(('clamav',3310),5) as s:
   s.settimeout(5); s.sendall(b'zPING\\0'); assert b'PONG' in s.recv(128)
  break
 except (OSError,AssertionError):
  if time.monotonic()>=deadline: raise SystemExit(1)
  time.sleep(2)
""".replace('LIMIT',str(args.wait_timeout))
        dc('scanner-ready','exec','-T','backend','python','-c',scanner,timeout=args.wait_timeout+60)
        check('attachment scanner ready before publishing ingress')
        dc('ingress','up','-d','--no-deps','--wait','--wait-timeout',str(args.wait_timeout),'nginx',timeout=args.wait_timeout+60)
        health = json.loads(dc('ready','exec','-T','backend','python','-c',
            "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/ready',timeout=15).read().decode())"))
        if health.get('status') != 'ready' or health['checks'].get('schema') != 'ok':
            raise RuntimeError('Application is not ready')
        report['writers_stopped'] = False
        report['readiness'] = health
        check('application ready on the DBA-prepared database')
        report['result'] = 'passed'
    except Exception as exc:
        report['result'] = 'failed'
        report['error'] = str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
        if stop_attempted:
            try:
                dc('stop-after-failure','stop','nginx','backend')
            except Exception:
                report['stop_cleanup_required'] = True
        print('FAIL: '+report['error'],flush=True)
    finally:
        if lock_id:
            try:
                run('release-lock',['docker','rm',lock_id])
            except Exception:
                report['lock_cleanup_required'] = True
        (work/'deployment-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('Release evidence: '+str(work),flush=True)
    return 0 if report['result']=='passed' else 1


if __name__ == '__main__':
    sys.exit(main())
