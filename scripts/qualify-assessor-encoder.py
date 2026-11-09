"""Offline Windows/Linux CPU comparison on a frozen synthetic retrieval corpus."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from uuid import uuid4
from pathlib import Path

MODEL="intfloat/multilingual-e5-base"
REVISION="d13f1b27baf31030b7fd040960d60d909913633f"
DOCUMENTS=["passage: Еженедельный отчёт выгружается оператором в CSV по пятницам.",
           "passage: Система отправляет уведомление о просроченной оплате.",
           "passage: Новый сотрудник проходит обучение и получает инструкцию."]
QUERIES=["query: Как выгрузить еженедельный отчёт?","query: Оповещение о задержке платежа"]


def worker(cache):
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(2)
    model=SentenceTransformer(MODEL,revision=REVISION,cache_folder=cache,local_files_only=True,device="cpu")
    values=model.encode(DOCUMENTS+QUERIES,normalize_embeddings=True,show_progress_bar=False,batch_size=2)
    print(json.dumps({"vectors":values.tolist(),"torch":torch.__version__}),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--worker",action="store_true")
    parser.add_argument("--cache",required=True)
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    if args.worker:
        worker(args.cache)
        return 0
    root=Path(__file__).resolve().parents[1]
    output=args.output.resolve() if args.output else None
    cache=Path(args.cache).resolve()
    if output is None or not output.is_relative_to(root/".runtime") or output.exists() or not cache.is_relative_to(root/".runtime"):
        raise RuntimeError("new_workspace_evidence_and_cache_required")
    environment=os.environ.copy()
    environment.update(OMP_NUM_THREADS="2",MKL_NUM_THREADS="2",CUDA_VISIBLE_DEVICES="-1",HF_HUB_OFFLINE="1")
    # Keep the Windows process handle until its venv child tree has stopped:
    # the held handle prevents PID reuse while taskkill resolves this owned tree.
    native_command=[str(root/".venv-prioritiser/Scripts/python.exe"),str(Path(__file__).resolve()),
        "--worker","--cache",str(cache)]
    process=subprocess.Popen(native_command,cwd=root/"agents/value-priority-assessor",env=environment,
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8")
    try:
        stdout,stderr=process.communicate(timeout=900)
    except subprocess.TimeoutExpired:
        if process.poll() is None:
            if os.name=="nt":
                killed=subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"],capture_output=True,timeout=15)
                if killed.returncode and process.poll() is None:
                    process.kill()
                    raise RuntimeError("owned_native_encoder_cleanup_pending") from None
            else:
                process.kill()
        process.communicate(timeout=15)
        raise RuntimeError("native_offline_encoder_timeout") from None
    host=subprocess.CompletedProcess(native_command,process.returncode,stdout,stderr)
    if host.returncode:raise RuntimeError("native_offline_encoder_failed")
    image=subprocess.run(["docker","image","inspect","--format","{{.Id}}",
        "dmb-agent/value-priority-assessor:migration-20261103"],capture_output=True,text=True,check=True,timeout=30).stdout.strip()
    if not image.startswith("sha256:"):raise RuntimeError("qualified_image_identity_required")
    code=Path(__file__).read_text(encoding="utf-8")
    name="dmb-encoder-qualification-"+uuid4().hex[:12]
    try:
        container=subprocess.run(["docker","run","--name",name,"--label","dmb.encoder-qualification="+name,"--rm","-i","--network","none","--env","OMP_NUM_THREADS=2",
        "--env","MKL_NUM_THREADS=2","--env","HF_HUB_OFFLINE=1","--entrypoint","python",
        image,"-","--worker","--cache","/opt/huggingface"],
            input=code,capture_output=True,text=True,encoding="utf-8",timeout=900)
    except subprocess.TimeoutExpired:
        raise RuntimeError("container_offline_encoder_timeout") from None
    finally:
        inspected=subprocess.run(["docker","inspect","--format",'{{index .Config.Labels "dmb.encoder-qualification"}}',name],capture_output=True,text=True,timeout=15)
        if inspected.returncode==0 and inspected.stdout.strip()==name:
            removed=subprocess.run(["docker","rm","--force",name],capture_output=True,timeout=30)
            if removed.returncode:raise RuntimeError("owned_encoder_container_cleanup_pending")
    if container.returncode:raise RuntimeError("container_offline_encoder_failed")
    # Progress/warnings are stderr; vectors never appear in ordinary tool output.
    native=json.loads(host.stdout.strip().splitlines()[-1])
    linux=json.loads(container.stdout.strip().splitlines()[-1])
    first,second=native["vectors"],linux["vectors"]
    if len(first)!=5 or len(second)!=5 or any(len(v)!=len(first[0]) for v in first+second):
        raise RuntimeError("encoder_shape_mismatch")
    def scores(values):
        return [[sum(x*y for x,y in zip(query,document)) for document in values[:3]] for query in values[3:]]
    a,b=scores(first),scores(second)
    rankings_a=[sorted(range(3),key=lambda i:-row[i]) for row in a]
    rankings_b=[sorted(range(3),key=lambda i:-row[i]) for row in b]
    maximum=max(abs(x-y) for row_a,row_b in zip(a,b) for x,y in zip(row_a,row_b))
    expected=[0,1]
    passed=rankings_a==rankings_b and [row[0] for row in rankings_a]==expected and maximum<=1e-4
    report={"scope":"synthetic_offline_encoder_cpu_equivalence","status":"PASS" if passed else "FAIL",
        "model":MODEL,"revision":REVISION,"image_id":image,"model_calls":0,"protected_writes":0,
        "corpus_sha256":hashlib.sha256(json.dumps(DOCUMENTS+QUERIES,ensure_ascii=False).encode()).hexdigest(),
        "documents":3,"queries":2,"rankings_equal":rankings_a==rankings_b,
        "expected_top_matches":[row[0] for row in rankings_a]==expected,"max_cosine_delta":maximum,
        "tolerance":1e-4,"native_torch":native["torch"],"linux_torch":linux["torch"],
        "full_product_retrieval":"NOT_RUN"}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report))
    return int(not passed)


if __name__=="__main__":
    raise SystemExit(main())
