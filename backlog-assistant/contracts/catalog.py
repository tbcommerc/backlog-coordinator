from contracts.models import QuerySpec


def obj(properties, required=()):
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(required)}


REF = {"type": "string", "minLength": 1, "maxLength": 128}
QUERY = QuerySpec.model_json_schema()
QUERY["properties"]["terms"]["description"] = "Literal requested search terms; all terms are required (AND). Never omit a user-provided word or public ID."
LIMIT = {"type": "integer", "minimum": 1, "maximum": 50, "default": 20}
TEXT = {"type": "string", "minLength": 1, "maxLength": 500}
SCHEMAS = {
    "resolve_context": obj({"kind": {"enum": ["team", "project", "period", "status", "task", "request"]}, "text": TEXT}, ("kind", "text")),
    "search_work_items": obj({"query": QUERY, "limit": LIMIT}, ("query",)),
    "read_task": obj({"task_ref": REF, "sections": {"type": "array", "items": {"enum": ["card", "history", "comments"]}, "maxItems": 3}}, ("task_ref",)),
    "read_request": obj({"request_ref": REF}, ("request_ref",)),
    "read_requirement_review": obj({"review_ref": REF}, ("review_ref",)),
    "query_changes": obj({"query": QUERY, "from": {"type": "string", "format": "date-time"},
        "to": {"type": "string", "format": "date-time"}, "fields": {"type": "array", "items": {"enum": ["status_id", "priority_id", "deadline_id", "owner_id", "progress"]}}, "limit": LIMIT}, ("query", "from", "to")),
    "aggregate_backlog": obj({"query": QUERY, "group_by": {"enum": ["status", "project", "team", "period"]},
        "metrics": {"type": "array", "items": {"enum": ["count", "cost_rub", "effect_million_rub"]}, "minItems": 1, "maxItems": 3}}, ("query", "group_by", "metrics")),
    "read_meeting_context": obj({"meeting_ref": REF, "query": QUERY}, ("meeting_ref", "query")),
    "compare_tasks": obj({"task_refs": {"type": "array", "minItems": 2, "maxItems": 10, "uniqueItems": True, "items": REF},
        "dimensions": {"type": "array", "items": {"enum": ["status", "priority", "cost_rub", "effect_million_rub", "cost_value"]}, "maxItems": 5}}, ("task_refs", "dimensions")),
    "search_help": obj({"topic": TEXT, "surface": {"enum": ["backlog", "task", "request", "report", "assistant"]}}, ("topic", "surface")),
}


SCHEMAS["query_changes"]["properties"]["from"]["description"] = "Inclusive start with explicit timezone."
SCHEMAS["query_changes"]["properties"]["to"]["description"] = "Exclusive end with explicit timezone. Use the requested instant exactly; never subtract one second."
SCHEMAS["query_changes"]["properties"]["fields"]["description"] = "Only requested fields. Planned period=deadline_id, status=status_id, priority=priority_id, owner=owner_id. Omit for all changes."
SCHEMAS["read_task"]["properties"]["task_ref"] = dict(REF, description="Internal task:N only. Search public TASK-* IDs first; never infer N.")

for tool,field,prefix in [('read_task','task_ref','task'),('read_request','request_ref','request'),('read_requirement_review','review_ref','review'),('read_meeting_context','meeting_ref','meeting')]:
    SCHEMAS[tool]['properties'][field] = dict(SCHEMAS[tool]['properties'][field], pattern=f'^{prefix}:[1-9][0-9]*$',
        description=f'Exact internal reference {prefix}:N including the prefix. Public IDs must be searched first.')
SCHEMAS['compare_tasks']['properties']['task_refs']['items'] = dict(REF, pattern='^task:[1-9][0-9]*$', description='Internal task:N reference.')
SCHEMAS['compare_tasks']['properties']['dimensions']['description'] = 'Requested comparison fields. Cost/Value = cost_value (server-calculated ratio); cost_rub is cost only, not the ratio.'

def catalog():
    return {"contract_version": "1.0", "tools": [{"name": name, "description": name,
        "inputSchema": schema} for name, schema in SCHEMAS.items()]}


def compact_schema(value):
    definitions = value.get("$defs", {}) if isinstance(value, dict) else {}
    def visit(node):
        if isinstance(node, dict):
            if "$ref" in node:
                prefix = "#/$defs/"
                if not node["$ref"].startswith(prefix):
                    raise ValueError("external_schema_ref_forbidden")
                return visit(definitions[node["$ref"][len(prefix):]])
            # Inline references for providers/OpenCode's schema conversion. Full
            # bounds remain authoritative at the bridge and final validator.
            return {k: visit(v) for k, v in node.items() if k not in {
                "$defs", "title", "default", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "uniqueItems"}
                and not (k == "required" and v == [])}
        if isinstance(node, list):
            return [visit(v) for v in node]
        return node
    return visit(value)
