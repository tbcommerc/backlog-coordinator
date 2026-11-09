"""Typed Chat Completions boundary over a service-owned HTTP transport.

The service retains its workflow and domain validation. The transport receives
one remaining deadline, rather than a fresh timeout for each retry.
"""
import json
import time
from datetime import datetime, timezone

from .model import AgentError, ModelResult, Usage
from .operation import bind_request,check_operation,current_operation,operation_scope,physical_activity


def provider_usage(data):
    raw = data.get("usage") or {}
    details_in = raw.get("prompt_tokens_details") or {}
    details_out = raw.get("completion_tokens_details") or {}
    go_usage = raw.get("opencode") or {}
    values = dict(input_tokens=raw.get("prompt_tokens"), output_tokens=raw.get("completion_tokens"),
                  cache_tokens=details_in.get("cached_tokens"), reasoning_tokens=details_out.get("reasoning_tokens"),
                  cost=raw.get("cost"), allowance=go_usage.get("allowance"))
    return Usage(**values, unavailable_reason=("provider_not_reported" if not raw else
                 "provider_partial_usage" if any(value is None for value in values.values()) else None))


class ChatCompletionModel:
    def __init__(self, *, transport, model, response_meta=None):
        self.transport, self.model = transport, model
        self.response_meta = response_meta if response_meta is not None else {}

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
        if request.allowed_tools:
            raise AgentError("model_capability_missing", 422)
        payload = {"model": self.model,
                   "messages": ([{"role": "system", "content": request.system_prompt}] if request.system_prompt else [])
                   + [message.model_dump() for message in request.messages],
                   "temperature": request.temperature, "max_tokens": request.max_output_tokens}
        if request.output_schema is not None:
            payload["response_format"] = {"type": "json_object"}
        if request.reasoning_effort:
            payload["reasoning_effort"] = request.reasoning_effort
        started = time.monotonic()
        try:
            with physical_activity():
                data = self.transport("/chat/completions", payload, timeout=remaining)
        except AgentError:
            raise
        except Exception as error:
            # urllib and httpx carry status in different fields. Never expose their
            # request URL, provider body or headers through the common boundary.
            status = getattr(error, "code", None)
            if not isinstance(status, int):
                status = getattr(getattr(error, "response", None), "status_code", None)
            if isinstance(status, int):
                code = ("provider_auth_failed" if status in (401,403) else
                        "provider_quota_exhausted" if status == 429 else "provider_protocol_error")
                raise AgentError(code, 503 if status in (401,403,429) else 502) from None
            raise
        check_operation()
        if datetime.now(timezone.utc) >= request.deadline_at:
            raise AgentError("operation_deadline_exceeded", 504)
        try:
            choice = data["choices"][0]
            finish = choice.get("finish_reason")
            self.response_meta["finish_reason"] = finish
            if finish == "length":
                raise AgentError("model_result_incomplete", 502)
            if finish != "stop":
                raise AgentError("invalid_model_result", 502)
            text = choice["message"]["content"]
            if not isinstance(text, str):
                raise ValueError()
            structured = json.loads(text) if request.output_schema is not None else None
            if request.output_schema is not None and not isinstance(structured, dict):
                raise ValueError()
            return ModelResult(text=text, structured=structured, finish_reason=finish,
                               usage=provider_usage(data), provider_request_ref=data.get("id"),
                               model_actual=data.get("model") or self.model,
                               attempt_count=self.response_meta.get("attempt_count", 1),
                               elapsed_ms=int((time.monotonic()-started)*1000))
        except AgentError:
            raise
        except (ValueError, TypeError, KeyError, IndexError, AttributeError):
            raise AgentError("invalid_model_result", 502) from None
