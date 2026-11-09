"""Count real transport attempts, rather than logical domain operations."""
import asyncio
import json
from pathlib import Path
import sys

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]/"scripts"))
from agent_live_transport import InferenceBudget

ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions'


def budget(tmp_path):
    path = tmp_path/'ledger.json'
    path.write_text(json.dumps({'max_calls':40, 'max_seconds':1200,
        'reserved_calls':21, 'reserved_seconds':639}))
    return path, InferenceBudget(path, [ENDPOINT], maximum_seconds=45)


def test_stream_headers_do_not_release_the_time_reservation(tmp_path):
    path, guard = budget(tmp_path)
    class Body(httpx.SyncByteStream):
        def __iter__(self):
            yield b'{"synthetic":true}'
    with guard.installed(), httpx.Client(transport=httpx.MockTransport(
            lambda request:httpx.Response(200, stream=Body()))) as client:
        with client.stream('POST', ENDPOINT, json={'synthetic':True}) as response:
            value = json.loads(path.read_text())
            assert value['reserved_calls'] == 22 and value['reserved_seconds'] == 684
            assert list(response.iter_bytes()) == [b'{"synthetic":true}']
        assert json.loads(path.read_text())['reserved_seconds'] == 640
    assert guard.attempts[0]['outcome'] == 'transport_closed'


def test_partial_stream_and_each_retry_are_charged(tmp_path):
    path, guard = budget(tmp_path)
    class Body(httpx.SyncByteStream):
        def __iter__(self):
            yield b'first'
            yield b'second'
    with guard.installed(), httpx.Client(transport=httpx.MockTransport(
            lambda request:httpx.Response(200, stream=Body()))) as client:
        for _ in range(2):
            with client.stream('POST', ENDPOINT) as response:
                assert next(response.iter_bytes()) == b'first'
    value = json.loads(path.read_text())
    assert value['reserved_calls'] == 23 and value['reserved_seconds'] == 729
    assert all(entry['outcome'] == 'transport_failed' for entry in guard.attempts)


def test_async_non_streaming_and_forbidden_origin(tmp_path):
    path, guard = budget(tmp_path)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request:httpx.Response(200, json={'synthetic':True}))) as client:
            assert (await client.post(ENDPOINT)).json() == {'synthetic':True}
            with pytest.raises(RuntimeError, match='replay_inference_origin_forbidden'):
                await client.post('https://foreign.invalid/chat/completions')
    with guard.installed():
        asyncio.run(run())
    assert json.loads(path.read_text())['reserved_calls'] == 22
    assert guard.attempts[0]['outcome'] == 'transport_closed'


def test_urllib_read1_is_counted_until_eof_and_close(tmp_path, monkeypatch):
    import io
    import urllib.request
    path, guard = budget(tmp_path)
    class Response(io.BytesIO):
        status = 200
        def read1(self, count=-1):
            return self.read(count)
    monkeypatch.setattr(urllib.request.OpenerDirector, 'open',
        lambda *args, **kwargs: Response(b'{"choices":[]}'))
    with guard.installed():
        with urllib.request.build_opener().open(ENDPOINT) as response:
            assert response.read1(65536) == b'{"choices":[]}'
            assert json.loads(path.read_text())['reserved_seconds'] == 684
            assert response.read1(65536) == b''
    assert guard.attempts[0]['outcome'] == 'transport_closed'
    assert guard.attempts[0]['response']['choices'] == []
    assert json.loads(path.read_text())['reserved_seconds'] == 640
