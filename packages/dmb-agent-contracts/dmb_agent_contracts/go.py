"""Bounded direct Go transport. No redirects, fallback, or identity spoofing."""
import json
import time
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

import httpx
from .config import validate_go_url
from .model import AgentError, ModelResult
from .chat import provider_usage
from .deadline_http import DeadlineHTTP
from .operation import bind_request,check_operation,reserve_model_attempt,current_operation,operation_scope,physical_activity


class GoModel:
    def __init__(self, *, base_url, api_key, model, protocol="chat_completions", client=None):
        self.base_url = validate_go_url(base_url)
        if not api_key:
            raise ValueError("MODEL_API_KEY is required")
        if protocol != "chat_completions":
            raise AgentError("model_capability_missing", 422)
        self.api_key, self.model = api_key, model
        self.client = client if client is not None else DeadlineHTTP()

    def complete(self, request):
        if current_operation() is None:
            with operation_scope(run_id=request.run_id,deadline_at=request.deadline_at):
                return self._complete(request)
        return self._complete(request)

    def _complete(self, request):
        request=bind_request(request)
        remaining = (request.deadline_at - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            raise AgentError("operation_deadline_exceeded", 504)
        if request.allowed_tools or request.reasoning_effort:
            raise AgentError("model_capability_missing", 422)
        started = time.monotonic()
        payload = {"model": self.model, "messages": [
            {"role": "system", "content": request.system_prompt},
            *[m.model_dump() for m in request.messages]],
            "max_tokens": request.max_output_tokens, "temperature": request.temperature}
        if request.output_schema is not None:
            payload["response_format"] = {"type": "json_object"}
        try:
            reserve_model_attempt()
            with physical_activity():
                headers={"Authorization":"Bearer "+self.api_key,"User-Agent":"Backlog-Coordinator-Agent/1.0",
                    "x-opencode-session":str(uuid5(NAMESPACE_URL,request.conversation_ref or str(request.run_id)))}
                if isinstance(self.client,DeadlineHTTP):
                    status,raw=self.client.request("POST",self.base_url+"/chat/completions",payload=payload,
                        headers=headers,deadline_at=request.deadline_at)
                else:
                    # Explicit service-owned/in-memory transports retain their API;
                    # production defaults use the absolute async deadline above.
                    with self.client.stream("POST",self.base_url+"/chat/completions",json=payload,
                            headers={**headers,"Accept-Encoding":"identity"},timeout=min(remaining,180),follow_redirects=False) as response:
                        status=response.status_code
                        content=bytearray()
                        if status==200:
                            if response.headers.get("content-encoding","identity").lower() not in ("","identity"):
                                raise AgentError("provider_protocol_error",502)
                            for chunk in response.iter_bytes():
                                check_operation()
                                if datetime.now(timezone.utc)>=request.deadline_at:
                                    raise AgentError("operation_deadline_exceeded",504)
                                if len(content)+len(chunk)>4*1024*1024:
                                    raise AgentError("provider_response_too_large",502)
                                content.extend(chunk)
                        raw=bytes(content)
        except httpx.TimeoutException:
            raise AgentError("operation_deadline_exceeded", 504) from None
        except httpx.TransportError:
            raise AgentError("provider_unavailable") from None
        check_operation()
        if datetime.now(timezone.utc)>=request.deadline_at:
            raise AgentError("operation_deadline_exceeded",504)
        if status in (401, 403):
            raise AgentError("provider_auth_failed")
        if status == 429:
            raise AgentError("provider_quota_exhausted")
        if status != 200:
            raise AgentError("provider_protocol_error", 502)
        try:
            data = json.loads(raw)
            choice = data["choices"][0]
            text = choice["message"]["content"]
            if not isinstance(text, str) or choice["finish_reason"] != "stop":
                raise ValueError()
            structured = json.loads(text) if request.output_schema is not None else None
            usage = provider_usage(data)
            return ModelResult(text=text, structured=structured, finish_reason=choice["finish_reason"], usage=usage,
                provider_request_ref=data.get("id"), model_actual=data.get("model", self.model),
                elapsed_ms=int((time.monotonic()-started)*1000))
        except (ValueError, KeyError, TypeError, IndexError):
            raise AgentError("invalid_model_result", 502) from None
