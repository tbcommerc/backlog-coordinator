"""Safe reproducibility metadata for migration qualification artifacts."""
import hashlib
import importlib.metadata
import subprocess
from datetime import datetime,timezone
from pathlib import Path


def evidence_header(test_id,scope,corpus_id):
    import dmb_agent_contracts
    package=Path(dmb_agent_contracts.__file__).resolve().parent
    digest=hashlib.sha256()
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.suffix in (".py",".json"):
            digest.update(path.relative_to(package).as_posix().encode()+b"\0"+path.read_bytes())
    root=Path(__file__).resolve().parents[1]
    try:
        revision=subprocess.run(["git","rev-parse","HEAD"],cwd=root,capture_output=True,text=True,timeout=5)
        git_revision = revision.stdout.strip() if revision.returncode == 0 else None
        revision_status = "available" if git_revision else "unavailable"
    except (subprocess.TimeoutExpired, OSError):
        git_revision, revision_status = None, "unavailable"
    return {"test_id":test_id,"scope":scope,"corpus_id":corpus_id,
        "timestamp_utc":datetime.now(timezone.utc).isoformat(),"git_revision":git_revision,"git_revision_status":revision_status,
        "sdk_version":importlib.metadata.version("dmb-agent-contracts"),"sdk_files_sha256":digest.hexdigest(),
        "sdk_origin":"workspace_source" if package==root/"packages/dmb-agent-contracts/dmb_agent_contracts" else "installed_wheel",
        "execution_profile":"synthetic","real_remote":"NOT_RUN"}
