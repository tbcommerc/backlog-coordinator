"""Shared stdlib transport primitives; bounded reads and no provider redirects."""
import time
import urllib.error
import urllib.request
from .model import AgentError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url,code,"Provider redirect refused",{},None)


def open_http(request,timeout):
    return urllib.request.build_opener(NoRedirect()).open(request,timeout=timeout)


def _remaining(response,deadline):
    remaining=deadline-time.monotonic()
    if remaining<=0:
        raise AgentError("operation_deadline_exceeded",504)
    # HTTPResponse.read1 returns available bytes. Reset the socket timeout for
    # each receive so progress does not extend the absolute operation deadline.
    raw=getattr(getattr(response,"fp",None),"raw",None)
    sock=getattr(raw,"_sock",None)
    if sock is not None:
        sock.settimeout(remaining)


def response_chunks(response,deadline,max_bytes=4*1024*1024):
    total=0
    if not hasattr(response,"read1"):
        # Explicit in-memory response fixtures implement only read().
        _remaining(response,deadline)
        data=response.read()
        if len(data)>max_bytes:
            raise AgentError("provider_response_too_large",502)
        yield data
        return
    while True:
        _remaining(response,deadline)
        chunk=response.read1(min(65536,max_bytes-total+1))
        if not chunk:
            return
        total+=len(chunk)
        if total>max_bytes:
            raise AgentError("provider_response_too_large",502)
        yield chunk


def response_bytes(response,deadline,max_bytes=4*1024*1024):
    return b"".join(response_chunks(response,deadline,max_bytes))


def sse_lines(response,deadline):
    if not hasattr(response,"read1"):
        for line in response:
            _remaining(response,deadline)
            if len(line)>65536:
                raise AgentError("provider_response_too_large",502)
            yield line
        return
    pending=b""
    for chunk in response_chunks(response,deadline):
        pending+=chunk
        while b"\n" in pending:
            line,pending=pending.split(b"\n",1)
            if len(line)>65536:
                raise AgentError("provider_response_too_large",502)
            yield line
        if len(pending)>65536:
            raise AgentError("provider_response_too_large",502)
    if pending:
        yield pending
