from datetime import datetime, timedelta, timezone
from uuid import uuid4
import httpx
import pytest
from dmb_agent_contracts.config import resolve_alias, validate_go_url
from dmb_agent_contracts.go import GoModel
from dmb_agent_contracts.model import AgentError, ModelRequest


def request(**values):
    return ModelRequest(request_id=uuid4(), run_id=uuid4(), purpose="extraction", messages=[{"role": "user", "content": "Synthetic"}],
        system_prompt="JSON", output_schema={}, model_profile="test", max_output_tokens=100,
        deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20), **values)


@pytest.mark.parametrize("status,code", [(401,"provider_auth_failed"), (403,"provider_auth_failed"), (429,"provider_quota_exhausted"), (302,"provider_protocol_error"), (500,"provider_protocol_error")])
def test_safe_errors_no_retries(status, code):
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(status, text="synthetic-secret", headers={"Location": "https://evil.invalid/"})
    model = GoModel(base_url="https://opencode.ai/zen/go/v1", api_key="synthetic-secret", model="glm", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(AgentError, match=code) as error:
        model.complete(request())
    assert "synthetic-secret" not in str(error.value)
    assert len(calls) == 1


def test_conversation_headers_and_usage():
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"items": []}'}, "finish_reason": "stop"}]})
    model = GoModel(base_url="https://opencode.ai/zen/go/v1", api_key="synthetic-secret", model="glm", client=httpx.Client(transport=httpx.MockTransport(handler)))
    first = request(conversation_ref="one")
    result = model.complete(first)
    model.complete(first.model_copy(update={"request_id": uuid4()}))
    model.complete(request(conversation_ref="two"))
    assert calls[0].headers["x-opencode-session"] == calls[1].headers["x-opencode-session"]
    assert calls[0].headers["x-opencode-session"] != calls[2].headers["x-opencode-session"]
    assert calls[0].headers["User-Agent"] == "Backlog-Coordinator-Agent/1.0"
    assert result.usage.input_tokens is None


@pytest.mark.parametrize("url", ["http://opencode.ai/zen/go/v1", "https://evil.invalid/zen/go/v1", "https://user:password@opencode.ai/zen/go/v1", "https://opencode.ai/zen/go/v1?key=secret"])
def test_origin(url):
    with pytest.raises(AgentError):
        validate_go_url(url)


def test_alias_conflict_no_values():
    with pytest.raises(ValueError) as error:
        resolve_alias({"NEW": "secret-one", "OLD": "secret-two"}, "NEW", "OLD")
    assert str(error.value) == "Conflicting settings: NEW, OLD"


def test_unknown_reasoning_capability_is_rejected_before_wire():
    model=GoModel(base_url="https://opencode.ai/zen/go/v1",api_key="synthetic",model="glm",
        client=httpx.Client(transport=httpx.MockTransport(lambda req:pytest.fail("Unexpected inference"))))
    with pytest.raises(AgentError,match="model_capability_missing"):
        model.complete(request(reasoning_effort="low"))


@pytest.mark.parametrize('protocol', ['responses', 'messages'])
def test_non_chat_protocol_is_rejected_before_wire(protocol):
    with pytest.raises(AgentError, match='model_capability_missing'):
        GoModel(base_url='https://opencode.ai/zen/go/v1', api_key='synthetic',
            model='synthetic-protocol-only-model', protocol=protocol,
            client=httpx.Client(transport=httpx.MockTransport(
                lambda req: pytest.fail('Incompatible model protocol reached the network'))))


def test_malformed_origin_never_echoes_value():
    with pytest.raises(AgentError) as error:
        validate_go_url("https://opencode.ai:synthetic-private-port/zen/go/v1")
    assert str(error.value)=="model_origin_not_allowed"
