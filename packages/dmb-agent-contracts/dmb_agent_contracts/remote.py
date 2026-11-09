"""Pinned HTTP transformation for isolated, externally provisioned OpenCode.

This adapter never provisions a multi-tenant runtime. Tool profiles remain
unsupported until their per-run isolation and cleanup have been qualified.
The caller MUST commit handle and dispatch intent before calling submit.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from urllib.parse import urlsplit, urlencode
import httpx
from .model import AgentError
from .runtime import RuntimeCapabilities, RuntimeHandle

VERSION = "1.17.13"


class RemoteOpenCode:
    def __init__(self, *, base_url, expected_config, model, agent, client=None, enabled=False, headers=None):
        if not enabled:
            raise AgentError("remote_profile_disabled", 422)
        url = urlsplit(base_url)
        if url.scheme != "https" or url.username or url.password or url.query or url.fragment:
            raise AgentError("runtime_origin_not_allowed", 422)
        self.expected_config, self.model, self.agent = expected_config, model, agent
        self.base_url = base_url.rstrip("/")
        self.headers = dict(headers or {})
        if set(self.headers)-{"Authorization"}:
            raise AgentError("runtime_headers_invalid", 422)
        self.client = client
        self.preparation_dispatched = False

    def _request(self, method, path, body=None):
        try:
            if self.client is not None:
                result = self.client.request(method, path, json=body, follow_redirects=False)
            else:
                from .deadline_http import DeadlineHTTP
                from .operation import current_operation, physical_activity
                deadline = datetime.now(timezone.utc)+timedelta(seconds=15)
                context = current_operation()
                if context is not None and context.deadline_at is not None:
                    deadline = min(deadline, context.deadline_at)
                with physical_activity():
                    status, content = DeadlineHTTP(trust_env=False).request(method, self.base_url+path,
                        payload=body, headers=self.headers, deadline_at=deadline)
                result = httpx.Response(status, content=content)
        except httpx.TransportError:
            raise AgentError("runtime_unavailable") from None
        if not 200 <= result.status_code < 300:
            raise AgentError("runtime_protocol_error", 502)
        if result.status_code != 204:
            try:
                result.json()
            except (ValueError, UnicodeError):
                raise AgentError("runtime_protocol_error", 502) from None
        return result

    def capabilities(self):
        health = self._request("GET", "/global/health").json()
        if not isinstance(health, dict) or health.get("version") != VERSION or health.get("healthy") is not True:
            raise AgentError("runtime_version_unsupported")
        effective = self._request("GET", "/config").json()
        if not isinstance(effective, dict):
            raise AgentError("runtime_protocol_error", 502)
        for key in ("permission", "provider", "enabled_providers", "mcp", "share", "snapshot", "autoupdate"):
            if key not in self.expected_config or effective.get(key) != self.expected_config[key]:
                raise AgentError("runtime_profile_incompatible", 422)
        if effective.get("plugin") or effective.get("instructions"):
            raise AgentError("runtime_profile_incompatible", 422)
        self._validate_tools(effective)
        agents = self._request("GET", "/agent").json()
        self._validate_agents(agents)
        return RuntimeCapabilities(VERSION, True, True, True, True, True, False, False, False)

    def _validate_agents(self, agents):
        if not isinstance(agents, list) or any(not isinstance(agent, dict) for agent in agents):
            raise AgentError("runtime_protocol_error", 502)
        if any(a.get("name") in {"build", "plan", "general", "explore"} for a in agents):
            raise AgentError("runtime_profile_incompatible", 422)
        selected = [a for a in agents if a.get("name") == self.agent and a.get("mode") == "primary"]
        if len(selected) != 1:
            raise AgentError("runtime_profile_incompatible", 422)
        self._validate_agent_permissions(selected[0])

    def _validate_agent_permissions(self, agent):
        # Resolved agent rules can override the global permission configuration.
        # Require the exact no-tools policy on the actual dispatched agent too.
        expected = [
            {"permission": "*", "pattern": "*", "action": "deny"},
            {"permission": "StructuredOutput", "pattern": "*", "action": "allow"},
        ]
        if agent.get("permission") != expected or agent.get("model"):
            raise AgentError("runtime_profile_incompatible", 422)

    def _validate_tools(self, effective):
        if effective.get("permission", {}) != {"*": "deny", "StructuredOutput": "allow"} or effective.get("mcp"):
            raise AgentError("runtime_tool_scoping_unsupported", 422)

    def prepare(self, run_context, tool_grant, result_schema):
        if tool_grant:
            raise AgentError("runtime_tool_scoping_unsupported", 422)
        self.capabilities()
        preparation_ref = run_context.get("preparation_ref") or uuid4().hex
        run_id = str(run_context.get("run_id") or uuid4())
        if not re.fullmatch(r"[a-f0-9]{32}", preparation_ref):
            raise AgentError("runtime_binding_invalid", 503)
        metadata = {"dmb_preparation_ref": preparation_ref, "dmb_run_id": run_id}
        self.preparation_dispatched = True
        try:
            session = self._request("POST", "/session", {"title": "agent-task-"+preparation_ref, "metadata": metadata}).json()
        except AgentError:
            recovered = self.recover_session({"preparation_ref":preparation_ref,"run_id":run_id,
                "message_id":run_context.get("message_id")}, result_schema)
            if recovered is not None:
                return recovered
            raise
        if not isinstance(session, dict) or not isinstance(session.get("id"), str) or not re.fullmatch(r"ses_[a-zA-Z0-9_-]{1,124}", session["id"]):
            raise AgentError("runtime_protocol_error", 502)
        if session.get("metadata") != metadata:
            raise AgentError("runtime_binding_invalid", 503)
        return RuntimeHandle(session["id"], run_context.get("message_id") or "msg_"+uuid4().hex,
            result_schema, preparation_ref=preparation_ref, run_id=run_id)

    def recover_session(self, run_context, result_schema):
        preparation_ref, run_id = run_context["preparation_ref"], str(run_context["run_id"])
        if not re.fullmatch(r"[a-f0-9]{32}", preparation_ref):
            raise AgentError("runtime_binding_invalid", 503)
        entries = self._request("GET", "/session?"+urlencode({"search":"agent-task-"+preparation_ref,"limit":2})).json()
        if not isinstance(entries,list):
            raise AgentError("runtime_protocol_error",502)
        owned = [item for item in entries if isinstance(item,dict) and item.get("metadata") == {
            "dmb_preparation_ref":preparation_ref,"dmb_run_id":run_id}]
        if len(owned)>1:
            raise AgentError("runtime_binding_conflict",503)
        if not owned:
            return None  # Not proof of absence: a timed-out create may still complete.
        identity = owned[0].get("id")
        if not isinstance(identity,str) or not re.fullmatch(r"ses_[a-zA-Z0-9_-]{1,124}",identity):
            raise AgentError("runtime_protocol_error",502)
        return RuntimeHandle(identity,run_context.get("message_id") or "msg_"+uuid4().hex,result_schema,
            preparation_ref=preparation_ref,run_id=run_id)

    def submit(self, handle, task, dispatch_ref):
        if handle.delivery != "not_attempted" or handle.dispatch_ref is not None or handle.cancelled:
            raise AgentError("duplicate_dispatch", 409)
        self._owned_session(handle)
        handle.dispatch_ref = dispatch_ref
        handle.delivery = "unknown"
        body = {"messageID": handle.message_id, "agent": self.agent,
            "model": {"providerID": self.model["providerID"], "modelID": self.model["modelID"]},
            "format": {"type": "json_schema", "schema": handle.schema, "retryCount": 0},
            "parts": [{"type": "text", "text": json.dumps(task, ensure_ascii=False)}]}
        try:
            self._request("POST", f"/session/{handle.session_id}/prompt_async", body)
            handle.delivery = "accepted"
        except AgentError:
            # A response failure is never proof the server did not accept work.
            pass
        return handle.delivery

    def _candidate(self, handle):
        permissions = self._request("GET", "/permission").json()
        if not isinstance(permissions, list):
            raise AgentError("runtime_protocol_error", 502)
        own_permissions = []
        for permission in permissions:
            if not isinstance(permission,dict) or not isinstance(permission.get("sessionID"),str):
                raise AgentError("runtime_protocol_error",502)
            if permission["sessionID"] == handle.session_id:
                own_permissions.append(permission)
            elif getattr(self,"strict_session_scope",False):
                raise AgentError("foreign_session",502)
        if own_permissions:
            self._owned_session(handle)
            for permission in own_permissions:
                if not isinstance(permission, dict) or not isinstance(permission.get("id"), str) or not re.fullmatch(r"per_[a-zA-Z0-9_-]{1,124}", permission["id"]):
                    raise AgentError("runtime_protocol_error", 502)
                self._request("POST", f"/permission/{permission['id']}/reply", {"reply": "reject"})
            raise AgentError("unexpected_permission", 403)
        messages = self._request("GET", f"/session/{handle.session_id}/message?limit=1").json()
        if not isinstance(messages, list) or any(not isinstance(message, dict) or not isinstance(message.get("info"), dict) for message in messages):
            raise AgentError("runtime_protocol_error", 502)
        for message in messages:
            info = message.get("info", {})
            if info.get("sessionID") != handle.session_id:
                raise AgentError("foreign_session", 502)
            if info.get("role") != "assistant":
                continue
            if info.get("parentID") != handle.message_id:
                raise AgentError("foreign_parent_message", 502)
            if info.get("providerID") != self.model["providerID"] or info.get("modelID") != self.model["modelID"]:
                raise AgentError("runtime_model_mismatch", 502)
            if info.get("error"):
                raise AgentError("runtime_execution_failed", 502)
            if not info.get("time", {}).get("completed"):
                continue
            finish = info.get("finish")
            # The pinned runtime finishes StructuredOutput with tool-calls.
            # That is terminal only when it actually supplies a structured
            # candidate; collect still validates the exact service schema.
            if finish not in ("stop", "tool-calls") or (
                finish == "tool-calls" and not isinstance(info.get("structured"), dict)):
                raise AgentError("invalid_model_result", 502)
            parts=message.get('parts')
            if not isinstance(parts,list):
                raise AgentError('runtime_protocol_error',502)
            if parts and (not isinstance(info.get('id'),str) or not info['id']):
                raise AgentError('runtime_protocol_error',502)
            identifiers=set()
            for part in parts:
                if not isinstance(part,dict) or not isinstance(part.get('id'),str) or not part['id']:
                    raise AgentError('runtime_protocol_error',502)
                if part.get('sessionID')!=handle.session_id or part.get('messageID')!=info.get('id'):
                    raise AgentError('foreign_message_part',502)
                if part['id'] in identifiers:
                    raise AgentError('runtime_protocol_error',502)
                identifiers.add(part['id'])
            return message
        return None

    def inspect(self, handle):
        if handle.cancelled:
            return "cancelled"
        return "completed" if self._candidate(handle) is not None else "running"

    def observe(self, handle, cursor=None):
        # Explicit status-only mode; no raw provider events/reasoning are exposed.
        return [{"type": "status", "status": self.inspect(handle)}]

    def collect(self, handle):
        if handle.cancelled:
            raise AgentError("already_terminal", 409)
        candidate = self._candidate(handle)
        if candidate is None:
            raise AgentError("run_not_ready", 409)
        try:
            payload = candidate["info"].get("structured")
            if payload is None:
                payload = json.loads("".join(p["text"] for p in candidate.get("parts", []) if p.get("type") == "text"))
            # Validation by the exact service-owned schema, not just JSON parsing.
            import jsonschema
            jsonschema.Draft202012Validator(handle.schema).validate(payload)
            return payload
        except (ValueError, KeyError, TypeError, jsonschema.ValidationError):
            raise AgentError("invalid_model_result", 502) from None

    def cancel(self, handle, reason):
        handle.cancelled = True  # Publication is forbidden even when abort fails.
        from .operation import runtime_cleanup_scope
        with runtime_cleanup_scope():
            self._owned_session(handle)
            self._request("POST", f"/session/{handle.session_id}/abort")
        return {"publication_forbidden": True, "cleanup": "pending"}

    def dispose(self, handle):
        from .operation import runtime_cleanup_scope
        with runtime_cleanup_scope():
            return self._dispose(handle)

    def _dispose(self, handle):
        try:
            self._owned_session(handle)
            response = self._request("DELETE", f"/session/{handle.session_id}")
            if response.json() is not True:
                raise AgentError("cleanup_unconfirmed")
            handle.cleanup = "confirmed"
        except AgentError:
            handle.cleanup = "failed"
        return {"cleanup": handle.cleanup}

    def _owned_session(self, handle):
        session = self._request("GET", f"/session/{handle.session_id}").json()
        if not handle.preparation_ref or not isinstance(session,dict) or session.get("metadata") != {
            "dmb_preparation_ref":handle.preparation_ref,"dmb_run_id":handle.run_id}:
            raise AgentError("runtime_binding_invalid",503)
