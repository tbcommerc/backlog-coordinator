"""Base types for external tools.

Tools give the agent access to external sources (other banking systems)
through a uniform interface. In the MVP real HTTP calls are stubbed; the
framework is ready for production endpoints.
"""
from typing import Any, Dict, List, Optional


class Tool:
    name: str = ""
    description: str = ""
    parameters: dict = {}

    def call(self, args: Dict[str, Any]) -> str:
        raise NotImplementedError


class StubTool(Tool):
    """A tool that returns a canned response (mock external source)."""

    def __init__(self, name: str, description: str, response: str):
        self.name = name
        self.description = description
        self.parameters = {"type": "object", "properties": {}}
        self._response = response

    def call(self, args: Dict[str, Any]) -> str:
        return self._response


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def list(self) -> List[dict]:
        return [{"name": t.name, "description": t.description, "parameters": t.parameters}
                for t in self._tools.values()]

    def call(self, name: str, args: Dict[str, Any]) -> str:
        tool = self._tools.get(name)
        if not tool:
            return f"Tool '{name}' not found"
        return tool.call(args)

    def init_from_config(self):
        from ..config import tools_config
        for cfg in tools_config():
            name = cfg.get("name")
            if not name:
                continue
            self.register(StubTool(
                name=name,
                description=cfg.get("description", ""),
                response=cfg.get("mock_response", "{}"),
            ))


registry = ToolRegistry()
