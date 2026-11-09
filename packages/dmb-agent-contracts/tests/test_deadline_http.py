import asyncio
import time
from datetime import datetime,timedelta,timezone
from uuid import uuid4

import httpx
import pytest
from dmb_agent_contracts.deadline_http import DeadlineHTTP
from dmb_agent_contracts.go import GoModel
from dmb_agent_contracts.model import AgentError,ModelRequest


def request(seconds=.15):
    return ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose="extraction",messages=[{"role":"user","content":"Synthetic"}],
        system_prompt="JSON",output_schema={},model_profile="synthetic",max_output_tokens=100,
        deadline_at=datetime.now(timezone.utc)+timedelta(seconds=seconds))


def model(handler,limit=4*1024*1024):
    return GoModel(base_url="https://opencode.ai/zen/go/v1",api_key="synthetic",model="synthetic",
        client=DeadlineHTTP(transport=httpx.MockTransport(handler),max_response_bytes=limit))


def test_slow_response_headers_cannot_extend_absolute_deadline():
    cancelled=[]
    async def provider(_):
        try:
            await asyncio.sleep(2)
        finally:
            cancelled.append(True)
    started=time.monotonic()
    with pytest.raises(AgentError,match="operation_deadline_exceeded"):
        model(provider).complete(request())
    assert time.monotonic()-started<1 and cancelled==[True]


def test_dripping_body_is_cancelled_and_closed_before_return():
    closed=[]
    class Drip(httpx.AsyncByteStream):
        async def __aiter__(self):
            while True:
                await asyncio.sleep(.01)
                yield b"x"
        async def aclose(self):
            closed.append(True)
    async def provider(_):
        return httpx.Response(200,stream=Drip())
    started=time.monotonic()
    with pytest.raises(AgentError,match="operation_deadline_exceeded"):
        model(provider).complete(request())
    assert time.monotonic()-started<1 and closed==[True]


def test_body_size_is_bounded_before_json_and_socket_is_closed():
    closed=[]
    class Large(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"x"*1024
            pytest.fail("transport read beyond size limit")
        async def aclose(self):
            closed.append(True)
    async def provider(_):
        return httpx.Response(200,stream=Large())
    with pytest.raises(AgentError,match="provider_response_too_large"):
        model(provider,limit=100).complete(request(2))
    assert closed==[True]


def test_sync_model_port_inside_an_event_loop_waits_for_http_cleanup():
    async def provider(_):
        return httpx.Response(200,json={"choices":[{"message":{"content":"{\"items\":[]}"},"finish_reason":"stop"}]})
    async def caller():
        return model(provider).complete(request(2))
    assert asyncio.run(caller()).structured=={"items":[]}


def test_error_response_body_is_never_consumed_or_echoed():
    class Private(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("private provider body was read")
            yield b"synthetic-private"
    async def provider(_):
        return httpx.Response(401,stream=Private())
    with pytest.raises(AgentError,match="provider_auth_failed") as error:
        model(provider).complete(request(2))
    assert "synthetic-private" not in str(error.value)
