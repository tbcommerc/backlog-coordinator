"""Copy only public, pinned model cache from an offline artifact to workspace."""
import argparse
import subprocess
import tarfile
from pathlib import Path


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--target",required=True,type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    target=args.target.resolve()
    if not target.is_relative_to(root/".runtime") or target.exists():
        raise RuntimeError("new_workspace_cache_path_required")
    target.parent.mkdir(parents=True,exist_ok=True)
    archive=target.with_suffix(".tar")
    code="""
import tarfile,sys
from pathlib import Path
root=Path('/opt/huggingface')
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|',dereference=True) as output:
    for repository in root.glob('models--*'):
        for name in ('snapshots','refs'):
            path=repository/name
            if path.exists(): output.add(path,arcname=str(path.relative_to(root)))
"""
    with archive.open("xb") as output:
        completed=subprocess.run(["docker","run","--rm","--network","none","dmb-agent/value-priority-assessor:migration-20261103",
                                  "python","-c",code],stdout=output,stderr=subprocess.PIPE,timeout=900)
    if completed.returncode:
        raise RuntimeError("offline_encoder_cache_export_failed")
    target.mkdir()
    with tarfile.open(archive,"r:") as data:
        data.extractall(target,filter="data")
    archive.unlink()
    revision=target/"models--intfloat--multilingual-e5-base/snapshots/d13f1b27baf31030b7fd040960d60d909913633f"
    if not (revision/"modules.json").is_file():
        raise RuntimeError("pinned_encoder_cache_missing")
    print("Offline pinned encoder cache exported; no credentials, corpus or model API calls")


if __name__=="__main__":
    main()
