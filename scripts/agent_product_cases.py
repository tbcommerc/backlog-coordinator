"""Synthetic product drivers. Imported only in a service-isolated replay worker.

All identity/rubric/data fixtures live in memory. No DMB imports or reference
rows. Product prompts, workflows, validation and scoring come from the selected
baseline or candidate source tree.
"""
import asyncio
from copy import deepcopy
from dataclasses import asdict, is_dataclass
from datetime import datetime, timedelta, timezone
import importlib
import json
from pathlib import Path
import time
from uuid import uuid4


def serial(value):
    if hasattr(value, 'model_dump'):
        return value.model_dump(mode='json')
    return asdict(value) if is_dataclass(value) else value


def dialogue(case, config):
    package = case['service'].replace('-', '_')
    session = importlib.import_module(package+'.session')
    audit = importlib.import_module(package+'.audit')
    audit.LOG_DIR = Path(config['output'])/'audit'
    store = session.SessionStore(database_url=config['database_url'])
    if hasattr(store, 'migrate_schema'):
        store.migrate_schema()
    context_type = importlib.import_module(package+'.context').UserContext
    context = context_type(user_id=123, name='Synthetic analyst', is_ba=True,
        role_name='Бизнес-аналитик', customer_access='read_write',
        **({'operator_role':'BA'} if case['service'].endswith('experimental') else {}))
    try:
        if case['service'] == 'business-analyst':
            orchestrator = importlib.import_module(package+'.agentic_orchestrator').AgenticOrchestrator(store)
            started = orchestrator.new_session(123, context)
            result = orchestrator.handle_message(started.session_id, case['input']['text'], context,
                message_id=case['case_id'])
            return {'response':serial(result), 'state':session.state_to_dict(store.get(started.session_id))}
        orchestrator = importlib.import_module(package+'.v2.orchestrator').V2Orchestrator(store)
        started = orchestrator.new_session(123, context, 'requirement_copilot')
        identity = started.session_id
        workspace = importlib.import_module(package+'.v2.document_workspace')
        state = store.get(identity)
        previous = None
        if case['category'] == 'correction':
            # Frozen fixture: an existing, human authored and approved v1.
            workspace.save_sections(state, {'title':'Synthetic CSV requirement',
                'problem_statement':'Оператор экспортирует CSV по пятницам.'})
            state.review_status = 'approved'
            state.artifact_revision_history[-1]['review_status'] = 'approved'
            previous = deepcopy(state.artifact_revision_history)
            store.save(state)
            orchestrator.document_action(identity, 123, {'action':'next_revision',
                'expected_draft_hash':state.draft['fingerprint'], 'reason':'Явное решение заказчика'})
        state = store.get(identity)
        workspace.add_source(state, {'title':'SYN-1', 'content':case['input']['text']})
        store.save(state)
        result = orchestrator.document_action(identity, 123, {
            'action':'propose_change' if previous else 'create_draft',
            'expected_draft_hash':(state.draft or {}).get('fingerprint',''),
            'instruction':case['input']['text']})
        current = store.get(identity)
        return {'response':serial(result), 'state':session.state_to_dict(current),
                'approved_fixture_before':previous}
    finally:
        getattr(store, "engine", store._engine).dispose()


def meeting(case, config):
    from dmb_agent_contracts.go import GoModel
    from dmb_agent_contracts.model import ModelRequest
    provider = GoModel(base_url=config['base_url'], api_key=config['key'], model=config['model'])
    text = case['input']['text']
    try:
        if config['phase'] == 'baseline':
            from business_analyst.meeting_task_extractor import extract_meeting, ExtractionInput
            from business_analyst.llm.openai_compat import OpenAICompatProvider
            return extract_meeting(ExtractionInput(transcript=text), OpenAICompatProvider())
        from meeting_analyzer.extraction import Output, SYSTEM, validate_candidate
        request = ModelRequest(request_id=uuid4(), run_id=uuid4(), purpose='extraction',
            messages=[{'role':'user','content':json.dumps({'transcript':text},ensure_ascii=False)}],
            system_prompt=SYSTEM, output_schema=Output.model_json_schema(), model_profile='synthetic',
            deadline_at=datetime.now(timezone.utc)+timedelta(seconds=600), max_output_tokens=12000)
        return validate_candidate(provider.complete(request).structured, text)
    finally:
        provider.client.close()


def assessor(case, config):
    from value_priority_assessor.strategy.analysts import AgentStrategyAnalyst
    from value_priority_assessor.llm.factory import get_adapter
    rubric = {'strategy_fit':{'rubric_version':1, 'criteria':[{'id':'synthetic',
        'title':'Инициатива явно выполняет synthetic критерий стратегии', 'weight':1,
        'options':{'direct':{'value':1,'title':'Есть явное подтверждение'},
                   'none':{'value':0,'title':'Подтверждений нет'},
                   'unknown':{'value':0,'title':'Недостаточно данных'}}}],
        'scale':{'raw_min':1,'raw_max':10}}}
    from contextlib import contextmanager
    from sqlalchemy import create_engine, inspect, select
    from sqlalchemy.orm import Session
    from value_priority_assessor.core.models import LlmCall
    engine = create_engine(config['database_url'])
    if inspect(engine).get_table_names():
        raise RuntimeError('fresh_replay_history_required')
    LlmCall.__table__.create(engine)
    @contextmanager
    def history():
        with Session(engine) as session:
            yield session
            session.commit()
    analyst = AgentStrategyAnalyst(get_adapter(), use_rag=False, session_factory=history)
    try:
        prior, hits = [], []
        if case['category'] == 'correction':
            old = 'SYN-TASK-3: подтверждений synthetic критерия стратегии нет.'
            for _ in range(2):
                prior.append(analyst.assess(old,None,rubric).as_dict())
                hits.append(analyst.last_cache_hit)
        text = case['input']['text']
        if case['category'] == 'correction':
            text += ' Разрешённое evidence SYN-EVIDENCE-2: инициатива явно выполняет synthetic критерий стратегии.'
        assessment = analyst.assess(text, None, rubric)
        hits.append(analyst.last_cache_hit)
        with history() as session:
            rows = session.scalars(select(LlmCall).order_by(LlmCall.id)).all()
            hashes = [row.prompt_hash for row in rows]
        return {'assessment':assessment.as_dict(), 'fixture_rubric':rubric,
            'prior_assessments':prior, 'cache_hits':hits, 'history_prompt_hashes':hashes,
            'retrieval':'synthetic_in_memory_only', 'protected_writes':0}
    finally:
        engine.dispose()


async def _backlog(case, config):
    from bridge.tools import ToolBridge
    from contracts.models import Answer, Context, Coverage
    from fixtures.data import FakeData
    # Ownership enforcement is trusted qualification infrastructure. Baseline
    # domain runtime, broker, tools and prompts remain from its frozen source.
    import importlib.util
    launcher_path = Path(__file__).resolve().parents[1]/'agents/backlog-assistant/runtime/docker.py'
    spec = importlib.util.spec_from_file_location('trusted_replay_docker', launcher_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    DockerLauncher = module.DockerLauncher
    from runtime.opencode import OpenCodeRuntime

    class SyntheticData(FakeData):
        async def tool(self, execution, grant, name, arguments, call_id):
            result = await super().tool(execution, grant, name, arguments, call_id)
            # SYN labels are public fixture titles, not internal references.
            # Tool inputs require canonical task:N identities even in synthetic data.
            items = [{'object_ref':'task:1001', 'title':'SYN-WORK-A', 'status':'open'},
                     {'object_ref':'task:1002', 'title':'SYN-WORK-B', 'status':'open'}]
            if case['category'] == 'defense':
                items[0]['description'] = case['input']['text']
            result = result.model_copy(update={'data':{'items':items,'total':2},
                'coverage':Coverage(matched_total=2,displayed_count=2)})
            self.receipts[result.snapshot_ref]['result'] = result.model_dump(mode='json')
            return result

    from sqlalchemy import create_engine
    from backlog_assistant.store import Store, metadata
    from backlog_assistant.worker import Worker
    from dmb_agent_contracts.run_store import metadata as technical_metadata
    # Exercise the actual worker, including its existing server-evidence fallback.
    # The earlier low-level runtime replay omitted that product behavior; retain
    # those reports as runtime diagnostics, never substitute them for this path.
    engine = create_engine(config['database_url'])
    metadata.create_all(engine)
    technical_metadata.create_all(engine)
    store = Store(engine)
    data = SyntheticData()
    owner = 'synthetic-product-replay'
    execution = data.register(owner)
    context = Context().model_dump(mode='json')
    session = store.create(owner,case['case_id']+'-session',{'context':context})
    text = ('Покажи открытые SYN-WORK-A и SYN-WORK-B из разрешённого synthetic snapshot.'
            if case['category'] == 'correction' else case['input']['text'])
    body = {'text':text,'context':context,'context_revision':session['revision'],'execution_ref':execution}
    import inspect
    options = {'run_id':config['run_id']} if 'run_id' in inspect.signature(store.enqueue).parameters else {}
    row = store.enqueue(owner,session['id'],case['case_id'],body,**options)
    launcher = DockerLauncher(Path(config['output'])/'runtime-state', config['base_url'],
        config['key'], config['runtime_image'])
    runtime = OpenCodeRuntime(launcher, model=config['model'])
    worker = Worker(store,data,runtime)
    duplicate = store.enqueue(owner,session['id'],case['case_id'],body)
    if duplicate['id'] != row['id']:
        raise AssertionError('duplicate_delivery_created_another_run')
    claimed = store.claim(worker.id)
    if claimed is None or claimed['id'] != row['id']:
        raise AssertionError('own_queued_run_not_claimed')
    try:
        await worker.execute(claimed)
        saved = store.get_run(owner,row['id'])
        return {'answer':saved['answer'],'product_status':saved['status'],
            'error_code':saved['error_code'],'cleanup_pending':saved['cleanup_pending'],
            'duplicate_dispatch':'same_persisted_run',
            'receipt_count':len(saved['receipts']),
            'execution_path':'actual_product_worker_and_store'}
    finally:
        for instance_id in list(launcher.instances):
            await launcher.destroy(instance_id)
        engine.dispose()



def backlog(case, config):
    return asyncio.run(_backlog(case, config))


DRIVERS = {'business-analyst':dialogue, 'business-analyst-experimental':dialogue,
    'meeting-analyzer':meeting, 'value-priority-assessor':assessor, 'backlog-assistant':backlog}
