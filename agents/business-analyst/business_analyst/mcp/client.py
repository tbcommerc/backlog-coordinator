"""MCP client - optional connection to MCP servers (skills & tools).

The official 'mcp' package is used lazily; if it is not installed or a server
is unreachable, the agent degrades gracefully. Configure servers via
MCP_SERVERS_JSON in .env.
"""
import logging

log = logging.getLogger("business_analyst.mcp")


class McpClient:
    """Thin wrapper around an MCP stdio server connection."""

    def __init__(self, server_name: str, command: str, args: list):
        self.server_name = server_name
        self.command = command
        self.args = args
        self._available = False
        self.tools = []

    def connect(self) -> bool:
        try:
            import asyncio

            from mcp import ClientSession, StdioServerParameters, stdio_client

            params = StdioServerParameters(command=self.command, args=self.args, env=None)

            async def _connect():
                async with stdio_client(params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        tools_resp = await session.list_tools()
                        self.tools = [
                            {"name": t.name, "description": t.description or "",
                             "inputSchema": getattr(t, "inputSchema", {}) or {}}
                            for t in getattr(tools_resp, "tools", [])
                        ]
                        self._available = True

            asyncio.run(_connect())
        except ImportError:
            log.warning("MCP package not installed; MCP servers disabled. pip install mcp")
        except Exception as e:
            log.warning("MCP connect failed for %s: %s", self.server_name, e)
        return self._available


def connect_all(servers: list[dict]) -> list[McpClient]:
    clients = []
    for cfg in servers or []:
        client = McpClient(
            server_name=cfg.get("name", "mcp"),
            command=cfg.get("command", ""),
            args=cfg.get("args", []),
        )
        if client.command and client.connect():
            clients.append(client)
    return clients
