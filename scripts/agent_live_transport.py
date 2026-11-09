"""Count actual inference IO, including retries, until transport close.

Installed only inside an isolated synthetic product-replay worker. No keys,
headers or prompt text enter the attempt log. The existing ledger is mandatory.
"""
import hashlib
import json
import threading
import time
import urllib.request
from contextlib import contextmanager
from urllib.parse import urlsplit

import httpx

from agent_live_budget import LiveBudget


class InferenceBudget:
    def __init__(self, ledger, endpoints, *, maximum_seconds=180):
        self.budget = LiveBudget(ledger)
        self.endpoints = set(endpoints)
        self.maximum_seconds = maximum_seconds
        self.attempts = []
        for endpoint in self.endpoints:
            from dmb_agent_contracts.config import validate_go_url
            if not endpoint.endswith('/chat/completions'):
                raise ValueError('replay_endpoint_invalid')
            validate_go_url(endpoint[:-len('/chat/completions')])

    def selected(self, url):
        value = urlsplit(str(url))
        if value.path.rstrip('/').endswith(('/chat/completions', '/responses')):
            if str(url) not in self.endpoints:
                raise RuntimeError('replay_inference_origin_forbidden')
            return True
        return False

    def reserve(self, body):
        reservation = self.budget.request(self.maximum_seconds)
        reservation_info = reservation.__enter__()
        entry = {'attempt':len(self.attempts)+1, 'budget_reservation_ref':reservation_info['reservation_ref'],
                 'budget_call_number':reservation_info['call_number'], 'reserved_seconds_limit':self.maximum_seconds, 'request_sha256':hashlib.sha256(body or b'').hexdigest(),
                 'outcome':'unknown'}
        try:
            request = json.loads(body or b'{}')
            if isinstance(request,dict):
                entry['request'] = request  # Synthetic worker only; never headers.
        except (ValueError,TypeError):
            pass
        self.attempts.append(entry)
        started = time.monotonic()
        lock = threading.Lock()
        closed = False

        def finish(error=None, content=None, status=None):
            nonlocal closed
            with lock:
                if closed:
                    return
                closed = True
                entry.update(outcome='transport_failed' if error else 'transport_closed',
                             elapsed_seconds=round(time.monotonic()-started, 3))
                if status is not None:
                    entry['http_status'] = status
                if content is not None:
                    entry['response_sha256'] = hashlib.sha256(content).hexdigest()
                    try:
                        result = json.loads(content)
                        if not error and isinstance(result,dict) and isinstance(result.get('choices'),list):
                            safe = {key:result[key] for key in ('id','model','usage') if key in result}
                            safe['choices'] = []
                            for choice in result['choices']:
                                message = choice.get('message',{})
                                safe['choices'].append({key:choice.get(key) for key in ('index','finish_reason')})
                                safe['choices'][-1]['message'] = {key:message[key] for key in ('role','content','tool_calls') if key in message}
                            entry['response'] = safe
                    except (ValueError,TypeError,AttributeError):
                        pass
                reservation.__exit__(type(error) if error else None, error, None)
        return finish

    @contextmanager
    def installed(self):
        owner = self
        sync_send, async_send, opener = httpx.Client.send, httpx.AsyncClient.send, urllib.request.OpenerDirector.open
        redirect = urllib.request.HTTPRedirectHandler.redirect_request

        class SyncStream(httpx.SyncByteStream):
            def __init__(self, source, finish, status):
                self.source, self.finish, self.error, self.complete = source, finish, None, False
                self.content, self.status = bytearray(), status
            def __iter__(self):
                try:
                    for chunk in self.source:
                        if len(self.content)+len(chunk)>4*1024*1024:
                            raise RuntimeError('synthetic_replay_response_too_large')
                        self.content.extend(chunk)
                        yield chunk
                    self.complete = True
                except BaseException as error:
                    self.error = error
                    raise
            def close(self):
                try:
                    self.source.close()
                except BaseException as error:
                    self.error = error
                    raise
                finally:
                    self.finish(self.error or (None if self.complete else RuntimeError("incomplete_inference_stream")), bytes(self.content), self.status)

        class AsyncStream(httpx.AsyncByteStream):
            def __init__(self, source, finish, status):
                self.source, self.finish, self.error, self.complete = source, finish, None, False
                self.content, self.status = bytearray(), status
            async def __aiter__(self):
                try:
                    async for chunk in self.source:
                        if len(self.content)+len(chunk)>4*1024*1024:
                            raise RuntimeError('synthetic_replay_response_too_large')
                        self.content.extend(chunk)
                        yield chunk
                    self.complete = True
                except BaseException as error:
                    self.error = error
                    raise
            async def aclose(self):
                try:
                    await self.source.aclose()
                except BaseException as error:
                    self.error = error
                    raise
                finally:
                    self.finish(self.error or (None if self.complete else RuntimeError("incomplete_inference_stream")), bytes(self.content), self.status)

        def send(client, request, **options):
            if not owner.selected(request.url):
                return sync_send(client, request, **options)
            if options.get("follow_redirects") is True or options.get("follow_redirects") is None and client.follow_redirects:
                raise RuntimeError("replay_inference_redirect_forbidden")
            finish = owner.reserve(request.content)
            stream = options.pop('stream', False)
            options['follow_redirects'] = False
            try:
                response = sync_send(client, request, stream=True, **options)
                if response.is_closed:
                    finish(content=response.content,status=response.status_code)
                else:
                    response.stream = SyncStream(response.stream, finish,response.status_code)
                if not stream:
                    response.read()
                return response
            except BaseException as error:
                finish(error)
                raise

        async def asend(client, request, **options):
            if not owner.selected(request.url):
                return await async_send(client, request, **options)
            if options.get("follow_redirects") is True or options.get("follow_redirects") is None and client.follow_redirects:
                raise RuntimeError("replay_inference_redirect_forbidden")
            finish = owner.reserve(request.content)
            stream = options.pop('stream', False)
            options['follow_redirects'] = False
            try:
                response = await async_send(client, request, stream=True, **options)
                if response.is_closed:
                    finish(content=response.content,status=response.status_code)
                else:
                    response.stream = AsyncStream(response.stream, finish,response.status_code)
                if not stream:
                    await response.aread()
                return response
            except BaseException as error:
                finish(error)
                raise

        class UrllibResponse:
            def __init__(self, response, finish):
                self.response, self.finish, self.error, self.complete = response, finish, None, False
                self.content, self.status = bytearray(), getattr(response,'status',None)
            def __getattr__(self, name):
                return getattr(self.response, name)
            def read(self, *args):
                return self._read('read', *args)
            def readline(self, *args):
                return self._read('readline', *args)
            def read1(self, *args):
                return self._read('read1', *args)
            def _read(self, name, *args):
                try:
                    value = getattr(self.response, name)(*args)
                    if len(self.content)+len(value)>4*1024*1024:
                        raise RuntimeError('synthetic_replay_response_too_large')
                    self.content.extend(value)
                    if not value or name == "read" and (not args or args[0] is None or args[0] < 0):
                        self.complete = True
                    return value
                except BaseException as error:
                    self.error = error
                    raise
            def close(self):
                try:
                    self.response.close()
                except BaseException as error:
                    self.error = error
                    raise
                finally:
                    self.finish(self.error or (None if self.complete else RuntimeError("incomplete_inference_stream")), bytes(self.content), self.status)
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.close()

        def open_url(instance, request, data=None, timeout=60):
            url = request.full_url if hasattr(request, 'full_url') else request
            if not owner.selected(url):
                return opener(instance, request, data, timeout)
            finish = owner.reserve(data or getattr(request, 'data', None))
            try:
                return UrllibResponse(opener(instance, request, data, timeout), finish)
            except BaseException as error:
                finish(error)
                raise

        def redirect_request(instance, request, *args, **kwargs):
            if owner.selected(request.full_url):
                raise RuntimeError("replay_inference_redirect_forbidden")
            return redirect(instance, request, *args, **kwargs)

        httpx.Client.send, httpx.AsyncClient.send, urllib.request.OpenerDirector.open = send, asend, open_url
        urllib.request.HTTPRedirectHandler.redirect_request = redirect_request
        try:
            yield self
        finally:
            httpx.Client.send, httpx.AsyncClient.send, urllib.request.OpenerDirector.open = sync_send, async_send, opener
            urllib.request.HTTPRedirectHandler.redirect_request = redirect
