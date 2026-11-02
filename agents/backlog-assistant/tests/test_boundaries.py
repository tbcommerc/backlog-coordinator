import asyncio
import json
import time
import httpx
import pytest
from jsonschema import ValidationError
from contracts.models import Answer, Context, QuerySpec
from contracts.catalog import catalog
from fixtures.data import FakeData
from bridge.tools import ToolBridge
from bridge.model import ModelBroker
from runtime.fake import FakeRuntime
from runtime.opencode import OpenCodeRuntime, config
from backlog_assistant.security import sign, verify


async def bridge(owner="one", max_calls=6):
    data = FakeData()
    execution = data.register(owner)
    grant = await data.activate(execution, "lease")
    return ToolBridge(data, execution, grant, await data.catalog(execution, grant),
                      deadline=time.monotonic()+60, max_calls=max_calls)


@pytest.mark.asyncio
async def test_tools_fail_closed_and_budget_includes_concurrent_calls():
    b = await bridge(max_calls=1)
    with pytest.raises(ValueError):
        await b.call("shell", {"command": "whoami"})
    with pytest.raises(ValidationError):
        await b.call("read_task", {"task_ref": "task:1", "user_id": 9})
    results = await asyncio.gather(b.call("read_task", {"task_ref": "task:1"}),
        b.call("read_task", {"task_ref": "task:2"}), return_exceptions=True)
    assert sum(isinstance(r, ValueError) for r in results) == 1
    assert b.calls == 1


@pytest.mark.asyncio
async def test_grants_are_execution_bound_and_rotated():
    b = await bridge()
    old = b._grant
    replacement = await b.data.activate(b.execution, "new-lease")
    assert old != replacement
    with pytest.raises(ValueError):
        await b.check()
    other = b.data.register("two")
    with pytest.raises(ValueError):
        await b.data.check(other, replacement)


@pytest.mark.asyncio
async def test_all_sources_even_uncited_are_verified():
    b = await bridge()
    r = await b.call("read_task", {"task_ref": "task:1"})
    foreign = b.data.register("two")
    grant = await b.data.activate(foreign, "other")
    f = await b.data.tool(foreign, grant, "read_task", {}, "call")
    candidate = Answer(kind="answer", context=Context(), as_of=r.observed_at, sources=r.sources, coverage=r.coverage)
    with pytest.raises(ValueError):
        await b.data.verify(b.execution, b._grant, candidate, b.receipts + [f.sources[0].receipt_ref])


@pytest.mark.asyncio
async def test_model_budget_counts_retries_and_rejects_before_network():
    b = await bridge()
    network_calls = []
    async def transport(request):
        network_calls.append(request)
        return httpx.Response(200, json={"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    broker = ModelBroker(b, "https://synthetic.invalid/v1", "test", "model", transport=httpx.MockTransport(transport))
    for _ in range(4):
        await broker.completion({"model": "model", "messages": [{"role": "user", "content": "hi"}]})
    with pytest.raises(ValueError, match="budget"):
        await broker.completion({"model": "model", "messages": []})
    assert len(network_calls) == 4
    await broker.client.aclose()


@pytest.mark.asyncio
async def test_unknown_provider_delivery_reserves_output_budget():
    b = await bridge()
    async def transport(request):
        raise httpx.ReadTimeout("synthetic")
    broker = ModelBroker(b, "https://synthetic.invalid/v1", "test", "model", transport=httpx.MockTransport(transport))
    for _ in range(4):
        with pytest.raises(httpx.ReadTimeout):
            await broker.completion({"model": "model", "messages": []})
    with pytest.raises(ValueError, match="budget"):
        await broker.completion({"model": "model", "messages": []})
    assert broker.requests == 4 and broker.output_reserved == 6000
    await broker.client.aclose()


@pytest.mark.asyncio
async def test_revoked_execution_never_calls_provider():
    b = await bridge()
    await b.data.revoke(b.execution, b._grant)
    broker = ModelBroker(b, "https://synthetic.invalid/v1", "test", "model")
    with pytest.raises(ValueError):
        await broker.completion({"model": "model", "messages": []})
    assert broker.requests == 0
    await broker.client.aclose()


@pytest.mark.asyncio
async def test_two_runtime_instances_never_share_state():
    one, two = await bridge("one"), await bridge("two")
    runtime = FakeRuntime()
    h1, h2 = await asyncio.gather(runtime.prepare({}, one, {}), runtime.prepare({}, two, {}))
    assert h1["instance"] != h2["instance"] and h1["session"] != h2["session"]
    await runtime.dispose(h1)
    assert h2["instance"] in runtime.instances
    await runtime.dispose(h2)
    assert not runtime.instances


@pytest.mark.asyncio
async def test_unknown_prompt_delivery_is_never_retried():
    b = await bridge()
    requests = []
    async def transport(request):
        requests.append(request)
        raise httpx.ReadTimeout("synthetic")
    runtime = OpenCodeRuntime(None, model="model")
    handle = {"instance": "instance", "session": "ses_test", "message": "msg_test", "schema": Answer.model_json_schema(), "dispatch_attempted": False}
    runtime.clients["instance"] = httpx.AsyncClient(base_url="http://runtime.invalid", transport=httpx.MockTransport(transport))
    runtime.bridges["instance"] = b
    assert await runtime.submit(handle, {}, "dispatch") == "unknown"
    with pytest.raises(ValueError, match="duplicate"):
        await runtime.submit(handle, {}, "dispatch")
    assert len(requests) == 1
    await runtime.clients["instance"].aclose()


@pytest.mark.parametrize("field,value", [("raw_sql", "SELECT 1"), ("url", "https://example.com"),
    ("role", "admin"), ("user_id", 1), ("auth_session", "x"), ("table", "tasks")])
def test_query_forbids_model_identity_and_code(field, value):
    with pytest.raises(ValueError):
        QuerySpec.model_validate({field: value})


def test_tool_permissions_are_exact():
    cfg = config("model", "http://broker/v1", "http://bridge/mcp", "synthetic", ["read_task"])
    assert cfg["permission"] == {"*": "deny", "StructuredOutput": "allow", "dmb_read_task": "allow"}
    assert cfg["share"] == "disabled" and not cfg["plugin"]
    assert cfg["agent"]["build"]["disable"]


def test_attestation_binds_query_body_and_idempotency():
    secret = "a" * 32
    token = sign(secret, "owner", "POST", "/v1/sessions", b"{}", "key")
    for path, body, key in [("/v1/sessions?x=1", b"{}", "key"), ("/v1/sessions", b"[]", "key"), ("/v1/sessions", b"{}", "other")]:
        with pytest.raises(ValueError):
            verify(secret, token, "POST", path, body, key)


def test_claim_requires_source_and_no_model_urls():
    from contracts.models import Claim, Action
    with pytest.raises(ValueError):
        Claim(text="Зафиксирован факт", type="fact", source_ids=[])
    with pytest.raises(ValueError):
        Action(type="open_object", object_ref="task:1", url="https://evil.invalid")


def test_model_schema_inlines_local_references():
    from contracts.catalog import compact_schema
    schema = compact_schema(Answer.model_json_schema())
    assert '$ref' not in json.dumps(schema)
    assert schema['properties']['context']['type'] == 'object'
    assert schema['properties']['coverage']['type'] == 'object'
    assert schema['properties']['as_of']['format'] == 'date-time'


def test_generation_schema_keeps_server_metadata_out_of_model_output():
    from runtime.opencode import generation_schema
    schema = generation_schema(Answer.model_json_schema())
    assert not {"context", "coverage", "sources", "as_of"} & set(schema["properties"])
    assert "data_blocks" in schema["properties"]
    assert "uniqueItems" not in json.dumps(schema)


@pytest.mark.asyncio
async def test_search_model_preview_excludes_unrequested_financial_and_long_text():
    from bridge.tools import model_evidence
    tool_bridge = await bridge()
    result = await tool_bridge.call("search_work_items", {"query": {"object_type": "task"}})
    result.data["items"] = [{"title": "Synthetic", "description": "private long text", "cost_rub": "999", "status": "Open"}] * 8
    preview = json.loads(model_evidence(result))
    assert len(preview["data"]["items"]) == 5
    assert all(set(row) == {"title", "status"} for row in preview["data"]["items"])
    assert len(result.data["items"]) == 8


@pytest.mark.asyncio
async def test_glm_latency_profile_preserves_usage_budget():
    b = await bridge()
    payloads = []
    async def transport(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    broker = ModelBroker(b, "https://synthetic.invalid/v1", "test", "glm-5.3-flash", transport=httpx.MockTransport(transport))
    await broker.completion({"model": "glm-5.3-flash", "messages": [], "reasoning_effort": "max", "max_tokens": 99999})
    assert payloads[0]["reasoning_effort"] == "low"
    assert payloads[0]["max_tokens"] == 1500
    assert broker.requests == 1 and broker.output_reserved == 5
    await broker.client.aclose()


@pytest.mark.asyncio
async def test_hung_docker_command_is_killed_with_bounded_wait():
    from runtime.docker import wait_process
    class Process:
        returncode = None
        killed = False
        async def wait(self):
            if not self.killed:
                await asyncio.sleep(10)
            return -1
        def kill(self):
            self.killed = True
            self.returncode = -1
    process = Process()
    with pytest.raises(TimeoutError):
        await wait_process(process, timeout=.01)
    assert process.killed


@pytest.mark.asyncio
async def test_large_evidence_preview_keeps_full_server_receipt():
    from bridge.tools import model_evidence
    b=await bridge()
    result=await b.call("read_task", {"task_ref":"task:1"})
    result.data={"items":[{"description":"x"*2000}],"history":[{"field":"status_id","old":"1","new":"2"}]*60,"history_total":60}
    preview=json.loads(model_evidence(result))["data"]
    assert len(preview["history"])==5 and preview["history_total"]==60
    assert len(preview["items"][0]["description"])==400
    assert len(result.data["history"])==60 and len(result.data["items"][0]["description"])==2000


@pytest.mark.asyncio
async def test_extra_clarification_choices_do_not_discard_question():
    b=await bridge()
    runtime=OpenCodeRuntime(None,model="model")
    runtime.bridges["i"]=b
    async def messages(handle):
        return [{"info":{"sessionID":"s","parentID":"m","role":"assistant","time":{"completed":1},"structured":{"kind":"clarification","clarification":{"question":"Which period?","options":[str(i) for i in range(6)]}}}}]
    runtime._messages=messages
    answer=await runtime.collect({"instance":"i","session":"s","message":"m","context":Context().model_dump(mode="json")})
    assert answer.clarification.question=="Which period?"
    assert len(answer.clarification.options)==5


@pytest.mark.asyncio
async def test_denied_object_stops_followup_broad_search():
    b=await bridge()
    calls=[]
    async def denied(*args):
        calls.append(args)
        raise PermissionError("source_access_denied")
    b.data.tool=denied
    with pytest.raises(PermissionError):await b.call("read_task",{"task_ref":"task:99"})
    with pytest.raises(PermissionError):await b.call("search_work_items",{"query":{}})
    assert len(calls)==1 and not b.results

@pytest.mark.asyncio
async def test_explicit_search_literal_cannot_be_dropped_by_model():
    b = await bridge()
    b.bind_request('Найди задачи со словом НЕСУЩЕСТВУЮЩИЙ_В.')
    observed=[]
    original=b.data.tool
    async def recording(execution,grant,name,args,call_id):
        observed.append(args)
        return await original(execution,grant,name,args,call_id)
    b.data.tool=recording
    await b.call('search_work_items', {'query':{}})
    assert observed[0]['query']['terms']==['НЕСУЩЕСТВУЮЩИЙ_В']
    b.bind_request('Найди TASK-000-003')
    await b.call('search_work_items', {'query':{'terms':['task-000-003']}})
    assert observed[1]['query']['terms']==['task-000-003']


@pytest.mark.asyncio
async def test_malformed_reference_is_retriable_without_domain_access():
    b=await bridge()
    with pytest.raises(ValidationError):
        await b.call('read_request', {'request_ref':'6'})
    assert b.calls==0 and b.failure is None
    await b.call('read_request', {'request_ref':'request:6'})
    assert b.calls==1


def test_obvious_intent_catalog_only_narrows_authorized_tools():
    from bridge.selection import select_catalog
    original=catalog()
    selected=select_catalog(original,'Найди задачи без финансового эффекта')
    assert {t['name'] for t in selected['tools']}=={'resolve_context','search_work_items','search_help'}
    limited=dict(original,tools=[t for t in original['tools'] if t['name']=='search_help'])
    assert select_catalog(limited,'Прочитай task:1')['tools']==limited['tools']
    assert select_catalog(original,'Сравни задачи и покажи сумму стоимости')==original
    assert select_catalog(original,'Необычный вопрос')==original


@pytest.mark.asyncio
async def test_invalid_completed_answer_has_one_bounded_repair_without_resend():
    b=await bridge()
    runtime=OpenCodeRuntime(None,model='model');runtime.bridges['i']=b
    handle={'instance':'i','session':'s','message':'original','schema':Answer.model_json_schema(),'context':Context().model_dump(mode='json')}
    attempted=[];reads=[]
    async def collect(current):
        reads.append(current['message'])
        if len(reads)==1:raise ValueError('unknown_result_reference')
        return Answer(kind='clarification',clarification={'question':'Which task?'},context=Context(),as_of='2026-10-15T00:00:00Z',coverage={})
    async def request(current,method,path,body=None):
        attempted.append(body['messageID'])
        raise httpx.ReadTimeout('unknown repair delivery')
    async def inspect(current):return 'completed'
    runtime._collect=collect;runtime._request=request;runtime.inspect=inspect
    answer=await runtime.collect(handle)
    assert answer.kind=='clarification'
    assert len(attempted)==1 and attempted[0]!='original'
    assert reads==['original',attempted[0]] and handle['format_repairs']==1
    async def invalid(current):raise ValueError('still_invalid')
    runtime._collect=invalid
    with pytest.raises(ValueError,match='still_invalid'):await runtime.collect(handle)
    assert len(attempted)==1


def test_explicit_query_only_accepts_unambiguous_positive_commands():
    from bridge.selection import explicit_query
    assert explicit_query('Покажи мои задачи.')=={'relationship':'mine'}
    assert explicit_query('Найди задачи без финансового эффекта')=={'missing':['effect']}
    assert explicit_query('Найди задачу о кэшировании котировок')=={'terms':['кэшировании котировок']}
    assert explicit_query('Не показывай мои задачи')=={}
    assert explicit_query('Покажи задачи без ограничений')=={}
    assert explicit_query('Найди задачи без ответственного, но со стоимостью')=={}


@pytest.mark.asyncio
async def test_count_preserves_resolved_filters_and_blocks_ambiguity():
    from evaluation.data import EvalData
    data=EvalData({'text':'Сколько задач?'})
    execution=data.register('synthetic')
    grant=await data.activate(execution,'lease')
    b=ToolBridge(data,execution,grant,await data.catalog(execution,grant),deadline=time.monotonic()+60)
    await b.call('resolve_context',{'kind':'team','text':'Альфа'})
    await b.call('resolve_context',{'kind':'status','text':'В работе'})
    await b.call('resolve_context',{'kind':'period','text':'1Q 2026'})
    result=await b.call('aggregate_backlog',{'query':{},'group_by':'team','metrics':['count']})
    assert result.data['total']==1
    q=data.calls[-1]['arguments']['query']
    assert q['team_ids']==[1] and q['status_ids']==[2] and q['period']=='1Q 2026'
    with pytest.raises(ValueError,match='conflict'):
        await b.call('aggregate_backlog',{'query':{'team_ids':[2]},'group_by':'team','metrics':['count']})
    await b.call('resolve_context',{'kind':'period','text':'unknown'})
    with pytest.raises(ValueError,match='unresolved_context'):
        await b.call('aggregate_backlog',{'query':{},'group_by':'team','metrics':['count']})


def test_count_catalog_only_exposes_resolution_and_aggregation():
    from bridge.selection import select_catalog
    for text in ['Сколько задач в работе?', 'Количество задач на 4 квартал']:
        assert {t['name'] for t in select_catalog(catalog(),text)['tools']}=={'resolve_context','aggregate_backlog'}


@pytest.mark.asyncio
async def test_count_cannot_drop_explicit_search_literal():
    from evaluation.data import EvalData
    data=EvalData({'text':'Сколько задач со словом Альфа?'})
    execution=data.register('synthetic')
    grant=await data.activate(execution,'lease')
    b=ToolBridge(data,execution,grant,await data.catalog(execution,grant),deadline=time.monotonic()+60)
    b.bind_request('Сколько задач со словом Альфа?')
    result=await b.call('aggregate_backlog',{'query':{},'group_by':'status','metrics':['count']})
    assert result.data['total']==2
    assert data.calls[-1]['arguments']['query']['terms']==['Альфа']
