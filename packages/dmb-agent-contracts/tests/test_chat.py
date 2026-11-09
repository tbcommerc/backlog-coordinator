from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from dmb_agent_contracts.chat import ChatCompletionModel
from dmb_agent_contracts.model import AgentError, ModelRequest


def request(**changes):
    values = dict(request_id=uuid4(), run_id=uuid4(), purpose="dialogue",
                  messages=[{"role": "user", "content": "Synthetic"}], system_prompt="Service-owned",
                  model_profile="local-go-direct", deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20),
                  max_output_tokens=100, temperature=.3)
    return ModelRequest(**(values | changes))


def response(**changes):
    return {"choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}], **changes}


def test_wire_contract_and_usage():
    captured = {}
    def transport(path, payload, timeout):
        captured.update(path=path, payload=payload, timeout=timeout)
        return response(model="resolved-model", id="synthetic-request", usage={"prompt_tokens": 10,
            "completion_tokens": 5, "prompt_tokens_details": {"cached_tokens": 2},
            "completion_tokens_details": {"reasoning_tokens": 3}, "cost":0,
            "opencode":{"allowance":0.25}})
    result = ChatCompletionModel(transport=transport, model="own-model").complete(
        request(output_schema={"type": "object"}, reasoning_effort="low"))
    assert result.structured == {"ok": True}
    assert result.usage.model_dump() == dict(input_tokens=10, output_tokens=5, cache_tokens=2,
                                           reasoning_tokens=3, cost=0, allowance=0.25, unavailable_reason=None)
    assert result.model_actual == "resolved-model" and result.validation_status == "pending"
    assert captured["payload"] == {"model": "own-model", "messages": [
        {"role": "system", "content": "Service-owned"}, {"role": "user", "content": "Synthetic"}],
        "temperature": .3, "max_tokens": 100, "response_format": {"type": "json_object"}, "reasoning_effort": "low"}
    assert 0 < captured["timeout"] <= 20


@pytest.mark.parametrize("reason", ["length", "content_filter", None])
def test_unfinished_response_cannot_be_success(reason):
    data = response()
    data["choices"][0]["finish_reason"] = reason
    with pytest.raises(AgentError):
        ChatCompletionModel(transport=lambda *a, **kw: data, model="own").complete(request())


def test_unknown_usage_is_not_zero():
    result = ChatCompletionModel(transport=lambda *a, **kw: response(), model="own").complete(request())
    assert result.usage.input_tokens is None and result.usage.output_tokens is None
    assert result.usage.unavailable_reason == "provider_not_reported"


def test_expired_request_never_submits():
    def forbidden(*a, **kw):
        raise AssertionError("Expired request reached transport")
    with pytest.raises(AgentError, match="operation_deadline_exceeded"):
        ChatCompletionModel(transport=forbidden, model="own").complete(
            request(deadline_at=datetime.now(timezone.utc)-timedelta(seconds=1)))


def test_unregistered_tools_never_submit():
    with pytest.raises(AgentError, match="model_capability_missing"):
        ChatCompletionModel(transport=lambda *a, **kw: pytest.fail("Tool request submitted"), model="own").complete(
            request(allowed_tools=[{"name": "unregistered"}]))


@pytest.mark.parametrize("content", [None, "[]", "invalid-json"])
def test_invalid_structured_candidate_is_safe_error(content):
    data = response()
    data["choices"][0]["message"]["content"] = content
    with pytest.raises(AgentError, match="invalid_model_result"):
        ChatCompletionModel(transport=lambda *a, **kw: data, model="own").complete(request(output_schema={"type": "object"}))


@pytest.mark.parametrize("status,code", [(401,"provider_auth_failed"),(403,"provider_auth_failed"),(429,"provider_quota_exhausted"),(307,"provider_protocol_error"),(500,"provider_protocol_error")])
def test_transport_errors_do_not_expose_provider_body_or_url(status,code):
    import urllib.error
    def transport(*a, **kw):
        raise urllib.error.HTTPError("https://synthetic.invalid/private",status,"synthetic-secret-body",{},None)
    with pytest.raises(AgentError) as caught:
        ChatCompletionModel(transport=transport,model="own").complete(request())
    assert str(caught.value)==code
    assert "synthetic-secret-body" not in str(caught.value)
