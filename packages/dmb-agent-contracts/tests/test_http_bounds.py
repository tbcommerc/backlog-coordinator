import io
import pytest
from dmb_agent_contracts import http
from dmb_agent_contracts.model import AgentError


def test_response_size_is_bounded():
    with pytest.raises(AgentError,match="provider_response_too_large"):
        http.response_bytes(io.BytesIO(b"x"*100),deadline=http.time.monotonic()+5,max_bytes=50)


def test_progress_cannot_extend_deadline(monkeypatch):
    clock=[0.0]
    class Slow:
        def read1(self,limit):
            clock[0]+=.6
            return b"progress"
    monkeypatch.setattr(http.time,"monotonic",lambda:clock[0])
    with pytest.raises(AgentError,match="operation_deadline_exceeded"):
        http.response_bytes(Slow(),deadline=1)


def test_sse_utf8_and_split_frames_are_preserved():
    raw='data: {"text":"Синтетический ответ"}\n\ndata: [DONE]\n'.encode()
    class Split:
        def __init__(self): self.position=0
        def read1(self,limit):
            result=raw[self.position:self.position+3]
            self.position+=3
            return result
    lines=list(http.sse_lines(Split(),http.time.monotonic()+5))
    assert lines==raw.splitlines()


def test_sse_line_without_newline_cannot_grow_unbounded():
    with pytest.raises(AgentError,match="provider_response_too_large"):
        list(http.sse_lines(io.BytesIO(b"x"*70000),http.time.monotonic()+5))
