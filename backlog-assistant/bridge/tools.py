import asyncio
import hashlib
import json
import re
import time
import uuid
from jsonschema import Draft202012Validator
from contracts.models import ToolResult
from contracts.catalog import compact_schema


class ToolBridge:
    """One bridge, one execution, no model-selected identity or credentials."""
    def __init__(self, data, execution, grant, catalog, *, deadline, max_calls=6, request_text=None):
        if catalog.get("contract_version") != "1.0":
            raise ValueError("incompatible_contract")
        if request_text is not None:
            from bridge.selection import select_catalog
            catalog = select_catalog(catalog, request_text)
        self.data, self.execution, self._grant = data, execution, grant
        self.catalog, self.deadline, self.max_calls = catalog, deadline, max_calls
        self.calls = 0
        self.required_terms = []
        self.required_query = {}
        self.failure = None
        self.receipts = []
        self.results = []
        self.resolved_context = []
        self.lock = asyncio.Lock()
        self.schemas = {t["name"]: t["inputSchema"] for t in catalog["tools"]}
        self.catalog_hash = hashlib.sha256(json.dumps(catalog, sort_keys=True).encode()).hexdigest()

    def bind_request(self, text):
        # Explicit literals are user constraints, not model suggestions.
        terms = re.findall(r"(?i)\bTASK-\d+-\d+\b", text)
        terms += re.findall(r"(?i)со\s+словом\s+[«\"']?([\w-]+)", text)
        from bridge.selection import explicit_query
        self.required_query = explicit_query(text)
        self.required_terms = list(dict.fromkeys(terms + self.required_query.get("terms", [])))
        if len(self.required_terms) > 8:
            raise ValueError("too_many_search_literals")

    async def check(self):
        if self.failure == "source_access_denied":
            raise PermissionError(self.failure)
        if self.failure:
            raise ValueError(self.failure)
        if time.monotonic() >= self.deadline:
            raise TimeoutError("execution_timeout")
        await self.data.check(self.execution, self._grant)

    async def call(self, name, arguments):
        async with self.lock:
            await self.check()
            if name not in self.schemas:
                raise ValueError("unknown_tool")
            if name in {"search_work_items", "aggregate_backlog"} and (self.required_terms or self.required_query):
                arguments = dict(arguments)
                query = dict(arguments.get("query", {}))
                if "relationship" in self.required_query:
                    query["relationship"] = self.required_query["relationship"]
                if "missing" in self.required_query:
                    query["missing"] = list(dict.fromkeys(query.get("missing", []) + self.required_query["missing"]))
                terms = list(query.get("terms", []))
                for term in self.required_terms:
                    if term.casefold() not in {v.casefold() for v in terms}:
                        terms.append(term)
                arguments["query"] = dict(query, terms=terms)
            if name == "aggregate_backlog" and self.resolved_context:
                arguments = dict(arguments)
                query = dict(arguments.get("query", {}))
                resolved = {}
                for kind, result in self.resolved_context:
                    if kind not in {"team", "project", "status", "period"}:
                        continue
                    items = result.data.get("items", [])
                    if result.data.get("total") != 1 or len(items) != 1:
                        raise ValueError("unresolved_context_filter")
                    item = items[0]
                    if kind == "period":
                        key, value = "period", item["title"]
                    else:
                        prefix, sep, identifier = item["object_ref"].partition(":")
                        if prefix != kind or not sep or not identifier.isdigit():
                            raise ValueError("invalid_resolved_filter")
                        key, value = kind + "_ids", [int(identifier)]
                    if key in resolved and resolved[key] != value:
                        raise ValueError("ambiguous_context_filters")
                    resolved[key] = value
                for key, value in resolved.items():
                    if query.get(key) and query[key] != value:
                        raise ValueError("resolved_filter_conflict")
                    query[key] = value
                arguments["query"] = query
            Draft202012Validator(self.schemas[name]).validate(arguments)
            if self.calls >= self.max_calls:
                raise ValueError("tool_budget_exceeded")
            self.calls += 1
            call_id = str(uuid.uuid4())
            try:
                result = await asyncio.wait_for(self.data.tool(self.execution, self._grant, name, arguments, call_id), 3)
            except PermissionError:
                self.failure = "source_access_denied"
                raise
            result = ToolResult.model_validate(result)
            if (result.execution_ref, result.tool_call_id, result.tool_name) != (self.execution, call_id, name):
                raise ValueError("tool_result_mismatch")
            if len(result.model_dump_json().encode()) > 64000:
                raise ValueError("tool_result_too_large")
            self.receipts.extend(s.receipt_ref for s in result.sources)
            self.results.append(result)
            if name == "resolve_context":
                self.resolved_context.append((arguments["kind"], result))
            return result

    async def rpc(self, request):
        """Stateless MCP JSON-RPC; private transport adds a per-instance credential."""
        method, params = request.get("method"), request.get("params", {})
        if method == "notifications/initialized":
            return None
        try:
            await self.check()
            if method == "initialize":
                result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "backlog-data", "version": "1.0.0"}}
            elif method == "tools/list":
                result = {"tools": [dict(t, inputSchema=compact_schema(t["inputSchema"])) for t in self.catalog["tools"]]}
            elif method == "tools/call":
                value = await self.call(params["name"], params.get("arguments", {}))
                result = {"content": [{"type": "text", "text": model_evidence(value)}], "isError": False}
            elif method == "ping":
                result = {}
            else:
                return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32601, "message": "Method not allowed"}}
            return {"jsonrpc": "2.0", "id": request.get("id"), "result": result}
        except Exception:
            return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32602, "message": "Tool unavailable or invalid arguments"}}


def model_evidence(value):
    result = value.model_dump(mode="json")
    data = dict(result["data"])
    if value.tool_name == "search_work_items":
        keys = {"object_ref", "public_id", "title", "status", "team", "period", "owner"}
        data["items"] = [{k: (v[:160] if isinstance(v, str) else v) for k, v in row.items() if k in keys} for row in data.get("items", [])[:5]]
        data["model_preview_only"] = True
    def preview(value):
        if isinstance(value, str):
            return value[:400]
        if isinstance(value, list):
            return [preview(item) for item in value[:5]]
        if isinstance(value, dict):
            return {key: preview(item) for key, item in value.items() if key not in {"navigator", "version"}}
        return value
    # Full receipts remain server-side. The model selects references, not rows.
    result["data"] = preview(data)
    result["data"]["model_preview_only"] = True
    # Identity, coverage and citations are verified server-side, not repeated in model context.
    preview_result = {k: result[k] for k in ("tool_name", "status", "snapshot_ref", "data", "limitations")}
    return json.dumps(preview_result, ensure_ascii=False, separators=(",", ":"))
