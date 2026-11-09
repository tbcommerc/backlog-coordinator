"""Isolated baseline/candidate replay of the frozen live product selection.

Prepare never calls a model. Execute preserves the existing finite ledger and
refuses an insufficient lower-bound budget before creating databases or calls.
The natural-language product assertions require review of actual outputs; this
runner never upgrades them to PASS merely because a provider returned JSON.
"""
import argparse
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import io
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import zipfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'ce713019e097edde267c3e909e685c061e16a57e'
ENVIRONMENTS = {'business-analyst':'.venv', 'business-analyst-experimental':'.venv-agent-v2',
    'meeting-analyzer':'.venv', 'value-priority-assessor':'.venv-prioritiser',
    'backlog-assistant':'agents/backlog-assistant/.venv'}


def write_evidence(path, value):
    """Keep the last complete journal if the controller is interrupted."""
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,
                prefix=path.name+'.',suffix='.tmp',delete=False) as stream:
            temporary=Path(stream.name)
            json.dump(value,stream,ensure_ascii=False,indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def command(arguments, **options):
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, timeout=60, **options)
    if result.returncode:
        raise RuntimeError('replay_preparation_command_failed')
    return result.stdout


def load_corpus():
    checker = runpy.run_path(str(ROOT/'scripts/check-agent-corpus.py'))
    return checker['check'](ROOT/'docs/dev-testing/agent-services/corpus/v1')


def allowed_source(path):
    if path.is_absolute() or '..' in path.parts or path.name.startswith('.env'):
        return False
    if any(part in {'.env','.venv','venv','node_modules','docs','var','agent_logs','build',
                   '__pycache__','archive','graphify-out','k3'} for part in path.parts):
        return False
    return (path.suffix in {'.py','.json','.js','.mjs','.yaml','.yml','.toml'} or
        path.as_posix() == 'agents/backlog-assistant/runtime/system.txt' or
        path.suffix == '.md' and 'prompts' in path.parts)


def prepare(output):
    output.mkdir(parents=True, exist_ok=False)
    manifest, cases = load_corpus()
    folders = ['agents/'+service for service in ENVIRONMENTS if service != 'meeting-analyzer']
    archive = command(['git','archive','--format=zip',BASELINE,*folders])
    exported = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for entry in source.infolist():
            path = Path(entry.filename)
            if entry.is_dir() or not allowed_source(path):
                continue
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError('baseline_symlink_refused')
            content = source.read(entry)
            target = output/'baseline-src'/path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            exported[path.as_posix()] = hashlib.sha256(content).hexdigest()
    candidate = {}
    listing = command(['git','ls-files','-z','-co','--exclude-standard']).decode('utf-8').split('\0')
    for name in sorted(set(listing)):
        path = Path(name)
        if not any(name.startswith('agents/'+service+'/') for service in ENVIRONMENTS) or not allowed_source(path):
            continue
        original = ROOT/path
        if original.is_symlink():
            raise RuntimeError('candidate_symlink_refused')
        if not original.is_file():
            continue
        content = original.read_bytes()
        target = output/'candidate-src'/path
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(content)
        candidate[path.as_posix()] = hashlib.sha256(content).hexdigest()
    plan = {'scope':'frozen_live_product_selection', 'baseline_revision':BASELINE,
        'corpus_id':manifest['corpus_id'], 'corpus_version':manifest['version'],
        'baseline_files':exported, 'candidate_files':candidate, 'model_calls':0, 'protected_writes':0, 'real_remote':'NOT_RUN',
        'baseline_docker_ownership_infrastructure':'current_trusted_launcher',
        'infrastructure_sources':{'agents/backlog-assistant/runtime/docker.py':hashlib.sha256(
            (ROOT/'agents/backlog-assistant/runtime/docker.py').read_bytes()).hexdigest()},
        'execution_sources':{name:hashlib.sha256((ROOT/'scripts'/name).read_bytes()).hexdigest()
            for name in ['replay-agent-products.py','agent_product_cases.py','agent_live_transport.py','agent_live_budget.py']},
        'driver_sha256':hashlib.sha256((ROOT/'scripts/agent_product_cases.py').read_bytes()).hexdigest(),
        'cases':[{'phase':phase, 'case_id':case['case_id'], 'service':case['service'],
            'assertions':{a['assertion_id']:'NOT_RUN' for a in case['expected']['assertions']}}
            for phase in ['baseline','candidate'] for case in cases if case['live_selection']]}
    (output/'plan.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
    return plan


def profile(service):
    from dotenv import dotenv_values
    from dmb_agent_contracts.settings import select_alias
    from dmb_agent_contracts.config import validate_go_url
    mappings = json.loads((ROOT/'packages/dmb-agent-contracts/dmb_agent_contracts/profiles.json').read_text())
    file_values = dotenv_values(ROOT/'agents'/service/'.env')
    values = {**file_values, **os.environ}
    fields = {'business-analyst':('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'),
        'business-analyst-experimental':('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'),
        'meeting-analyzer':('model_api_key','model_base_url','model_name'),
        'value-priority-assessor':('openai_api_key','openai_base_url','openai_model'),
        'backlog-assistant':('ASSISTANT_MODEL_KEY','ASSISTANT_MODEL_URL','ASSISTANT_MODEL')}
    selected = []
    for field in fields[service]:
        names = mappings[service][field]
        # A process override takes precedence over service-file aliases.
        value = select_alias(os.environ,names) or select_alias(values,names)
        if value is None or not value[1]:
            raise RuntimeError('replay_own_profile_missing')
        selected.append(value[1])
    key, base_url, model = selected
    return key, validate_go_url(base_url), model, values.get('ASSISTANT_RUNTIME_IMAGE',''), file_values


def worker():
    # This private entry runs in a fresh service-specific Python process.
    config = json.loads(sys.stdin.read())
    key = os.environ.pop('PRODUCT_REPLAY_KEY')
    config['key'] = key
    from agent_live_transport import InferenceBudget
    from agent_product_cases import DRIVERS, serial
    guard = InferenceBudget(config['ledger'], [config['base_url']+'/chat/completions'],
        maximum_seconds=100 if config['case']['service']=='backlog-assistant' else 650)
    blocked_attempts = []
    if config.get('dry_run'):
        def refuse_network(body):
            blocked_attempts.append(True)
            raise RuntimeError('synthetic_driver_network_disabled')
        guard.reserve = refuse_network
    result = {'case_id':config['case']['case_id'], 'phase':config['phase'], 'logical_run_id':config['run_id'],
        'status':'NOT_RUN', 'assertions':{a['assertion_id']:'NOT_RUN'
            for a in config['case']['expected']['assertions']}}
    # Product debug logs are intentionally not exported; only the synthetic
    # product output and allowlisted transport metadata leave the worker.
    try:
        from dmb_agent_contracts.entry import prepare_runtime
        from dmb_agent_contracts.operation import operation_scope
        from datetime import datetime,timedelta,timezone
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), guard.installed():
            result['limiter'] = prepare_runtime()
            with operation_scope(run_id=config['run_id'],deadline_at=datetime.now(timezone.utc)+timedelta(seconds=620)) as context:
                cleanup = context.hold_slot_for_cleanup() if config['case']['service']=='backlog-assistant' else None
                result['output'] = DRIVERS[config['case']['service']](config['case'], config)
                if cleanup is not None:
                    context.confirm_cleanup(cleanup)
        result['status'] = ('FAIL' if config['case']['service']=='backlog-assistant' and
            result['output'].get('product_status') not in {'completed','partial'} else 'REVIEW_REQUIRED')
        if result['status']=='FAIL':
            result['error_type']='ProductTerminalFailure'
    except BaseException as error:
        result.update(status='FAIL', error_type=type(error).__name__)
        if str(error) in {'live_budget_exhausted','live_budget_lock_unavailable'}:
            result['error_code']=str(error)
            if not guard.attempts:
                result.update(status='NOT_RUN',attempted=False,reason=str(error))
        import traceback
        result['frames'] = [{'file':Path(frame.filename).name,'line':frame.lineno}
            for frame in traceback.extract_tb(error.__traceback__)]
    from agent_evidence import evidence_header
    result['runtime_metadata'] = evidence_header(config['case']['case_id'], 'synthetic_product_replay', 'agent-services-synthetic/1.0.0')
    result['attempts'] = guard.attempts
    if config.get('dry_run'):
        result.update(scope='driver_failure_path_only', blocked_inference_attempts=len(blocked_attempts),
            status='BOUNDARY_REACHED' if blocked_attempts else 'FAIL', product_assertions='NOT_RUN')
    from fastapi.encoders import jsonable_encoder
    secrets = {key, *(value for name,value in os.environ.items() if len(value)>=8 and
        any(marker in name.upper() for marker in ('API_KEY','MODEL_KEY','PASSWORD','TOKEN','SECRET')))}
    def redact(value):
        if isinstance(value,str):
            for secret in secrets:
                value=value.replace(secret,'[redacted]')
            return value
        if isinstance(value,dict):
            return {name:redact(item) for name,item in value.items()}
        if isinstance(value,list):
            return [redact(item) for item in value]
        return value
    encoded = json.dumps(redact(jsonable_encoder(result)),ensure_ascii=False)
    print(encoded,flush=True)



def cleanup_owned_runtime(directory, image):
    directory = directory.resolve()
    if not directory.is_relative_to(ROOT/'.runtime') or not re.fullmatch(r'sha256:[a-f0-9]{64}',image):
        raise RuntimeError('replay_runtime_cleanup_scope_invalid')
    controller = hashlib.sha256(str(directory).encode('utf-8')).hexdigest()
    arguments = ['docker','container','ls','--all','--no-trunc','--format','{{.ID}}',
        '--filter','label=dmb.agent.controller='+controller]
    for identity in command(arguments).decode().split():
        if not re.fullmatch(r'[a-f0-9]{64}',identity):
            raise RuntimeError('replay_runtime_cleanup_unconfirmed')
        record = json.loads(command(['docker','inspect',identity]))[0]
        labels = record.get('Config',{}).get('Labels') or {}
        execution = labels.get('dmb.agent.execution','')
        prefix = ('/backlog-runtime-' if labels.get('dmb.agent.runtime')=='backlog-assistant' else
            '/backlog-resolver-' if labels.get('dmb.agent.resolver')=='backlog-assistant' else None)
        if (record.get('Id') != identity or record.get('Image') != image or
            labels.get('dmb.agent.controller') != controller or
            prefix is None or
            not re.fullmatch(r'[a-f0-9-]{36}',execution) or
            record.get('Name') != prefix+execution):
            raise RuntimeError('replay_runtime_ownership_mismatch')
        command(['docker','rm','--force',identity])
    if command(arguments).strip():
        raise RuntimeError('replay_runtime_cleanup_unconfirmed')


def execute(prepared, output, ledger, postgres_id, *, dry_run=False, continue_from=None, services=None, case_ids=None):
    from agent_live_budget import LiveBudget, locked
    plan = json.loads((prepared/'plan.json').read_text())
    def verify_helpers():
        if not plan.get('execution_sources'):
            raise RuntimeError('fresh_replay_preparation_required')
        for name,digest in plan['execution_sources'].items():
            if hashlib.sha256((ROOT/'scripts'/name).read_bytes()).hexdigest()!=digest:
                raise RuntimeError('replay_execution_source_changed')
        for name,digest in plan.get('infrastructure_sources',{}).items():
            if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
                raise RuntimeError('replay_infrastructure_changed')
    verify_helpers()
    canonical_count=len(plan['cases'])
    for name,digest in plan.get('infrastructure_sources',{}).items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
            raise RuntimeError('replay_infrastructure_changed')
    if plan['baseline_revision'] != BASELINE or plan['driver_sha256'] != hashlib.sha256(
            (ROOT/'scripts/agent_product_cases.py').read_bytes()).hexdigest():
        raise RuntimeError('replay_preparation_changed')
    for phase in ['baseline','candidate']:
        for name, digest in plan[phase+'_files'].items():
            if hashlib.sha256((prepared/(phase+'-src')/name).read_bytes()).hexdigest() != digest:
                raise RuntimeError('product_export_changed')
    if dry_run and not case_ids:
        plan['cases'] = [case for case in plan['cases'] if case['case_id'].endswith('-01') or
            case['service'] == 'business-analyst-experimental' and case['case_id'].endswith('-03')]
    predecessor = None
    if continue_from is not None:
        expected = {(case['phase'],case['case_id']) for case in plan['cases']}
        seen, visited, current = set(), set(), continue_from
        while current is not None:
            current = current.resolve()
            if not current.is_relative_to(ROOT/'.runtime') or current in visited:
                raise RuntimeError('replay_continuation_path_invalid')
            visited.add(current)
            previous = json.loads(current.read_text(encoding='utf-8'))
            all_rows = [(case['phase'],case['case_id']) for case in previous['cases']]
            own = [(case['phase'],case['case_id']) for case in previous['cases'] if case.get('attempted',True)]
            if (previous['baseline_revision'] != BASELINE or len(set(all_rows)) != len(all_rows)
                or not set(all_rows) <= expected or set(own) & seen or previous['type'] != 'live_go'
                or previous['execution_sources']['agent_product_cases.py'] != plan['driver_sha256']):
                raise RuntimeError('replay_continuation_mismatch')
            seen.update(own)
            parent = previous.get('continuation_from')
            current = Path(parent['manifest']) if parent else None
            if current is not None and hashlib.sha256(current.read_bytes()).hexdigest() != parent['sha256']:
                raise RuntimeError('replay_predecessor_changed')
        # Every prior failure and unknown outcome remains immutable. Only never
        # dispatched cases continue; no automatic repeat or budget refund.
        predecessor = {'manifest':str(continue_from),
            'sha256':hashlib.sha256(continue_from.read_bytes()).hexdigest(), 'preserved_cases':len(seen)}
        plan['cases'] = [case for case in plan['cases'] if (case['phase'],case['case_id']) not in set(seen)]
    if services:
        plan['cases'] = [case for case in plan['cases'] if case['service'] in services]
    if case_ids:
        if not set(case_ids)<={case['case_id'] for case in plan['cases']}:
            raise RuntimeError('replay_case_selection_invalid')
        plan['cases']=[case for case in plan['cases'] if case['case_id'] in case_ids]
    with locked(ledger):
        budget = LiveBudget(ledger)._read()
        if not dry_run and budget.get('active_reservations'):
            raise RuntimeError('live_qualification_already_active')
    if not re.fullmatch('[a-f0-9]{64}',postgres_id):
        raise RuntimeError('exact_disposable_postgres_required')
    info = json.loads(command(['docker','inspect','dmb-agent-qualification']))[0]
    if info['Id'] != postgres_id:
        raise RuntimeError('disposable_postgres_identity_mismatch')
    output.mkdir(parents=True,exist_ok=False)
    _, cases = load_corpus()
    indexed = {case['case_id']:case for case in cases}
    report = {'scope':plan['scope'], 'type':'driver_no_network' if dry_run else 'live_go', 'baseline_revision':BASELINE, 'real_remote':'NOT_RUN',
        'canonical_logical_cases':canonical_count,'selected_logical_cases':len(plan['cases']),
        'selection':{'services':services,'case_ids':case_ids},
        'infrastructure_sources':plan.get('infrastructure_sources',{}),
        'protected_writes':0, 'cases':[], 'budget_start':{name:budget[name] for name in
            ('max_calls','max_seconds','reserved_calls','reserved_seconds')}}
    if predecessor is not None:
        report['continuation_from'] = predecessor
    profiles = {service:profile(service) for service in ENVIRONMENTS}
    namespace = 'product-replay-'+hashlib.sha256(str(output).encode()).hexdigest()[:16]
    state_dir = ROOT/'.runtime/agent-limiter'/namespace
    report['execution_sources'] = dict(plan['execution_sources'])
    def pending(planned, reason):
        return {**planned,'status':'NOT_RUN','attempted':False,'reason':reason,'attempts':[],
            'assertions':{a['assertion_id']:'NOT_RUN' for a in indexed[planned['case_id']]['expected']['assertions']}}
    report['cases']=[pending(planned,'not_started') for planned in plan['cases']]
    def persist():
        with locked(ledger):
            observed_budget=LiveBudget(ledger)._read()
        report['budget_current']={name:observed_budget[name] for name in
            ('max_calls','max_seconds','reserved_calls','reserved_seconds')}
        report['model_calls']=observed_budget['reserved_calls']-budget['reserved_calls']
        write_evidence(output/'manifest.json',report)
    def stop_pending(start, reason):
        report['stop_reason']=reason
        for index in range(start,len(plan['cases'])):
            report['cases'][index]=pending(plan['cases'][index],reason)
        persist()
    persist()
    for case_index,planned in enumerate(plan['cases']):
        verify_helpers()
        service, phase = planned['service'], planned['phase']
        if not dry_run:
            with locked(ledger):
                available=LiveBudget(ledger)._read()
            reservation=100 if service=='backlog-assistant' else 650
            if (available['reserved_calls']>=available['max_calls'] or
                    available['max_seconds']-available['reserved_seconds']<reservation):
                stop_pending(case_index,'live_budget_exhausted')
                return report
        case = indexed[planned['case_id']]
        own_output = output/phase/case['case_id']
        own_output.mkdir(parents=True)
        key, base_url, model, image, own_environment = profiles[service]
        database = service.replace('-','_')+'_product_replay_'+uuid4().hex
        command(['docker','exec',postgres_id,'createdb','-U','postgres',database])
        url = 'postgresql+psycopg://postgres@127.0.0.1:51600/'+database
        env = {k:v for k,v in os.environ.items() if k.upper() in {
            'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA'}}
        source = prepared/(phase+'-src')
        roots = [source/'agents'/service]
        if service == 'meeting-analyzer' and phase == 'baseline':
            roots = [source/'agents/business-analyst']
        env.update({name:value for name,value in own_environment.items() if value is not None})
        env.update(PYTHONPATH=os.pathsep.join(map(str,roots)),PYTHONUTF8='1',
            PYTHONDONTWRITEBYTECODE='1',PRODUCT_REPLAY_KEY=key)
        # Equivalent own-profile aliases support the unchanged baseline parser;
        # these values exist only in this worker environment, never in .env.
        mappings = json.loads((ROOT/'packages/dmb-agent-contracts/dmb_agent_contracts/profiles.json').read_text())
        spec = mappings['business-analyst' if service == 'meeting-analyzer' and phase == 'baseline' else service]
        for field, names in spec.items():
            lowered = field.lower()
            selected = (key if 'api_key' in lowered or lowered == 'assistant_model_key' else
                base_url if lowered in {'openai_base_url','model_base_url','assistant_model_url'} else
                model if lowered in {'openai_model','model_name','assistant_model'} else
                url if lowered in {'session_database_url','database_url','db_url','assistant_database_url'} else None)
            if selected is not None:
                env.update({name:selected for name in names})
        env.update(LLM_PROVIDER='openai_compat',AGENT_LLM_PROVIDER='openai_compat',AGENT_V2_LLM_PROVIDER='openai_compat',
            PRIORITISER_LLM_PROVIDER='openai_compat',AGENT_EXECUTION_BACKEND='direct',
            AGENT_V2_EXECUTION_BACKEND='direct',PRIORITISER_EXECUTION_BACKEND='direct',
            RUN_STARTUP_SEED='false',DMB_AGENT_SERVICE_ID=service,DMB_AGENT_LIMITER_MODE='standalone',
            DMB_AGENT_LIMITER_REDIS_URL='redis://127.0.0.1:62152/0',DMB_AGENT_LIMITER_NAMESPACE=namespace,
            DMB_AGENT_LIMITER_STATE_DIR=str(state_dir))
        config = {'case':case, 'phase':phase,'database_url':url,'output':str(own_output),
            'base_url':base_url,'model':model,'runtime_image':image,'ledger':str(ledger), 'dry_run':dry_run,'run_id':str(uuid4())}
        python = ROOT/ENVIRONMENTS[service]/'Scripts/python.exe'
        report['cases'][case_index]={**pending(planned,'worker_outcome_pending'),
            'status':'BLOCKED','attempted':True}
        persist()  # Fence an unknown child outcome BEFORE a provider can be called.
        try:
            result = subprocess.run([str(python),str(Path(__file__).resolve()),'--worker'],cwd=roots[0],env=env,
                input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=650)
        except subprocess.TimeoutExpired:
            # A killed worker leaves its full live reservation charged. Never
            # start another paid case after an unconfirmed execution outcome.
            result = subprocess.CompletedProcess([],124,stdout='',stderr='WorkerTimeoutError: bounded worker stopped')
        key = None
        if service == 'backlog-assistant':
            cleanup_owned_runtime(own_output/'runtime-state',image)
        if result.returncode:
            classes = re.findall(r"^([A-Za-z_][A-Za-z_0-9]*(?:Error|Exception)):", result.stderr, re.MULTILINE)
            frames = re.findall(r'File "([^"\n]+)", line ([0-9]+)', result.stderr)
            entry = {**planned, 'status':'FAIL', 'worker_exit':result.returncode,
                'error_type':classes[-1] if classes else 'WorkerFailure', 'attempts':[],
                'frames':[{'file':Path(name).name,'line':int(line)} for name,line in frames]}
        else:
            entry = json.loads(result.stdout)
        if entry.get('limiter') is not None:
            from dmb_agent_contracts.limiter import RedisLimiter,LimiterConfig
            metadata=entry['limiter']
            gate=RedisLimiter(LimiterConfig(redis_url='redis://127.0.0.1:62152/0',namespace=namespace,
                epoch=metadata['epoch'],journal_dir=Path(metadata['journal_dir']),limit=1))
            previous_service=os.environ.get('DMB_AGENT_SERVICE_ID')
            os.environ['DMB_AGENT_SERVICE_ID']=service
            try:
                gate.confirm_run_cleanup(config['run_id'])
            finally:
                if previous_service is None:
                    os.environ.pop('DMB_AGENT_SERVICE_ID',None)
                else:
                    os.environ['DMB_AGENT_SERVICE_ID']=previous_service
        write_evidence(own_output/'result.json',entry)
        entry.setdefault('attempted',True)
        report['cases'][case_index]=entry
        persist()
        print(json.dumps({'case_id':case['case_id'],'phase':phase,'status':entry['status'],
            'actual_attempts':len(entry['attempts'])}),flush=True)
        if not dry_run and entry.get('error_code') in {'live_budget_exhausted','live_budget_lock_unavailable'}:
            stop_pending(case_index+1,entry['error_code'])
            return report
        if not dry_run and (result.returncode or any(attempt['outcome'] != 'transport_closed' or attempt.get('http_status') in (401,403,429) for attempt in entry['attempts'])):
            stop_pending(case_index+1,'prior_outcome_unconfirmed_or_provider_blocked')
            raise RuntimeError('product_replay_unknown_outcome_stopped')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare',type=Path)
    parser.add_argument('--execute',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--ledger',type=Path,default=ROOT/'.runtime/agent-services-evidence/model-budget.json')
    parser.add_argument('--postgres-container-id')
    parser.add_argument('--check-drivers',action='store_true')
    parser.add_argument('--continue-from',type=Path)
    parser.add_argument('--service',action='append',choices=ENVIRONMENTS)
    parser.add_argument('--case-id',action='append')
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        return worker()
    for path in (args.prepare,args.execute,args.output,args.ledger,args.continue_from):
        if path is not None and not path.resolve().is_relative_to(ROOT/'.runtime'):
            parser.error('Replay artifacts must stay in workspace .runtime')
    if args.prepare and not args.execute:
        plan = prepare(args.prepare.resolve())
        print(json.dumps({'prepared_logical_cases':len(plan['cases']),'model_calls':0}))
    elif args.execute and args.output and args.postgres_container_id:
        execute(args.execute.resolve(),args.output.resolve(),args.ledger.resolve(),args.postgres_container_id,dry_run=args.check_drivers,continue_from=args.continue_from.resolve() if args.continue_from else None,services=args.service,case_ids=args.case_id)
    else:
        parser.error('Choose --prepare PATH or --execute PREPARED --output NEW_PATH --postgres-container-id ID')


if __name__ == '__main__':
    main()
