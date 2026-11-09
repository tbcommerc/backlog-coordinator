"""Bounded dump/restore drill of already verified disposable technical databases.

Never accepts a production DSN, restores application reference data or drops a
database. Source lifecycle evidence supplies the exact technical table allowlist.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from uuid import uuid4

CONTAINER = "dmb-agent-qualification"
CONTAINER_ID = "35cb9090e1eef1e274c7b520a7e7628a6fa5f42b9d1a038730fb54154470fed7"
TABLES = {
    "business-analyst": {"sessions", "message_receipts", "agent_runs", "agent_run_events"},
    "business-analyst-experimental": {"sessions", "message_receipts", "agent_runs", "agent_run_events"},
    "meeting-analyzer": {"meeting_runs", "meeting_events"},
    "value-priority-assessor": {"agent_request","agent_tool_grants","agent_tool_receipts","alembic_version",
        "attribution_run","factor_assessment","llm_call","priority_history","reference","task", "agent_runs", "agent_run_events"},
    "backlog-assistant": {"backlog_assistant_sessions", "backlog_assistant_runs",
        "backlog_assistant_purge_outbox", "backlog_assistant_nonces", "backlog_assistant_idempotency", "backlog_assistant_feedback",
        "backlog_assistant_migrations", "agent_runs", "agent_run_events"},
}


def command(arguments, *, data=None, timeout=90):
    result = subprocess.run(["docker", *arguments], input=data, capture_output=True, timeout=timeout)
    if result.returncode:
        # Database diagnostics can contain historical row values; never print them.
        raise RuntimeError("disposable_storage_command_failed")
    return result.stdout


def sql(database, query):
    return command(["exec", CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                    "-d", database, "-At", "-c", query]).decode().strip()


def fingerprint(database, allowed):
    names=set(sql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines())
    optional = {"agent_runtime_bindings", "agent_runtime_migrations"}
    if names not in (allowed, allowed | optional):
        raise RuntimeError("disposable_schema_allowlist_mismatch")
    if "reference" in names and sql(database, "SELECT count(*) FROM reference")!="0":
        raise RuntimeError("protected_reference_rows_forbid_restore_drill")
    values={}
    for name in sorted(names):
        # Names come exclusively from the fixed technical allowlist above.
        query=f'SELECT count(*), md5(COALESCE(string_agg(v, \'\' ORDER BY v), \'\')) FROM (SELECT row_to_json(t)::text AS v FROM "{name}" t) x'
        values[name]=sql(database, query)
    return values


def main():
    global CONTAINER
    parser=argparse.ArgumentParser()
    parser.add_argument("--sources", "--lifecycle", dest="lifecycle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--postgres-container-id", required=True)
    args=parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{64}", args.postgres_container_id):
        parser.error("Exact disposable PostgreSQL container ID required")
    root=Path(__file__).resolve().parents[1]
    source=args.lifecycle.resolve()
    output=args.output.resolve()
    if not source.is_relative_to(root/".runtime") or not output.is_relative_to(root/".runtime") or output.exists():
        raise RuntimeError("new_workspace_evidence_required")
    identity=command(["inspect", "--format", "{{.Id}}", CONTAINER]).decode().strip()
    if identity != args.postgres_container_id:
        raise RuntimeError("disposable_container_identity_mismatch")
    CONTAINER = identity
    lifecycle=json.loads(source.read_text(encoding="utf-8-sig"))
    report={"scope":"disposable_dump_restore", "model_calls":0,"protected_writes":0,"services":[]}
    output.parent.mkdir(parents=True,exist_ok=True)
    for service in lifecycle["services"]:
        name=service["service"]
        if name not in TABLES or service["status"] != "PASS":
            continue
        database=service.get("database","")
        if not re.fullmatch(name.replace("-","_")+r"_lifecycle_[a-f0-9]{8}",database):
            raise RuntimeError("disposable_database_scope_mismatch")
        entry={"service":name,"status":"NOT_RUN"}
        report["services"].append(entry)
        try:
            before=fingerprint(database,TABLES[name])
            dump=command(["exec",CONTAINER,"pg_dump","-U","postgres","-d",database,
                          "-Fc","--no-owner","--no-acl"],timeout=120)
            # Only synthetic technical rows, no credentials or protected records.
            backup=output.parent/(name+"-synthetic.dump")
            with backup.open("xb") as file:
                file.write(dump)
            restored="agent_restore_"+uuid4().hex
            sql("postgres",f"CREATE DATABASE {restored}")
            command(["exec","-i",CONTAINER,"pg_restore","-U","postgres","-d",restored,
                     "--no-owner","--no-acl","--exit-on-error"],data=dump,timeout=120)
            after=fingerprint(restored,TABLES[name])
            if before != after or fingerprint(database,TABLES[name]) != before:
                raise RuntimeError("restored_history_fingerprint_mismatch")
            entry.update(status="PASS",sha256=hashlib.sha256(dump).hexdigest(),
                         restored_database=restored,table_count=len(before),source_unchanged=True)
        except (RuntimeError,subprocess.TimeoutExpired) as error:
            entry.update(status="FAIL",reason=str(error) if isinstance(error,RuntimeError) else "storage_timeout")
        finally:
            output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
            print(json.dumps(entry),flush=True)
    return int(len(report["services"])!=len(TABLES) or any(e["status"]!="PASS" for e in report["services"]))


if __name__=="__main__":
    raise SystemExit(main())
