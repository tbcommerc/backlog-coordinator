"""Build and rehearse Backlog in isolated production-mode Compose + real HTTPS.

No bank data, working databases, agent processes or global certificate changes.
Secrets and the CA key live only in the ignored per-run directory. The JSON
report contains checks and image/source IDs, never authentication material.
"""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dmb-backlog/backend"))
from stand_smoke import _Client, run_smoke

ORIGIN = "https://127.0.0.1:8443"
LOGIN = "browser.demo"
PASSWORD = "Isolated browser demonstration 2026!"


def certificates(directory):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    directory.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Isolated Backlog rehearsal CA")])
    ca = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(root_key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(hours=1))
        .not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(root_key, hashes.SHA256()))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")]))
        .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(hours=1)).not_valid_after(now+timedelta(days=2))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1")), x509.DNSName("localhost")]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True).sign(root_key, hashes.SHA256()))
    (directory/"ca.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (directory/"server.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (directory/"server.key").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    spki = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.b64encode(hashlib.sha256(spki).digest()).decode()


def source_fingerprint():
    digest = hashlib.sha256()
    for directory in [ROOT/"dmb-backlog/backend", ROOT/"dmb-backlog/frontend"]:
        for path in sorted(directory.rglob("*")):
            if not path.is_file() or any(part in {"__pycache__", ".pytest_cache", "logs", "uploads", "node_modules", "graphify-out"}
                    or part.startswith((".env", ".test-", ".runtime")) for part in path.parts):
                continue
            if path.suffix in {".pyc", ".db", ".pem", ".key", ".pfx", ".p12"}:
                continue
            digest.update(path.relative_to(ROOT).as_posix().encode())
            digest.update(path.read_bytes())
    for name in ["dmb-backlog/Dockerfile", "compose.demo-core.yaml", "compose.production-core.yaml", "scripts/deploy-core.py", "infrastructure/nginx/dmb.container.conf",
                 "infrastructure/nginx/dmb.demo-tls.conf", "infrastructure/observability/otel-demo-core.yaml", "infrastructure/postgres/runtime-role-grants.sql"]:
        digest.update(name.encode()); digest.update((ROOT/name).read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-natural-expiry", action="store_true", help="Diagnostic run only; does not qualify natural expiry")
    parser.add_argument("--keep", action="store_true", help="Leave isolated services running for inspection")
    args = parser.parse_args()
    fingerprint = source_fingerprint()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    project = "codex-core-rehearsal-" + stamp
    work = ROOT/(".test-rehearsal-" + stamp)
    work.mkdir()
    spki = certificates(work/"tls")
    env = dict(os.environ)
    env.update(DMB_POSTGRES_PASSWORD=secrets.token_urlsafe(24), DMB_REDIS_PASSWORD=secrets.token_urlsafe(24),
        DMB_SECRET_KEY=secrets.token_urlsafe(40), DMB_AGENT_SECRET=secrets.token_urlsafe(40),
        DMB_AUTH_RATE_HMAC_KEY=secrets.token_urlsafe(40), DMB_BACKEND_IMAGE="dmb-backlog:rehearsal-"+fingerprint[:12],
        DMB_REHEARSAL_TLS_DIR=str(work/"tls"), PYTHONDONTWRITEBYTECODE="1")
    runtime_password = secrets.token_urlsafe(24)
    dba_url = "postgresql+psycopg://dmb:"+env["DMB_POSTGRES_PASSWORD"]+"@postgres:5432/codex_deploytest_rehearsal"
    env["DMB_DATABASE_URL"] = "postgresql+psycopg://dmb_runtime:"+runtime_password+"@postgres:5432/codex_deploytest_rehearsal"
    env["DMB_REDIS_URL"] = "redis://:"+env["DMB_REDIS_PASSWORD"]+"@redis:6379/0"
    env.update(DMB_POSTGRES_DB='codex_deploytest_rehearsal',DMB_VOLUME_PREFIX=project,
        DMB_AUTH_ORIGINS=json.dumps([ORIGIN]),DMB_CORS_ORIGINS=json.dumps([ORIGIN]),
        DMB_AUTH_ALLOWED_HOSTS=json.dumps(['127.0.0.1','localhost','backend']),DMB_HTTP_BIND='127.0.0.1:0')
    generated_keys = ("DMB_POSTGRES_PASSWORD", "DMB_REDIS_PASSWORD", "DMB_SECRET_KEY", "DMB_AGENT_SECRET",
        "DMB_AUTH_RATE_HMAC_KEY", "DMB_BACKEND_IMAGE", "DMB_REHEARSAL_TLS_DIR", "DMB_DATABASE_URL", "DMB_REDIS_URL",
        "DMB_POSTGRES_DB", "DMB_VOLUME_PREFIX", "DMB_AUTH_ORIGINS", "DMB_CORS_ORIGINS", "DMB_AUTH_ALLOWED_HOSTS", "DMB_HTTP_BIND")
    (work/"runtime-env.json").write_text(json.dumps({key: env[key] for key in generated_keys}), encoding="utf-8")
    override = work/'rehearsal.compose.json'
    override.write_text(json.dumps({'services':{
        'postgres':{'profiles':['dba-test-only'],
            'image':'postgres:16-alpine@sha256:075f7ba66bc9b3ce7d6b8b635208ff61cd7cf1a67d71ec530eec5d7ae0cbe571',
            'environment':{'POSTGRES_DB':'codex_deploytest_rehearsal','POSTGRES_USER':'dmb','POSTGRES_PASSWORD':env['DMB_POSTGRES_PASSWORD']},
            'volumes':['postgres-data:/var/lib/postgresql/data'],
            'healthcheck':{'test':['CMD-SHELL','pg_isready -h 127.0.0.1 -U dmb -d codex_deploytest_rehearsal'],'interval':'2s','timeout':'3s','retries':60},'networks':['data']},
        'migration':{'profiles':['dba-test-only'],'image':env['DMB_BACKEND_IMAGE'],
            'environment':{'DATABASE_URL':dba_url,'RUN_STARTUP_SEED':'false'},
            'command':['python','-m','alembic','upgrade','head'],'networks':['data']},
        'backend':{'build':{'context':str(ROOT),'dockerfile':'dmb-backlog/Dockerfile'}},
        'nginx':{'ports':['127.0.0.1:8443:8443'],'volumes':[
            str(ROOT/'infrastructure/nginx/dmb.demo-tls.conf')+':/etc/nginx/conf.d/tls.conf:ro',
            str(work/'tls')+':/etc/nginx/rehearsal-tls:ro']}},
        'volumes':{'postgres-data':{'name':project+'-postgres'}}}),encoding='utf-8')
    compose_files=[str(ROOT/'compose.production-core.yaml'),str(override)]
    compose = ["docker", "compose", "-p", project]
    for name in compose_files:
        compose += ['-f',name]
    (work/'compose.env').write_text('# Values supplied by the isolated parent process\n',encoding='utf-8')
    report = {"result": "running", "source_sha256": fingerprint, "image_tag": env["DMB_BACKEND_IMAGE"], "project": project, "compose_files":compose_files,"checks": []}
    def note(message):
        print(message, flush=True)
    def command(label, arguments, *, private=False, input=None, timeout=900):
        process = subprocess.run(arguments, cwd=ROOT, env=env, input=input, capture_output=True, timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if not private:
            (work/(label+".txt")).write_bytes(process.stdout+process.stderr)
        if process.returncode:
            raise RuntimeError(label+" failed with exit "+str(process.returncode)+"; inspect local run diagnostics")
        return process.stdout
    def dc(label, *arguments, **kwargs):
        return command(label, compose+list(arguments), **kwargs)
    def fixture(operation):
        result = dc("fixture-"+operation, "run", "--rm", "--no-deps", "-T", "-e", "DMB_ISOLATED_REHEARSAL=1",
            "backend", "python", "-m", "deployment_tests.rehearsal_fixture", operation, private=True)
        return json.loads(result.decode().strip().splitlines()[-1])
    def check(name, detail=None):
        report["checks"].append({"name": name, "result": "passed", **({"detail": detail} if detail is not None else {})})
        note("PASS: "+name)
        (work/"report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    context = ssl.create_default_context(cafile=str(work/"tls/ca.pem"))
    def wait_ready():
        deadline = time.monotonic()+180
        with _Client(ORIGIN, context) as client:
            while time.monotonic() < deadline:
                try:
                    response = client.get("/api/v1/health/ready")
                    if response.status_code == 200:
                        return response.json()
                except OSError:
                    pass
                time.sleep(2)
        raise RuntimeError("HTTPS readiness did not become healthy")
    try:
        note("Building immutable backend image from the current source; no agents")
        dc("compose-config", "config", "--quiet")
        dc("build", "build", "backend", timeout=1800)
        image = command("image-inspect", ["docker", "image", "inspect", env["DMB_BACKEND_IMAGE"], "--format", "{{.Id}}"])
        report["image_id"] = image.decode().strip()
        command("pip-check", ["docker", "run", "--rm", env["DMB_BACKEND_IMAGE"], "python", "-m", "pip", "check"])
        check("production image built")
        note("Preparing a separate database as the DBA; bank application will have DML-only credentials")
        deploy_command=[sys.executable,str(ROOT/'scripts/deploy-core.py'),'--env-file',str(work/'compose.env'),
            '--report-dir',str(work/'operator-reports'),'--project-name',project,'--compose-override',str(override)]
        dc('dba-postgres','up','-d','--wait','postgres',timeout=300)
        dc('dba-runtime-role','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1',
            private=True,input=("CREATE ROLE dmb_runtime LOGIN PASSWORD '"+runtime_password+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; GRANT USAGE ON SCHEMA public TO dmb_runtime;").encode())
        failed=subprocess.run(deploy_command,cwd=ROOT,env=env,capture_output=True,timeout=300)
        (work/'operator-unprepared.txt').write_bytes(failed.stdout+failed.stderr)
        assert failed.returncode != 0
        assert b'DBA preparation required: migration_required' in failed.stdout
        assert not dc('no-backend-before-schema','ps','-q','backend').strip()
        empty=dc('empty-db-check','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-Atc',
            "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
        assert empty.strip()==b'0'
        check('unprepared database is rejected without creating tables or starting backend')
        dc('dba-source-db','exec','-T','postgres','createdb','-U','dmb','codex_deploytest_schema_source')
        dc('dba-source-schema','run','--rm','--no-deps','-T','-e','DATABASE_URL='+dba_url.replace('/codex_deploytest_rehearsal','/codex_deploytest_schema_source'),'migration')
        schema=dc('dba-schema-export','exec','-T','postgres','pg_dump','-U','dmb','-d','codex_deploytest_schema_source','--schema-only','--no-owner','--no-privileges')
        revision=dc('dba-revision','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_schema_source','-Atc','SELECT version_num FROM alembic_version').decode().strip()
        assert re.fullmatch(r'[A-Za-z0-9_]{1,32}',revision)
        schema += ("\nINSERT INTO public.alembic_version(version_num) VALUES ('"+revision+"');\n").encode()
        (work/'initial-schema.sql').write_bytes(b'-- DBA ONLY. Existing empty database; application must never execute this file.\n'+schema)
        dc('dba-apply-initial-sql','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1','-1',input=schema)
        grants=(ROOT/'infrastructure/postgres/runtime-role-grants.sql').read_bytes()
        dc('dba-runtime-grants','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1','-v','app_role=dmb_runtime',input=grants)
        check('DBA initial SQL was applied separately to an empty database with a restricted runtime role')
        probe="""from database import engine
from sqlalchemy.exc import DBAPIError
for sql in ['CREATE TABLE public.dmb_forbidden_ddl(id integer)','ALTER TABLE tasks ADD COLUMN dmb_forbidden integer','DROP TABLE tasks CASCADE']:
 with engine.connect() as c:
  try:
   c.exec_driver_sql(sql)
  except DBAPIError as e:
   assert getattr(e.orig,'sqlstate',None)=='42501'
  else:
   raise RuntimeError('Runtime DDL unexpectedly succeeded')
  finally:
   c.rollback()
print('CREATE ALTER DROP denied')
"""
        dc('runtime-ddl-denied','run','--rm','--no-deps','-T','backend','python','-c',probe)
        check('PostgreSQL denies CREATE ALTER and DROP to the application role')
        command('operator-first-deploy',deploy_command,timeout=1800)
        check('bank deployment starts the real profile on a DBA-prepared schema without running migrations')
        ready = wait_ready()
        assert ready["checks"]["agent"] == "not_required" and ready["checks"]["prioritiser"] == "disabled"
        check("HTTPS readiness with DEBUG=false", ready["checks"])
        activation = fixture("bootstrap")
        with _Client(ORIGIN, context) as client:
            response = client.request("POST", "/api/v1/auth/password/setup", payload={"token": activation.pop("activation_token"), "new_password": PASSWORD})
            assert response.status_code == 204, "Activation failed"
        activation.clear()
        check("first administrator activated over verified HTTPS")
        smoke = run_smoke(ORIGIN, LOGIN, PASSWORD, ca_file=str(work/"tls/ca.pem"), expect_admin=True)
        check("production HTTPS cookie/login/refresh smoke", smoke["reference_counts"])
        note("Waiting for the real attachment scanner to finish loading its signature database")
        scanner_deadline = time.monotonic()+300
        while True:
            try:
                dc("scanner-ping", "exec", "-T", "backend", "python", "-c",
                    "import socket; s=socket.create_connection(('clamav',3310),3); s.sendall(b'zPING\\0'); assert b'PONG' in s.recv(128); s.close()", private=True, timeout=45)
                break
            except (RuntimeError, subprocess.TimeoutExpired):
                if time.monotonic() >= scanner_deadline:
                    raise RuntimeError("Attachment scanner did not become ready")
                time.sleep(5)
        check("real ClamAV ready for attachment acceptance")
        env.update(DMB_DEMO_BROWSER_TEST="1", DMB_DEMO_BASE_URL=ORIGIN, DMB_DEMO_TLS_SPKI=spki, DMB_CHECK_ATTACHMENTS="1")
        command("browser", ["node", str(ROOT/"dmb-backlog/node_modules/@playwright/test/cli.js"), "test",
            "--config="+str(ROOT/"dmb-backlog/playwright.deployment.config.mjs")], timeout=360)
        check("real browser creates/edits a task, checks attachments, renews concurrent reads and opens related core registers")
        with _Client(ORIGIN, context) as client:
            response = client.request("POST", "/api/v1/auth/login", payload={"login": "browser.observer", "password": "Isolated observer demonstration 2026!"})
            assert response.status_code == 200
            client.headers["Authorization"] = "Bearer "+response.json()["access_token"]
            assert client.get("/api/v1/admin/roles").status_code == 403
            assert client.get("/api/v1/tasks/reference").status_code == 200
            redirect = client.get("/api/v1/timeline?year=2026")
            assert redirect.status_code == 307
            assert redirect.headers.get("Location") == ORIGIN+"/api/v1/timeline/?year=2026", "TLS ingress lost external scheme/host/port"
            assert client.get("/api/v1/timeline/?year=2026").status_code == 200
            assert client.request("POST", "/api/v1/tasks/", payload={"team_id": 1, "title": "Forbidden write", "date_received": "2026-11-23", "channel_id": 1, "task_type_id": 1}).status_code == 403
            client.post("/api/v1/auth/logout")
        check("observer cannot administer or create tasks")
        check("API redirect preserves HTTPS origin through both proxies")
        if not args.skip_natural_expiry:
            with _Client(ORIGIN, context) as client:
                token = client.request("POST", "/api/v1/auth/login", payload={"login": LOGIN, "password": PASSWORD}).json()
                client.headers["Authorization"] = "Bearer "+token["access_token"]
                for cycle in (1, 2):
                    seconds = token["expires_in"]+2
                    note(f"Waiting {seconds}s for natural access expiry, cycle {cycle}/2")
                    time.sleep(seconds)
                    assert client.get("/api/v1/auth/me").status_code == 401
                    refreshed = client.post("/api/v1/auth/refresh")
                    assert refreshed.status_code == 200
                    token = refreshed.json()
                    client.headers["Authorization"] = "Bearer "+token["access_token"]
                    assert client.get("/api/v1/auth/me").status_code == 200
                    assert client.get("/api/v1/tasks/reference").status_code == 200
                    check(f"natural access expiry and refresh cycle {cycle}")
                client.post("/api/v1/auth/logout")
        else:
            report["natural_expiry"] = "not_checked"
        before = fixture("inventory")
        dc("restart", "restart", "postgres", "redis", "backend", timeout=180)
        wait_ready()
        assert fixture("inventory") == before
        run_smoke(ORIGIN, LOGIN, PASSWORD, ca_file=str(work/"tls/ca.pem"), expect_admin=True)
        check("restart preserves users, dictionaries and tasks")
        legacy = fixture("legacy")
        dc("stop-for-upgrade", "stop", "backend", "nginx")
        dc("old-schema", "run", "--rm", "--no-deps", "-T", "migration", "python", "-m", "alembic", "downgrade", "d251c98e30f7")
        upgrade_sql=dc('dba-export-upgrade','run','--rm','--no-deps','-T','migration','python','-m','schema_sql',
            '--from-revision','d251c98e30f7','--output','-')
        (work/'upgrade-from-d251c98e30f7.sql').write_bytes(upgrade_sql)
        small_upgrade=dc('dba-export-last-upgrade','run','--rm','--no-deps','-T','migration','python','-m','schema_sql',
            '--from-revision','d352a19c40e8','--output','-')
        (work/'upgrade-from-d352a19c40e8.sql').write_bytes(small_upgrade)
        dc('dba-apply-upgrade','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1',input=upgrade_sql)
        dc('dba-renew-grants','exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1','-v','app_role=dmb_runtime',input=grants)
        assert fixture("reconcile")["unbound"] == 0
        inventory = fixture("inventory")
        assert fixture("reconcile")["added"] == 0
        assert fixture("inventory") == inventory
        invalid_repeat=subprocess.run(compose+['exec','-T','postgres','psql','-U','dmb','-d','codex_deploytest_rehearsal','-v','ON_ERROR_STOP=1'],
            cwd=ROOT,env=env,input=upgrade_sql,capture_output=True,timeout=60)
        assert invalid_repeat.returncode != 0
        assert fixture('inventory') == inventory
        check('DBA upgrade SQL rejects an unexpected revision without changing existing records')
        dc("restart-after-upgrade", "up", "-d", "--scale", "backend=2")
        wait_ready()
        with _Client(ORIGIN, context) as client:
            token = client.request("POST", "/api/v1/auth/login", payload={"login": LOGIN, "password": PASSWORD}).json()
            client.headers["Authorization"] = "Bearer "+token["access_token"]
            task = client.get("/api/v1/tasks/"+str(legacy["task_id"]))
            assert task.status_code == 200 and task.json()["priority_id"] == legacy["priority_id"]
            client.post("/api/v1/auth/logout")
        check("populated old schema upgrade preserves differing dictionary/FK IDs")
        dump = dc("backup", "exec", "-T", "postgres", "pg_dump", "-Fc", "-U", "dmb", "codex_deploytest_rehearsal", private=True)
        dc("create-restore-db", "exec", "-T", "postgres", "createdb", "-U", "dmb", "codex_deploytest_restored")
        dc("restore", "exec", "-T", "postgres", "pg_restore", "-U", "dmb", "-d", "codex_deploytest_restored", private=True, input=dump)
        dump = None
        env["DMB_DATABASE_URL"] = env["DMB_DATABASE_URL"].replace("/codex_deploytest_rehearsal", "/codex_deploytest_restored")
        (work/'runtime-env.json').write_text(json.dumps({key:env[key] for key in generated_keys}),encoding='utf-8')
        dc("use-restored-db", "up", "-d", "--force-recreate", "--scale", "backend=2", "backend", "nginx", timeout=300)
        wait_ready()
        assert fixture("inventory") == inventory
        run_smoke(ORIGIN, LOGIN, PASSWORD, ca_file=str(work/"tls/ca.pem"), expect_admin=True)
        check("backup restored into a different DB and application login verified")
        report["result"] = "passed" if not args.skip_natural_expiry else "diagnostic_passed"
    except Exception as exc:
        report["result"] = "failed"
        report["error"] = type(exc).__name__+": "+str(exc) if isinstance(exc, (AssertionError, RuntimeError)) else type(exc).__name__
        note("FAIL: "+report["error"])
        try:
            logs = dc("failure-logs", "logs", "--no-color", "--tail", "200", "backend", private=True).decode(errors="replace")
            # Only the controlled HTTP timing message, never traceback parameters.
            lines = [line for line in logs.splitlines() if re.search(r'\b(?:GET|POST|PUT|DELETE|PATCH) /\S* - Status: \d+ - Duration:', line)]
            (work/"request-timings.txt").write_text("\n".join(lines), encoding="utf-8")
        except Exception:
            pass
    finally:
        # Project names are generated here and never accepted as user input.
        if not args.keep:
            try:
                assert project.startswith("codex-core-rehearsal-")
                dc("cleanup", "--profile", "dba-test-only", "down", "--volumes", "--remove-orphans", timeout=180)
            except Exception:
                report["cleanup"] = "manual_cleanup_required_for_"+project
        (work/"report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        note("Report: "+str(work/"report.json"))
    return 0 if report["result"] in {"passed", "diagnostic_passed"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
