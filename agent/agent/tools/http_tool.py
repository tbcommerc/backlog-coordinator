"""HTTP tool - read-only access to external banking systems.

GET-only by default for safety. If mock_response is set, returns it instead
of making a network call (MVP behavior).
"""
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from .base import Tool


class HttpTool(Tool):
    def __init__(self, name: str, description: str, url: str,
                 method: str = "GET", headers: Optional[dict] = None,
                 mock_response: Optional[str] = None, params: dict = None):
        self.name = name
        self.description = description
        self.url = url
        self.method = method.upper()
        self.headers = headers or {}
        self.mock_response = mock_response
        self.parameters = {
            "type": "object",
            "properties": {
                k: {"type": "string", "description": v}
                for k, v in (params or {}).items()
            },
        }

    def call(self, args: Dict[str, Any]) -> str:
        if self.mock_response:
            return self.mock_response
        if self.method != "GET":
            return "Только GET-запросы разрешены для внешних источников."
        url = self.url
        if args:
            url += "?" + urllib.parse.urlencode(args)
        req = urllib.request.Request(url, headers=self.headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8")[:2000]
        except Exception as e:
            return f"Ошибка вызова внешнего источника: {e}"
