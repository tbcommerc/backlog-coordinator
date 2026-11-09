"""Opt-in build and offline import/filesystem qualification, without credentials."""
import argparse
import json
import subprocess
import sys
import tarfile
import time
from pathlib import Path
from uuid import uuid4

SERVICES = {
    "business-analyst": ("Dockerfile", "business_analyst.main"),
    "business-analyst-experimental": ("Dockerfile", "business_analyst_experimental.main"),
    "meeting-analyzer": ("Dockerfile", "meeting_analyzer.api"),
    "value-priority-assessor": ("Dockerfile", "value_priority_assessor.config"),
    "backlog-assistant": ("deploy/service.Dockerfile", "backlog_assistant.bootstrap"),
}


def clean_context(root, target, dockerfile):
    listing = subprocess.run(["git", "-c", "core.quotepath=false", "ls-files", "-z", "-co", "--exclude-standard"],
                             cwd=root, capture_output=True, check=True).stdout.decode("utf-8").split("\0")
    count = 0
    with tarfile.open(target, "w:gz", format=tarfile.GNU_FORMAT) as archive:
        archive.add(root/dockerfile, arcname="Dockerfile", recursive=False)
        for name in sorted(set(listing)):
            if not name or not (name.startswith("agents/") or name.startswith("packages/dmb-agent-contracts/") or name == ".dockerignore"):
                continue
            path = Path(name)
            if any(part.startswith(".venv") or part in {".runtime", ".pytest_cache", "__pycache__", "node_modules", "graphify-out", "var", "build", "dist"} or part.endswith(".egg-info") for part in path.parts):
                continue
            if path.name == ".env" or (path.name.startswith(".env.") and not path.name.endswith(".example")) or path.suffix in {".db", ".sqlite", ".sqlite3", ".log", ".pem", ".key", ".pfx", ".p12", ".age"}:
                continue
            if "/data/knowledge/k3/" in "/"+name or "/RAG/package/" in "/"+name:
                continue
            if (root/path).is_file():
                archive.add(root/path, arcname=name, recursive=False)
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", action="append", choices=SERVICES)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {"scope": "build_offline_import_filesystem", "real_remote": "NOT_RUN", "model_calls": 0, "services": []}
    failed = False
    for service in args.service or SERVICES:
        dockerfile, module = SERVICES[service]
        image = "dmb-agent/"+service+":migration-20261103"
        entry = {"service": service, "image": image, "build": "NOT_RUN", "offline_import_fs": "NOT_RUN"}
        report["services"].append(entry)
        sentinel = "SYNTHETIC_ARTIFACT_SENTINEL_"+uuid4().hex
        sentinel_path = root/"agents"/service/".env.migration-artifact-sentinel"
        if sentinel_path.exists():
            raise RuntimeError("Sentinel path already exists; refusing replacement")
        sentinel_path.write_text(sentinel, encoding="utf-8")
        context_path = args.output.parent/(service+".context.tar")
        try:
            entry["context_files"] = clean_context(root, context_path, "agents/"+service+"/"+dockerfile)
            log_path = args.output.parent/(service+".build.log")
            with log_path.open("w", encoding="utf-8") as log, context_path.open("rb") as context:
                result = subprocess.run(["docker", "build", "--progress=plain", "-t", image, "-"], cwd=root, stdin=context, stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout)
            entry["build"] = "PASS" if result.returncode == 0 else "FAIL"
            if result.returncode:
                failed = True
                continue
            code = f'''
import importlib,importlib.metadata,json
from pathlib import Path
assert importlib.metadata.version('dmb-agent-contracts')=='1.4.1'
from dmb_agent_contracts.go import GoModel
from dmb_agent_contracts.remote_configuration import RemoteProfile
from dmb_agent_contracts.run_worker import Worker
import jsonschema,httpx
importlib.import_module({module!r})
bad=[]
leaked=[]
for path in Path('/app').rglob('*'):
    if not path.is_file(): continue
    if path.name=='.env' or (path.name.startswith('.env.') and not path.name.endswith('.example')) or path.name=='pyvenv.cfg' or path.suffix in ('.db','.sqlite','.sqlite3','.log') or 'graphify-out' in path.parts or '/data/knowledge/k3/' in str(path) or path.suffix in ('.age','.pem','.key','.pfx','.p12'):
        bad.append(str(path))
    if {sentinel.encode()!r} in path.read_bytes(): leaked.append(str(path))
assert not bad, 'forbidden artifact paths: '+str(bad)
assert not leaked, 'sentinel leaked'
print(json.dumps({{'sdk_version':'1.4.1','forbidden_paths_count':len(bad),'sentinel_count':len(leaked)}}))
'''
            result = subprocess.run(["docker", "run", "--rm", "--network", "none", image, "python", "-c", code],
                                    cwd=root, capture_output=True, text=True, timeout=90)
            entry["offline_import_fs"] = "PASS" if result.returncode == 0 else "FAIL"
            if result.returncode:
                failed = True
                (args.output.parent/(service+".smoke.log")).write_text(result.stdout+result.stderr, encoding="utf-8")
            else:
                entry["checks"] = json.loads(result.stdout.strip().splitlines()[-1])
            inspected = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image],
                                       capture_output=True, text=True, timeout=15)
            if inspected.returncode == 0:
                entry["image_id"] = inspected.stdout.strip()
        except subprocess.TimeoutExpired:
            failed = True
            entry["error"] = "bounded_docker_timeout"
        finally:
            pending=[]
            for disposable in (sentinel_path,context_path):
                for attempt in range(10):
                    try:
                        disposable.unlink(missing_ok=True)
                        break
                    except OSError:
                        if attempt==9: pending.append(disposable.name)
                        else: time.sleep(.2)
            if pending:
                entry["temporary_cleanup"]="pending"
                entry["temporary_files"]=pending
            args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
            print(json.dumps(entry), flush=True)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
