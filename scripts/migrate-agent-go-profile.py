"""Explicitly authorized local Go cutover. Credentials never enter argv/evidence."""
import ctypes
import argparse
import hashlib
import json
import math
import os
import re
import time
from ctypes import wintypes
from pathlib import Path


class Blob(ctypes.Structure):
    _fields_=[("size",wintypes.DWORD),("data",ctypes.POINTER(ctypes.c_char))]


def dpapi(raw, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("windows_dpapi_required")
    buffer=ctypes.create_string_buffer(raw)
    source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_char)))
    target=Blob()
    function=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):
        raise RuntimeError("configuration_backup_encryption_failed")
    try:
        return ctypes.string_at(target.data,target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


def reserve(evidence):
    from agent_live_budget import locked
    path=evidence/"model-budget.json"
    with locked(path):
        if path.exists():
            budget=json.loads(path.read_text(encoding="utf-8"))
        else:
            seconds=0
            for name in ["ba1-transport-live","ba2-transport-live","ba2-transport-live-diagnostic","value-transport-live","value-transport-live-diagnostic"]:
                item=json.loads((evidence/(name+".json")).read_text(encoding="utf-8-sig"))
                seconds+=math.ceil(item["elapsed_seconds"])
            meeting=json.loads((evidence/"meeting-live.json").read_text(encoding="utf-8-sig"))
            seconds+=meeting["max_seconds"]
            budget={"max_calls":40,"max_seconds":1200,"reserved_calls":18,"reserved_seconds":seconds,
                    "legacy_time_basis":"transport elapsed plus entire meeting max_seconds reservation"}
        if budget["reserved_calls"]+1>budget["max_calls"] or budget["reserved_seconds"]+45>budget["max_seconds"]:
            raise RuntimeError("live_budget_exhausted")
        budget["reserved_calls"]+=1
        budget["reserved_seconds"]+=45
        path.write_text(json.dumps(budget,indent=2)+"\n",encoding="utf-8")
        return budget


def backlog_profile(root, *, retry=False):
    """Separately authorized BKL cutover; no changes to other services."""
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4
    from agent_live_budget import LiveBudget
    from dmb_agent_contracts.settings import resolve_environment, profile_aliases
    from dmb_agent_contracts.config import validate_go_url
    from dmb_agent_contracts.go import GoModel
    from dmb_agent_contracts.model import ModelRequest, AgentError
    evidence = root/'.runtime/agent-services-evidence'
    output = evidence/'backlog-go-profile-cutover.json'
    backup = root/'.runtime/agent-services-backups/backlog-assistant-profile-before-go.dpapi'
    predecessor = None
    if output.exists() or backup.exists():
        if not retry or not output.is_file() or not backup.is_file():
            raise RuntimeError('cutover_evidence_exists_no_automatic_retry')
        previous_report = json.loads(output.read_text(encoding='utf-8'))
        if previous_report.get('status') != 'BLOCKED':
            raise RuntimeError('only_failed_cutover_may_be_retested')
        original = dpapi(backup.read_bytes(),decrypt=True)
        if (root/'agents/backlog-assistant/.env').read_bytes() != original:
            raise RuntimeError('cutover_retry_requires_restored_configuration')
        preserved = output.with_name('backlog-go-profile-cutover-attempt-'+str(uuid4())+'.json')
        preserved.write_bytes(output.read_bytes())
        predecessor = str(preserved.relative_to(root))
    source_path = root/'agents/business-analyst/.env'
    source_before = source_path.read_bytes()
    source,_ = resolve_environment('business-analyst',source_path)
    key,base,model = (source.get(name,'') for name in ('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'))
    if not key or not model:
        raise RuntimeError('v1_model_profile_incomplete')
    validate_go_url(base)
    path = root/'agents/backlog-assistant/.env'
    previous = path.read_bytes()
    current,_ = resolve_environment('backlog-assistant',path)
    changes = {'ASSISTANT_MODEL_KEY':key,'ASSISTANT_MODEL_URL':base,'ASSISTANT_MODEL':model}
    aliases = profile_aliases('backlog-assistant')
    lines = previous.decode('utf-8-sig').splitlines()
    for field,value in changes.items():
        if any(char in value for char in ('\n','\r',"'",'\\','\0')) or '${' in value:
            raise RuntimeError('unsupported_dotenv_model_value_format')
        names = aliases[field]
        lines = [line for line in lines if not (re.match(r'^\s*([A-Z][A-Z0-9_]*)\s*=',line)
            and re.match(r'^\s*([A-Z][A-Z0-9_]*)\s*=',line).group(1) in names)]
        lines.append(names[0]+"='"+value+"'")
    updated = ('\n'.join(lines)+'\n').encode('utf-8')
    encrypted = dpapi(previous)
    if dpapi(encrypted,decrypt=True) != previous:
        raise RuntimeError('configuration_backup_verification_failed')
    report = {'scope':'explicit_backlog_assistant_go_profile_cutover','status':'NOT_RUN',
        'real_remote':'NOT_RUN','model_calls_reserved':1,'authorization':'user_reply_call_4945cc453135472984339fe3b62e0792'}
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    if predecessor is not None:
        report['previous_attempt'] = predecessor
    report['source_config_sha256'] = hashlib.sha256(source_before).hexdigest()
    started = time.monotonic()
    try:
        with LiveBudget(evidence/'model-budget.json').request(45):
            transport = GoModel(base_url=base,api_key=key,model=model)
            try:
                result = transport.complete(ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose='extraction',
                    messages=[{'role':'user','content':'Synthetic Go qualification'}],
                    system_prompt='Return only JSON {"status":"ok"}.',output_schema={'type':'object'},
                    model_profile='authorized-backlog-go-profile',max_output_tokens=512,
                    deadline_at=datetime.now(timezone.utc)+timedelta(seconds=35)))
                if result.structured != {'status':'ok'}:
                    raise AgentError('synthetic_smoke_assertion_failed',502)
            finally:
                transport.client.close()
        report['smoke_verified'] = True
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        if source_path.read_bytes()!=source_before or path.read_bytes()!=previous:
            raise RuntimeError('configuration_changed_concurrently')
        backup.parent.mkdir(parents=True,exist_ok=True)
        if not backup.exists():
            with backup.open('xb') as file:
                file.write(encrypted)
        elif dpapi(backup.read_bytes(),decrypt=True) != previous:
            raise RuntimeError('configuration_backup_mismatch')
        try:
            path.write_bytes(updated)  # Retain the existing file's ACL.
            applied,_ = resolve_environment('backlog-assistant',path)
            if any(applied.get(name)!=value for name,value in changes.items()):
                raise RuntimeError('profile_cutover_verification_failed')
            selected_names = set(changes) | {name for field in changes for name in aliases[field]}
            if {k:v for k,v in applied.items() if k not in selected_names} != {k:v for k,v in current.items() if k not in selected_names}:
                raise RuntimeError('unrelated_configuration_changed')
        except BaseException:
            path.write_bytes(previous)
            raise
        report.update(status='PASS',model=model,origin='https://opencode.ai',
            rollback_backup=str(backup.relative_to(root)),prior_config_sha256=hashlib.sha256(previous).hexdigest(),
            config_sha256=hashlib.sha256(updated).hexdigest(),other_settings_unchanged=True)
    except Exception as error:
        report.update(status='BLOCKED',reason=getattr(error,'code',None) or 'profile_cutover_failed',error_type=type(error).__name__)
        import traceback
        report['frames'] = [{'file':Path(frame.filename).name,'line':frame.lineno} for frame in traceback.extract_tb(error.__traceback__)]
    finally:
        report['elapsed_seconds']=round(time.monotonic()-started,2)
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({name:report.get(name) for name in ('status','reason','model_calls_reserved')}))
    return 0 if report['status']=='PASS' else 1


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--service",required=True,choices=["value-priority-assessor","business-analyst-experimental","backlog-assistant"])
    parser.add_argument('--retry-cutover',action='store_true')
    args=parser.parse_args()
    service=args.service
    root=Path(__file__).resolve().parents[1]
    if service == 'backlog-assistant':
        return backlog_profile(root,retry=args.retry_cutover)
    evidence=root/".runtime/agent-services-evidence"
    output=evidence/("assessor-go-profile-cutover.json" if service=="value-priority-assessor" else "ba2-go-profile-cutover.json")
    if output.exists():
        raise RuntimeError("cutover_evidence_exists_no_automatic_retry")
    from dmb_agent_contracts.settings import resolve_environment,profile_aliases
    from dmb_agent_contracts.config import validate_go_url
    if service=="value-priority-assessor":
        from value_priority_assessor.config import Settings
        from value_priority_assessor.llm.openai_compat import OpenAICompatAdapter,close_http_client
    else:
        import business_analyst_experimental.config as config_module
        import business_analyst_experimental.llm.openai_compat as provider_module
        Settings=config_module.Settings
        close_http_client=lambda:None
    source,_=resolve_environment("business-analyst",root/"agents/business-analyst/.env")
    key,base,model=(source.get(name,"") for name in ("OPENAI_API_KEY","OPENAI_BASE_URL","OPENAI_MODEL"))
    if not key or not model:
        raise RuntimeError("v1_model_profile_incomplete")
    validate_go_url(base)
    current=Settings()
    if service=="value-priority-assessor":
        changes={"llm_provider":"openai_compat","openai_api_key":key,"openai_base_url":base,"openai_model":model,
                 "unit_test_mode":False,"execution_backend":"direct","model_provider":"opencode_go",
                 "model_protocol":"chat_completions","runtime_location":"none","runtime_contract_version":"1.17.13"}
        candidate=Settings(_env_file=None,**(current.model_dump()|changes))
        candidate.validate_service_runtime()
        database_field,secret_field="db_url","service_secret"
    else:
        changes={"LLM_PROVIDER":"openai_compat","OPENAI_API_KEY":key,"OPENAI_BASE_URL":base,"OPENAI_MODEL":model,
                 "UNIT_TEST_MODE":False,"EXECUTION_BACKEND":"direct","MODEL_PROVIDER":"opencode_go",
                 "MODEL_PROTOCOL":"chat_completions","RUNTIME_LOCATION":"none","RUNTIME_CONTRACT_VERSION":"1.17.13"}
        candidate=current.model_copy(update=changes)
        prior=config_module.settings
        try:
            config_module.settings=candidate
            config_module.validate_runtime_settings()
        finally:
            config_module.settings=prior
        database_field,secret_field="SESSION_DATABASE_URL","AGENT_SECRET"
    budget=reserve(evidence)
    report={"scope":"explicit_"+service+"_go_profile_cutover","status":"NOT_RUN","model_calls_reserved":1,
            "cumulative_calls_reserved":budget["reserved_calls"],"real_remote":"NOT_RUN"}
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    started=time.monotonic()
    try:
        if service=="value-priority-assessor":
            adapter=OpenAICompatAdapter(api_key=key,base_url=base,model=model,timeout=45,retry_attempts=1)
            text=adapter._complete('Return only JSON {"status":"ok"}. This is a short synthetic connectivity check.',
                                  "Synthetic Go qualification",max_tokens=512,schema={"type":"object"})
        else:
            from dmb_agent_contracts.model import AgentError
            import urllib.error
            prior_settings,prior_open=provider_module.settings,provider_module.open_http
            calls=[0]
            def once(request,timeout):
                if calls[0]: raise AgentError("live_probe_call_limit")
                calls[0]+=1
                try: return prior_open(request,timeout=min(timeout,45))
                except urllib.error.HTTPError as error:
                    raise AgentError("provider_auth_failed" if error.code in (401,403) else "provider_quota_exhausted" if error.code==429 else "provider_protocol_error") from None
                except (TimeoutError,urllib.error.URLError): raise AgentError("provider_unavailable") from None
            try:
                provider_module.settings=candidate
                provider_module.open_http=once
                text=provider_module.OpenAICompatProvider().chat_json([{"role":"user","content":"Synthetic Go qualification"}],
                    system_prompt='Return only JSON {"status":"ok"}.',max_tokens=512,timeout=45)
            finally:
                provider_module.settings=prior_settings
                provider_module.open_http=prior_open
        if json.loads(text)!={"status":"ok"}:
            raise RuntimeError("synthetic_smoke_assertion_failed")
        path=root/"agents"/service/".env"
        previous=path.read_bytes()
        encrypted=dpapi(previous)
        if dpapi(encrypted,decrypt=True)!=previous:
            raise RuntimeError("configuration_backup_verification_failed")
        backup=root/".runtime/agent-services-backups"/(service+"-profile-before-go.dpapi")
        if backup.exists():
            raise RuntimeError("configuration_backup_exists")
        backup.parent.mkdir(parents=True,exist_ok=True)
        with backup.open("xb") as file:
            file.write(encrypted)
        replacements=changes.copy()
        replacements.pop("unit_test_mode" if service=="value-priority-assessor" else "UNIT_TEST_MODE")
        aliases=profile_aliases(service)
        lines=previous.decode("utf-8-sig").splitlines()
        for field,value in replacements.items():
            if any(char in str(value) for char in ("\n","\r","'","\\","\0")) or "${" in str(value):
                raise RuntimeError("unsupported_dotenv_model_value_format")
            names=aliases[field]
            lines=[line for line in lines if not (re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=",line) and re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=",line).group(1) in names)]
            lines.append(names[0]+"='"+str(value)+"'")
        updated=("\n".join(lines)+"\n").encode("utf-8")
        if path.read_bytes()!=previous:
            raise RuntimeError("configuration_changed_concurrently")
        # Truncate the existing file to retain its Windows ACL; DPAPI backup is verified above.
        try:
            path.write_bytes(updated)
            applied=Settings()
            if service=="value-priority-assessor":
                applied.validate_service_runtime()
                assert applied.openai_api_key==key and applied.openai_base_url==base and applied.openai_model==model
            else:
                prior=config_module.settings
                try:
                    config_module.settings=applied
                    config_module.validate_runtime_settings()
                finally:
                    config_module.settings=prior
                assert applied.OPENAI_API_KEY==key and applied.OPENAI_BASE_URL==base and applied.OPENAI_MODEL==model
            assert getattr(applied,database_field)==getattr(current,database_field) and getattr(applied,secret_field)==getattr(current,secret_field)
        except BaseException:
            path.write_bytes(previous)
            raise
        report.update(status="PASS",model=model,origin="https://opencode.ai",rollback_backup=str(backup.relative_to(root)),
                      prior_config_sha256=hashlib.sha256(previous).hexdigest(),config_sha256=hashlib.sha256(updated).hexdigest(),
                      database_settings_unchanged=True)
    except Exception as error:
        report.update(status="BLOCKED",reason=getattr(error,"code",None) or "profile_cutover_failed")
    finally:
        close_http_client()
        report["elapsed_seconds"]=round(time.monotonic()-started,2)
        output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({name:report.get(name) for name in ("status","reason","model_calls_reserved","cumulative_calls_reserved")}))
    return 0 if report["status"]=="PASS" else 1


if __name__=="__main__":
    raise SystemExit(main())
