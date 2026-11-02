"""MCP registry - built-in skills + tools discovered from MCP servers.

Skills are prompt templates the agent can use; tools are callable functions.
The registry is populated from MCP_SERVERS_JSON at startup and exposed through
the /config endpoint so the frontend and DMB know what is connected.
"""
import logging

from ..config import mcp_servers
from .client import connect_all

log = logging.getLogger("business_analyst_experimental.mcp")

BUILTIN_SKILLS = [
    {
        "id": "collect_business_requirement",
        "description": "Сценарий сбора бизнес-требования: уточняющие вопросы, подтверждение, драфт.",
    },
    {
        "id": "classify_request",
        "description": "Классификация обращения: feature / change / problem / clarification / incident.",
    },
    {
        "id": "search_knowledge_base",
        "description": "Поиск по курируемой базе знаний (продукты, модули, процессы, история требований).",
    },
]


class MCPRegistry:
    def __init__(self):
        self.skills: list[dict] = list(BUILTIN_SKILLS)
        self.tools: list[dict] = []
        self.servers: list[dict] = []

    def init_from_config(self):
        servers = mcp_servers()
        if not servers:
            return
        clients = connect_all(servers)
        for client in clients:
            self.servers.append({"name": client.server_name, "connected": True})
            for tool in client.tools:
                self.tools.append({"server": client.server_name, **tool})
            log.info("MCP server %s connected: %d tools", client.server_name, len(client.tools))

    def as_config(self) -> dict:
        return {"servers": self.servers, "tools": self.tools, "skills": self.skills}


registry = MCPRegistry()
