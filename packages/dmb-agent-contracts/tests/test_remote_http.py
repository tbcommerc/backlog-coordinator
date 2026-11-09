"""Independent HTTP reference fixture; no adapter methods are mocked."""
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import contextmanager
import httpx
import jsonschema
import pytest
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.remote import RemoteOpenCode

import runpy
_reference = runpy.run_path(str(Path(__file__).with_name("http_reference.py")))
CONFIG, SCHEMA, emulator = (_reference[name] for name in ("CONFIG", "SCHEMA", "emulator"))


def test_positive_http_response_fixtures_match_pinned_snapshot():
    spec = json.loads((Path(__file__).resolve().parents[1]/"dmb_agent_contracts/reference/opencode-1.17.13.openapi.json").read_text(encoding="utf-8"))
    with emulator(permission=True) as (url,state), httpx.Client(base_url=url,timeout=2,trust_env=False) as client:
        runtime = RemoteOpenCode(base_url="https://reference.invalid",expected_config=CONFIG,
            model={"providerID":"controlled","modelID":"synthetic"},agent="bounded",client=client,enabled=True)
        handle = runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle, {}, "dispatch")
        for request_path, reference_path in [("/global/health","/global/health"),("/config","/config"),
            ("/agent","/agent"),("/session/ses_synthetic","/session/{sessionID}"),("/permission","/permission"),
            ("/session/ses_synthetic/message?limit=1","/session/{sessionID}/message")]:
            schema = spec["paths"][reference_path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
            validator = jsonschema.Draft202012Validator(schema,resolver=jsonschema.RefResolver.from_schema(spec))
            validator.validate(client.get(request_path).json())




def adapter(endpoint):
    # HTTP is restricted to this in-process loopback emulator fixture.
    return RemoteOpenCode(base_url="https://runtime.example.invalid", expected_config=CONFIG,
        model={"providerID": "controlled", "modelID": "synthetic"}, agent="bounded", enabled=True,
        client=httpx.Client(base_url=endpoint, trust_env=False, timeout=2))


def text_part(**changes):
    return {'id':'prt_synthetic','sessionID':'ses_synthetic','messageID':'msg_assistant',
        'type':'text','text':'{"items":[]}',**changes}


def test_text_result_parts_are_owned_and_match_the_pinned_wire_schema():
    with emulator(candidate=None,parts=[text_part()]) as (endpoint,state):
        runtime=adapter(endpoint)
        handle=runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle,{'text':'Synthetic'},'dispatch')
        spec=json.loads((Path(__file__).resolve().parents[1]/
            'dmb_agent_contracts/reference/opencode-1.17.13.openapi.json').read_text(encoding='utf-8'))
        schema=spec['paths']['/session/{sessionID}/message']['get']['responses']['200']['content']['application/json']['schema']
        validator=jsonschema.Draft202012Validator(schema,resolver=jsonschema.RefResolver.from_schema(spec))
        validator.validate(runtime.client.get('/session/ses_synthetic/message?limit=1').json())
        assert runtime.collect(handle)=={'items':[]}
        assert state['dispatch_count']==1
        runtime.dispose(handle)


@pytest.mark.parametrize('parts,code',[
    ([text_part(sessionID='ses_foreign')],'foreign_message_part'),
    ([text_part(messageID='msg_foreign')],'foreign_message_part'),
    ([text_part(messageID=None)],'foreign_message_part'),
    ([text_part(),text_part()],'runtime_protocol_error'),
    ([None],'runtime_protocol_error'),
    ({'not':'a part array'},'runtime_protocol_error'),
])
def test_foreign_or_duplicated_parts_never_enter_a_result(parts,code):
    # Reject even when structured output would otherwise bypass text assembly.
    with emulator(parts=parts) as (endpoint,state):
        runtime=adapter(endpoint)
        handle=runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle,{'text':'Synthetic'},'dispatch')
        with pytest.raises(AgentError,match=code):
            runtime.collect(handle)
        assert state['dispatch_count']==1
        runtime.dispose(handle)


def test_complete_http_lifecycle():
    with emulator() as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({}, {}, SCHEMA)
        assert runtime.submit(handle, {"text": "Synthetic"}, "dispatch") == "accepted"
        assert runtime.inspect(handle) == "completed"
        assert runtime.collect(handle) == {"items": []}
        assert runtime.dispose(handle) == {"cleanup": "confirmed"}
        assert state["dispatch_body"]["format"]["retryCount"] == 0
        assert state["dispatch_count"] == 1
        runtime.client.close()


def test_completed_structured_output_tool_finish_is_validated():
    with emulator(finish='tool-calls') as (endpoint,state):
        runtime=adapter(endpoint)
        handle=runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle,{},'dispatch')
        assert runtime.inspect(handle)=='completed'
        assert runtime.collect(handle)=={'items':[]}
        runtime.client.close()


@pytest.mark.parametrize('fault',[
    {'finish':'tool-calls','candidate':None},
    {'finish':'tool-calls','candidate':{'unexpected':1}},
    {'finish':None},
    {'finish':'unrecognised'},
])
def test_completion_marker_never_bypasses_result_validation(fault):
    with emulator(**fault) as (endpoint,state):
        runtime=adapter(endpoint)
        handle=runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle,{},'dispatch')
        with pytest.raises(AgentError,match='invalid_model_result'):
            runtime.collect(handle)
        assert state['dispatch_count']==1
        runtime.client.close()


def test_truncated_wire_json_is_a_protocol_error_without_resubmit():
    with emulator(malformed_message=True) as (endpoint,state):
        runtime=adapter(endpoint)
        handle=runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle,{},'dispatch')
        with pytest.raises(AgentError,match='runtime_protocol_error'):
            runtime.collect(handle)
        assert state['dispatch_count']==1
        assert state['dispatch_body']['format']['retryCount']==0
        runtime.client.close()


def test_unknown_delivery_no_second_submit():
    with emulator(disconnect=True) as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({}, {}, SCHEMA)
        assert runtime.submit(handle, {}, "dispatch") == "unknown"
        assert runtime.collect(handle) == {"items": []}
        with pytest.raises(AgentError, match="duplicate_dispatch"):
            runtime.submit(handle, {}, "dispatch")
        assert state["dispatch_count"] == 1
        runtime.client.close()


@pytest.mark.parametrize("fault,code", [({"version": "2.0"}, "runtime_version_unsupported"),
    ({"version": None}, "runtime_version_unsupported"),
    ({"version": ""}, "runtime_version_unsupported"),
    ({"config": {"plugin": ["unexpected"]}}, "runtime_profile_incompatible"),
    ({"config": {"provider": {"unexpected": {}}}}, "runtime_profile_incompatible"),
    ({"config": {"enabled_providers": ["unexpected"]}}, "runtime_profile_incompatible"),
    ({"config": {"mcp": {"unexpected": {"type": "remote", "url": "https://invalid.example"}}}}, "runtime_profile_incompatible"),
    ({"config": {"instructions": ["unexpected.md"]}}, "runtime_profile_incompatible"),
    ({"config": {"permission": {"*": "allow"}}}, "runtime_profile_incompatible")])
def test_preflight(fault, code):
    with emulator(**fault) as (endpoint, state):
        runtime = adapter(endpoint)
        with pytest.raises(AgentError, match=code):
            runtime.prepare({}, {}, SCHEMA)
        assert state.get("prepare_count", 0) == 0
        assert state["dispatch_count"] == 0
        runtime.client.close()


@pytest.mark.parametrize("fault,code", [({"session": "ses_foreign"}, "foreign_session"),
    ({"parent": "msg_foreign"}, "foreign_parent_message"), ({"finish": "length"}, "invalid_model_result"),
    ({"candidate": {"unexpected": 1}}, "invalid_model_result"), ({"permission": True}, "unexpected_permission")])
def test_result_boundary(fault, code):
    with emulator(**fault) as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle, {}, "dispatch")
        with pytest.raises(AgentError, match=code):
            runtime.collect(handle)
        if fault.get("permission"):
            assert state["permission_rejected"]
        runtime.client.close()


def test_cancel_and_cleanup_are_independent():
    with emulator(cleanup_failure=True) as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle, {}, "dispatch")
        assert runtime.cancel(handle, "test")["cleanup"] == "pending"
        with pytest.raises(AgentError, match="already_terminal"):
            runtime.collect(handle)
        assert runtime.dispose(handle)["cleanup"] == "failed"
        runtime.client.close()


def test_agent_permission_override_is_rejected_before_session_creation():
    agents = [{"name":"bounded", "mode":"primary", "permission":[
        {"permission":"*", "pattern":"*", "action":"deny"},
        {"permission":"StructuredOutput", "pattern":"*", "action":"allow"},
        {"permission":"bash", "pattern":"*", "action":"allow"}]}]
    with emulator(agents=agents) as (endpoint, state):
        runtime = adapter(endpoint)
        with pytest.raises(AgentError, match="runtime_profile_incompatible"):
            runtime.prepare({}, {}, SCHEMA)
        assert state.get("prepare_count", 0) == 0
        assert state["dispatch_count"] == 0
        runtime.client.close()


def test_reference_hash_and_dispatch_schema():
    root = Path(__file__).parents[1]/"dmb_agent_contracts"/"reference"
    raw = (root/"opencode-1.17.13.openapi.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == json.loads((root/"manifest.json").read_text())["openapi_sha256"]
    spec = json.loads(raw)
    path = spec["paths"]["/session/{sessionID}/prompt_async"]["post"]
    schema = path["requestBody"]["content"]["application/json"]["schema"]
    with emulator() as (endpoint, state):
        runtime = adapter(endpoint)
        handle = runtime.prepare({}, {}, SCHEMA)
        runtime.submit(handle, {}, "dispatch")
        validator = jsonschema.Draft202012Validator(schema, resolver=jsonschema.RefResolver.from_schema(spec))
        validator.validate(state["dispatch_body"])
        with pytest.raises(jsonschema.ValidationError):
            validator.validate({"parts": [{"type": "nonexistent"}]})
        runtime.client.close()
