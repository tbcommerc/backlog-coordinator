"""Explicit one-call synthetic operator probe, charged to the migration ledger."""
import argparse
import importlib
import json
import runpy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4


def main():
    doctor=runpy.run_path(str(Path(__file__).with_name("agent-doctor.py")))
    parser=argparse.ArgumentParser()
    parser.add_argument("--service",required=True,choices=doctor["PROFILES"])
    parser.add_argument("--max-calls",required=True,type=int,choices=[1])
    parser.add_argument("--max-seconds",required=True,type=int)
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    if not 1 <= args.max_seconds <= 45:
        parser.error("max-seconds must be 1..45; the ledger reserves the full 45 seconds")
    root=Path(__file__).resolve().parents[1]
    output=args.output.resolve()
    if not output.is_relative_to(root/".runtime") or output.exists():
        raise RuntimeError("new_workspace_evidence_required")
    report=doctor["diagnose"](args.service)
    if report["status"]!="ready":
        print(json.dumps(report))
        return 1
    config=importlib.import_module(doctor["PROFILES"][args.service][0])
    if args.service=="backlog-assistant":
        settings=config.environment()
        key,base,model=(settings[name] for name in ("ASSISTANT_MODEL_KEY","ASSISTANT_MODEL_URL","ASSISTANT_MODEL"))
    else:
        settings=config.settings if hasattr(config,"settings") else config.Settings()
        names=(("OPENAI_API_KEY","OPENAI_BASE_URL","OPENAI_MODEL") if args.service.startswith("business-analyst") else
               ("model_api_key","model_base_url","model_name") if args.service=="meeting-analyzer" else
               ("openai_api_key","openai_base_url","openai_model"))
        key,base,model=(doctor["plain"](getattr(settings,name)) for name in names)
    from dmb_agent_contracts.go import GoModel
    from dmb_agent_contracts.model import AgentError,ModelRequest,Message
    output.parent.mkdir(parents=True,exist_ok=True)
    reservation=runpy.run_path(str(Path(__file__).with_name("migrate-agent-go-profile.py")))["reserve"]
    budget=reservation(root/".runtime/agent-services-evidence")
    report={"scope":"operator_transport_probe","service":args.service,"status":"NOT_RUN",
            "reserved_calls":1,"cumulative_calls_reserved":budget["reserved_calls"],
            "started_at":datetime.now(timezone.utc).isoformat(),"real_remote":"NOT_RUN"}
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    transport=None
    try:
        transport=GoModel(base_url=base,api_key=key,model=model)
        result=transport.complete(ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose="extraction",
            messages=[Message(role="user",content="Synthetic connectivity probe")],
            system_prompt='Return only JSON {"status":"ok"}.',output_schema={"type":"object"},
            model_profile="local-go-direct",max_output_tokens=512,
            deadline_at=datetime.now(timezone.utc)+timedelta(seconds=args.max_seconds)))
        if result.structured!={"status":"ok"}:
            raise AgentError("probe_assertion_failed",502)
        report.update(status="PASS",elapsed_ms=result.elapsed_ms,usage=result.usage.model_dump())
    except AgentError as error:
        report.update(status="BLOCKED",reason=error.code)
    except Exception:
        report.update(status="BLOCKED",reason="probe_failed")
    finally:
        if transport is not None:
            transport.client.close()
        report["finished_at"]=datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report))
    return 0 if report["status"]=="PASS" else 1


if __name__=="__main__":
    raise SystemExit(main())
