"""Absolute HTTP deadline and bounded response bytes, including slow headers."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import datetime, timezone

import httpx

from .model import AgentError


class DeadlineHTTP:
    def __init__(self, transport=None, max_response_bytes=4*1024*1024, trust_env=True):
        self.transport = transport
        self.max_response_bytes = max_response_bytes
        self.trust_env = trust_env

    async def _exchange(self, method, url, *, payload, headers, deadline_at):
        remaining = (deadline_at-datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            raise AgentError("operation_deadline_exceeded", 504)
        try:
            async with asyncio.timeout(remaining):
                async with httpx.AsyncClient(transport=self.transport, follow_redirects=False,trust_env=self.trust_env,
                        timeout=min(remaining,180)) as client:
                    async with client.stream(method,url,json=payload,
                            headers={**headers,"Accept-Encoding":"identity"}) as response:
                        if not 200 <= response.status_code < 300:
                            return response.status_code, b""
                        if response.headers.get("content-encoding","identity").lower() not in ("", "identity"):
                            raise AgentError("provider_protocol_error",502)
                        length=response.headers.get("content-length")
                        if length is not None:
                            try:
                                declared=int(length)
                            except ValueError:
                                raise AgentError("provider_protocol_error",502) from None
                            if declared<0:
                                raise AgentError("provider_protocol_error",502)
                            if declared>self.max_response_bytes:
                                raise AgentError("provider_response_too_large",502)
                        content=bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(content)+len(chunk)>self.max_response_bytes:
                                raise AgentError("provider_response_too_large",502)
                            content.extend(chunk)
                        return response.status_code,bytes(content)
        except (TimeoutError,httpx.TimeoutException):
            raise AgentError("operation_deadline_exceeded",504) from None
        except httpx.TransportError:
            raise AgentError("provider_unavailable",503) from None

    async def _request(self, method, url, *, payload, headers, deadline_at):
        from .operation import current_operation
        context=current_operation()
        exchange=asyncio.create_task(self._exchange(method,url,payload=payload,headers=headers,deadline_at=deadline_at))
        async def watch():
            while True:
                if context is not None:
                    context.check()
                await asyncio.sleep(.05)
        watchdog=asyncio.create_task(watch())
        try:
            done,_=await asyncio.wait({exchange,watchdog},return_when=asyncio.FIRST_COMPLETED)
            if watchdog in done:
                await watchdog
            return await exchange
        finally:
            exchange.cancel()
            watchdog.cancel()
            # Confirm network cancellation before the operation releases its slot.
            await asyncio.gather(exchange,watchdog,return_exceptions=True)

    def request(self, method, url, *, payload, headers, deadline_at):
        async def call():
            return await self._request(method,url,payload=payload,headers=headers,deadline_at=deadline_at)
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(call())
        # The public port is synchronous. Wait for actual cancellation and socket
        # cleanup in its own loop rather than returning with a live HTTP thread.
        context=copy_context()
        with ThreadPoolExecutor(max_workers=1,thread_name_prefix="agent-http-deadline") as pool:
            return pool.submit(context.run,lambda:asyncio.run(call())).result()

    def close(self):
        pass  # Every request closes its client/socket before returning.

    async def aclose(self):
        pass
