from __future__ import annotations

from app.api.errors import DomainError


ALLOWED_TOOLS = frozenset({
    "read_case",
    "read_selected_sources",
    "read_external_snapshot",
    "search_authorized_cases",
    "propose_claims",
    "propose_patch",
    "open_gap",
    "record_conflict",
    "validate_artifact",
})


def require_allowed_tool(name: str) -> str:
    if name not in ALLOWED_TOOLS:
        raise DomainError("tool_not_allowed", "Инструмент не разрешён политикой Assistant V2.", 403, {"tool": name})
    return name

