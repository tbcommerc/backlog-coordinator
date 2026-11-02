"""Controlled OpenAI-compatible boundary: real retries consume the same budget."""
import asyncio
import json
import httpx
from urllib.parse import urlparse


class ModelBroker:
    def __init__(self, bridge, endpoint, key, model, *, transport=None):
        self.bridge, self.endpoint, self.key, self.model = bridge, endpoint.rstrip("/"), key, model
        self.requests, self.input_bound, self.output_reserved = 0, 0, 0
        self.errors = []
        self.max_input_bytes = 0
        self.provider_error = None
        self.lock = asyncio.Lock()
        self.client = httpx.AsyncClient(timeout=40, trust_env=False, follow_redirects=False, transport=transport)

    async def completion(self, body):
        async with self.lock:
            await self.bridge.check()
            if body.get("model") != self.model:
                raise ValueError("model_not_allowed")
            # UTF-8 byte count is a conservative upper bound for the qualified byte-level tokenizer.
            # Reject unknown protocols rather than rely on OpenCode usage after completion.
            if set(body) - {"model", "messages", "tools", "tool_choice", "temperature", "top_p", "max_tokens",
                            "max_completion_tokens", "stream", "stream_options", "stop", "response_format",
                            "parallel_tool_calls", "frequency_penalty", "presence_penalty", "seed", "reasoning_effort"}:
                raise ValueError("provider_protocol_not_qualified")
            input_bound = len(json.dumps({k: v for k, v in body.items() if k in {"messages", "tools", "response_format"}},
                ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 512 + 32*len(body.get("messages", []))
            self.max_input_bytes = max(self.max_input_bytes, input_bound)
            if self.requests >= 4 or input_bound > 16000 or self.input_bound + input_bound > 40000 or self.output_reserved + 1500 > 6000:
                raise ValueError("model_budget_exceeded")
            self.requests += 1
            self.input_bound += input_bound
            self.output_reserved += 1500  # Reserve before transport; unknown delivery still costs budget.
            outbound = dict(body, stream=False, max_tokens=1500)
            if self.model == "glm-5.3-flash":
                outbound["reasoning_effort"] = "low"
            outbound.pop("stream_options", None)
            outbound.pop("max_completion_tokens", None)
            headers = {"Authorization": "Bearer " + self.key, "User-Agent": "agents/backlog-assistant/0.1 (OpenCode runtime)"}
            if urlparse(self.endpoint).hostname == "opencode.ai":
                headers["x-opencode-session"] = "backlog-assistant-" + self.bridge.execution
            response = await self.client.post(self.endpoint + "/chat/completions", json=outbound, headers=headers)
            if response.is_error:
                self.provider_error = response.text.replace(self.key, "[redacted]")[:1200]
            response.raise_for_status()
            result = response.json()
            usage = result.get("usage", {})
            actual_in, actual_out = usage.get("prompt_tokens"), usage.get("completion_tokens")
            if not isinstance(actual_in, int) or not isinstance(actual_out, int) or actual_in > input_bound or not 0 <= actual_out <= 1500:
                raise ValueError("provider_usage_not_qualified")
            self.output_reserved -= 1500 - actual_out
            await self.bridge.check()
            return result
