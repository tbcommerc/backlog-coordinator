"""Pinned OpenCode HTTP adapter. No OpenCode identifiers cross the product API."""
import json
import asyncio
import time
import uuid
from datetime import datetime, timezone
from copy import deepcopy
from pathlib import Path
import httpx
from contracts.models import Answer
from contracts.catalog import compact_schema

VERSION = "1.17.13"
PROMPT = Path(__file__).with_name("system.txt").read_text(encoding="utf-8")


def config(model, model_url, bridge_url, bridge_token, tool_names):
    permissions = {"*": "deny", "StructuredOutput": "allow"}
    permissions.update({"dmb_" + name: "allow" for name in tool_names})
    return {
        "$schema": "https://opencode.ai/config.json", "model": "controlled/" + model,
        "enabled_providers": ["controlled"], "share": "disabled", "autoupdate": False, "snapshot": False,
        "plugin": [], "instructions": [], "permission": permissions,
        "provider": {"controlled": {"npm": "@ai-sdk/openai-compatible", "name": "Controlled provider",
            "options": {"baseURL": model_url, "apiKey": bridge_token},
            "models": {model: {"name": model, "limit": {"context": 16000, "output": 3000}}}}},
        "agent": {"backlog_assistant": {"mode": "primary", "prompt": PROMPT, "steps": 6,
            "permission": permissions}, "build": {"disable": True}, "plan": {"disable": True},
            "general": {"disable": True}, "explore": {"disable": True}},
        "mcp": {"dmb": {"type": "remote", "url": bridge_url, "oauth": False,
            "headers": {"Authorization": "Bearer " + bridge_token}}},
    }


def generation_schema(schema):
    """Service-owned evidence metadata is assembled by the adapter, never invented."""
    result = deepcopy(schema)
    for key in ("context", "as_of", "coverage", "sources", "summary_claims", "actions", "followups", "limitations"):
        result.get("properties", {}).pop(key, None)
        if key in result.get("required", []):
            result["required"].remove(key)
    result["properties"].pop("schema_version", None)
    result["properties"]["clarification"]["description"] = "For kind=clarification provide a nonempty question and up to five options. Otherwise null."
    result["required"] = ["kind", "data_blocks", "clarification"]
    result = compact_schema(result)
    result["properties"]["data_blocks"]["items"]["properties"]["server_result_ref"].update(
        pattern="^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        description="Exact snapshot_ref returned by an actual tool call. Never an object ID or a proposed call.")
    return result


class OpenCodeRuntime:
    def __init__(self, launcher, *, model, client_factory=None):
        self.launcher, self.model = launcher, model
        self.client_factory = client_factory or (lambda instance: httpx.AsyncClient(
            base_url=instance["endpoint"], auth=("opencode", instance["password"]),
            timeout=15, trust_env=False, follow_redirects=False))
        self.clients = {}
        self.bridges = {}

    async def prepare(self, context, bridge, schema):
        instance = await self.launcher.launch(context, bridge, self.model)
        client = self.client_factory(instance)
        handle = {"instance": instance["id"], "session": None, "message": "msg_" + uuid.uuid4().hex,
                  "schema": schema, "dispatch_attempted": False}
        self.clients[instance["id"]], self.bridges[instance["id"]] = client, bridge
        try:
            health = (await self._request(handle, "GET", "/global/health")).json()
            if not health.get("healthy") or health.get("version") != VERSION:
                raise ValueError("runtime_version_mismatch")
            effective = (await self._request(handle, "GET", "/config")).json()
            expected = instance["config"]
            for field in ("permission", "mcp", "provider", "enabled_providers", "share", "snapshot", "autoupdate"):
                if effective.get(field) != expected[field]:
                    raise ValueError("runtime_config_mismatch")
            if effective.get("plugin") or effective.get("instructions"):
                raise ValueError("runtime_config_contaminated")
            agents = (await self._request(handle, "GET", "/agent")).json()
            if not any(a.get("name") == "backlog_assistant" and a.get("mode") == "primary" for a in agents):
                raise ValueError("primary_agent_missing")
            if any(a.get("name") in {"build", "plan", "general", "explore"} for a in agents):
                raise ValueError("unexpected_agent")
            session = (await self._request(handle, "POST", "/session", {"title": "Backlog question"})).json()
            handle["session"] = session["id"]
            return handle
        except BaseException:
            await self.dispose(handle)
            raise

    async def _request(self, handle, method, path, body=None):
        response = await self.clients[handle["instance"]].request(method, path, json=body)
        response.raise_for_status()
        return response

    async def submit(self, handle, envelope, dispatch_ref):
        if handle["dispatch_attempted"]:
            raise ValueError("duplicate_dispatch")
        await self.bridges[handle["instance"]].check()
        self.bridges[handle["instance"]].bind_request(envelope.get("text", ""))
        handle["dispatch_attempted"] = True
        handle["context"] = envelope.get("context", {})
        body = {"messageID": handle["message"], "agent": "backlog_assistant",
            "model": {"providerID": "controlled", "modelID": self.model},
            "format": {"type": "json_schema", "schema": generation_schema(handle["schema"]), "retryCount": 1},
            "parts": [{"type": "text", "text": json.dumps(envelope, ensure_ascii=False)}]}
        try:
            await self._request(handle, "POST", f"/session/{handle['session']}/prompt_async", body)
            return "accepted"
        except (httpx.TimeoutException, httpx.NetworkError):
            # Unknown delivery: caller polls the same instance, NEVER resubmits.
            return "unknown"

    async def _messages(self, handle):
        # The pinned v1 list cannot serialize a user's stored OutputFormatJsonSchema.
        # One-turn instances need only the latest assistant message; its parent/session
        # are still checked below. Before an assistant exists, the specific encoding
        # defect is treated as pending delivery, never as a reason to resubmit.
        try:
            return (await self._request(handle, "GET", f"/session/{handle['session']}/message?limit=1")).json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 400 and "Expected OutputFormatJsonSchema" in exc.response.text:
                return []
            raise

    async def inspect(self, handle):
        await self.bridges[handle["instance"]].check()
        permissions = (await self._request(handle, "GET", "/permission")).json()
        if permissions:
            for permission in permissions:
                await self._request(handle, "POST", f"/permission/{permission['id']}/reply", {"reply": "reject"})
            raise ValueError("unexpected_permission")
        messages = await self._messages(handle)
        for message in reversed(messages):
            info = message.get("info", {})
            if info.get("sessionID") != handle["session"]:
                raise ValueError("foreign_session")
            if info.get("role") == "assistant" and info.get("parentID") == handle["message"]:
                if info.get("error"):
                    return "failed"
                if info.get("time", {}).get("completed") and (info.get("structured") is not None or info.get("finish") not in (None, "tool-calls", "unknown")):
                    return "completed"
        return "running"

    async def observe(self, handle, cursor=None):
        state = await self.inspect(handle)
        return [{"type": "candidate_ready" if state == "completed" else "progress", "stage": state}]

    async def collect(self, handle):
        try:
            return await self._collect(handle)
        except ValueError:
            bridge = self.bridges[handle["instance"]]
            await bridge.check()
            # Evidence-backed fallback is handled by the worker. Only repair a
            # completed, invalid response with no reads; never resend unknown delivery.
            if bridge.results or handle.get("format_repairs"):
                raise
            handle["format_repairs"] = 1
            handle["message"] = "msg_" + uuid.uuid4().hex
            body = {"messageID": handle["message"], "agent": "backlog_assistant",
                "model": {"providerID": "controlled", "modelID": self.model},
                "format": {"type": "json_schema", "schema": generation_schema(handle["schema"]), "retryCount": 1},
                "parts": [{"type": "text", "text": "Предыдущий ответ не прошёл проверку. Для ответа сначала вызови реальный инструмент чтения по исходному вопросу и используй его snapshot_ref. Если вопрос неоднозначен, верни clarification с непустым clarification.question. Не выдумывай ссылки на результаты."}]}
            try:
                await self._request(handle, "POST", f"/session/{handle['session']}/prompt_async", body)
            except (httpx.TimeoutException, httpx.NetworkError):
                pass  # Poll the same message after unknown delivery; never resubmit.
            while await self.inspect(handle) == "running":
                await asyncio.sleep(.2)
            return await self._collect(handle)

    async def _collect(self, handle):
        await self.bridges[handle["instance"]].check()
        for message in reversed(await self._messages(handle)):
            info = message.get("info", {})
            if (info.get("sessionID") == handle["session"] and info.get("parentID") == handle["message"]
                    and info.get("role") == "assistant" and info.get("time", {}).get("completed")):
                if "structured" in info:
                    candidate = dict(info["structured"])
                else:
                    text = "".join(p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text")
                    candidate = json.loads(text)
                clarification = candidate.get("clarification")
                if isinstance(clarification, dict) and isinstance(clarification.get("options"), list):
                    # Provider grammar omits array bounds; bound UI choices before strict validation.
                    clarification["options"] = clarification["options"][:5]
                bridge = self.bridges[handle["instance"]]
                candidate.setdefault("context", handle["context"])
                candidate.setdefault("sources", list({s.source_id: s.model_dump(mode="json") for r in bridge.results for s in r.sources}.values()))
                candidate.setdefault("coverage", bridge.results[-1].coverage.model_dump() if bridge.results else {})
                candidate.setdefault("as_of", bridge.results[-1].observed_at if bridge.results else datetime.now(timezone.utc))
                answer = Answer.model_validate(candidate)
                known = {result.snapshot_ref for result in bridge.results}
                if any(block.server_result_ref not in known for block in answer.data_blocks):
                    raise ValueError("unknown_result_reference")
                if answer.kind in {"answer", "partial", "no_results"} and not bridge.results:
                    raise ValueError("evidence_missing")
                return answer
        raise ValueError("candidate_missing")

    async def cancel(self, handle):
        if handle.get("session"):
            await self._request(handle, "POST", f"/session/{handle['session']}/abort")

    async def dispose(self, handle):
        client = self.clients.get(handle["instance"])
        try:
            if client and handle.get("session"):
                try:
                    await self._request(handle, "DELETE", f"/session/{handle['session']}")
                except httpx.HTTPError:
                    pass  # Destroying the whole isolated state is authoritative.
            await self.launcher.destroy(handle["instance"])
        finally:
            if client:
                await client.aclose()
            self.clients.pop(handle["instance"], None)
            self.bridges.pop(handle["instance"], None)
