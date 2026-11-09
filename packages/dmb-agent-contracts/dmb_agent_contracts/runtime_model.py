"""ModelPort over the qualified no-tools RuntimePort; product workflow stays local."""
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from .model import AgentError, ModelResult, Usage
from .operation import bind_request, current_operation, operation_scope, runtime_cleanup_scope


class RuntimeModel:
    def __init__(self, runtime_factory, *, model_actual, profile_ref="contract-emulator"):
        self.runtime_factory, self.model_actual = runtime_factory, model_actual
        self.profile_ref = profile_ref

    def complete(self, request):
        if current_operation() is None:
            with operation_scope(run_id=request.run_id, deadline_at=request.deadline_at):
                return self._complete(request)
        return self._complete(request)

    def _complete(self, request):
        request = bind_request(request)
        context = current_operation()
        expected_profile = getattr(context,"model_profile_ref",None)
        if expected_profile is not None and expected_profile != self.profile_ref:
            raise AgentError("runtime_profile_changed",503)
        checkpoint = getattr(context, "runtime_checkpoint", None)
        if checkpoint is None:
            raise AgentError("runtime_checkpoint_required", 503)
        if request.allowed_tools:
            raise AgentError("model_capability_missing", 422)
        runtime, handle = self.runtime_factory(), None
        schema = request.output_schema if request.output_schema is not None else {
            "type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"], "additionalProperties": False}
        started = time.monotonic()
        cleanup_token = context.hold_slot_for_cleanup()
        prepare_context = {"run_id":str(request.run_id),"deadline_at":request.deadline_at,
            "preparation_ref":request.request_id.hex,"message_id":"msg_"+uuid4().hex}
        pending = {"session_id":None,"message_id":prepare_context["message_id"],"dispatch_ref":None,
            "delivery":"not_attempted","cleanup":"pending","cancelled":False,
            "profile_ref":self.profile_ref,"preparation_ref":prepare_context["preparation_ref"]}

        def record(*, owner_finished=False):
            if handle is None:
                return checkpoint(request, {**pending, "owner_finished":owner_finished})
            checkpoint(request, {"session_id": handle.session_id, "message_id": handle.message_id,
                "dispatch_ref": handle.dispatch_ref, "delivery": handle.delivery,
                "cleanup": handle.cleanup, "cancelled": handle.cancelled, "profile_ref": self.profile_ref,
                "preparation_ref":handle.preparation_ref, "owner_finished":owner_finished})

        try:
            record()  # Durable resource identity precedes even session creation.
            handle = runtime.prepare(prepare_context, {}, schema)
            record()
            context.reserve_model_attempt()
            # Commit intent BEFORE the actual prompt. Unknown outcomes never retry submit.
            dispatch = str(uuid4())
            handle.dispatch_ref, handle.delivery = dispatch, "unknown"
            record()
            handle.dispatch_ref, handle.delivery = None, "not_attempted"
            runtime.submit(handle, {"system_prompt": request.system_prompt,
                "messages": [message.model_dump() for message in request.messages],
                "max_output_tokens": request.max_output_tokens, "temperature": request.temperature}, dispatch)
            record()
            while runtime.inspect(handle) != "completed":
                context.check()
                time.sleep(.05)
            context.check()
            payload = runtime.collect(handle)
            handle.delivery = "accepted"
            record()
            text = json.dumps(payload, ensure_ascii=False) if request.output_schema is not None else payload["text"]
            return ModelResult(text=text, structured=payload if request.output_schema is not None else None,
                finish_reason="stop", usage=Usage(unavailable_reason="runtime_not_reported"),
                model_actual=self.model_actual, attempt_count=1, elapsed_ms=int((time.monotonic()-started)*1000))
        finally:
            with runtime_cleanup_scope():
                if handle is None:
                    if not runtime.preparation_dispatched:
                        pending["cleanup"] = "confirmed"
                        try:
                            record(owner_finished=True)
                        finally:
                            context.confirm_cleanup(cleanup_token)
                    else:
                        try:
                            handle = runtime.recover_session(prepare_context, schema)
                        except AgentError:
                            pass  # Keep the durable intent and slot for a later janitor.
                        if handle is None:
                            record(owner_finished=True)
                if handle is not None:
                    try:
                        if handle.cleanup != "confirmed":
                            runtime.cancel(handle, "bounded_operation_finished")
                    except Exception:
                        pass
                    cleanup = runtime.dispose(handle)
                    # Cleanup receipts must persist even after a cancellation fence.
                    try:
                        record(owner_finished=True)
                    finally:
                        if cleanup.get("cleanup") == "confirmed":
                            context.confirm_cleanup(cleanup_token)
