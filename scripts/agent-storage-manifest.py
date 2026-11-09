"""Read-only fingerprints of a verified agent schema, never raw history or DSNs."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import runpy
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,default=str,separators=(",",":")).encode()).hexdigest()


def main():
    root=Path(__file__).resolve().parents[1]
    doctor=runpy.run_path(str(Path(__file__).with_name("agent-doctor.py")))
    parser=argparse.ArgumentParser()
    parser.add_argument("--service",required=True,choices=doctor["PROFILES"])
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    output=args.output.resolve()
    if not output.is_relative_to(root/".runtime") or output.exists():
        raise RuntimeError("evidence_path_must_be_new_and_inside_runtime")
    report=doctor["diagnose"](args.service)
    if report["status"]!="ready":
        print(json.dumps(report))
        return 1
    module,database_field,_,_=doctor["PROFILES"][args.service]
    config=importlib.import_module(module)
    if args.service=="backlog-assistant":
        url=config.environment()[database_field]
    else:
        settings=config.settings if hasattr(config,"settings") else config.Settings()
        url=doctor["plain"](getattr(settings,database_field))
    if url.startswith("postgresql://"):
        url="postgresql+psycopg://"+url[len("postgresql://"):]
    from sqlalchemy import MetaData,Table,create_engine,select,func,text
    engine=create_engine(url,connect_args={"connect_timeout":3})
    tables={}
    try:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            from sqlalchemy import inspect
            inspector=inspect(connection)
            for name in sorted(inspector.get_table_names()):
                schema=inspector.get_columns(name)
                columns=[{"name":column["name"],"type":str(column["type"]),"nullable":column["nullable"]} for column in schema]
                table=Table(name,MetaData(),autoload_with=connection)
                count=connection.scalar(select(func.count()).select_from(table))
                item={"rows":count,"schema_sha256":digest(columns)}
                if name=="reference":
                    item["policy"]="protected_reference_count_only"
                else:
                    if count>50000: raise RuntimeError("history_fingerprint_row_budget_exceeded")
                    rows=connection.execute(select(table)).mappings().all()
                    primary=[column.name for column in table.primary_key.columns]
                    hashes={digest([row[key] for key in primary]):digest(dict(row)) for row in rows}
                    item.update(row_hashes=hashes,content_sha256=digest(hashes))
                tables[name]=item
    finally:
        engine.dispose()
    revision=subprocess.run(["git","rev-parse","HEAD"],cwd=root,capture_output=True,text=True,check=True).stdout.strip()
    env=root/"agents"/args.service/".env"
    report.update(timestamp=datetime.now(timezone.utc).isoformat(),git_revision=revision,
                  git_dirty=bool(subprocess.run(["git","status","--porcelain"],cwd=root,capture_output=True,text=True,check=True).stdout),
                  sdk_version=importlib.metadata.version("dmb-agent-contracts"),tables=tables,
                  own_config_sha256=hashlib.sha256(env.read_bytes()).hexdigest() if env.is_file() else None)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"service":args.service,"status":"PASS","model_calls":0,"database_writes":0,
                      "counts":{name:item["rows"] for name,item in tables.items()}}))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
