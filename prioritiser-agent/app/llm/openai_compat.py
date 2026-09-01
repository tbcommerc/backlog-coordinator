"""OpenAI-compatible LLM adapter shared by configuration with DMB AI Agent."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.llm.base import SYSTEM_PROMPT, TaskHints, build_user_prompt, parse_hints


class OpenAICompatAdapter:
    """Adapter for OpenAI, Azure-compatible gateways, vLLM and local proxies."""

    name = "openai_compat"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float = 30.0,
    ) -> None:
        if not api_key.strip():
            raise RuntimeError("не задан PRIORITISER_OPENAI_API_KEY")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.last_usage: dict[str, int | float | None] = {}

    def _complete(
        self,
        system: str,
        user: str,
        *,
        max_tokens: int,
        schema: dict[str, Any] | None = None,
    ) -> str:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if schema is not None:
            # Matches the JSON mode already used by the business-requirements
            # agent and remains compatible with generic OpenAI gateways.
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        is_opencode_zen = (
            httpx.URL(self.base_url).host == "opencode.ai"
            and "/zen/" in self.base_url
        )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": (
                "opencode/latest/1.18.21/cli"
                if is_opencode_zen
                else "DMB-Task-Prioritiser/1.0"
            ),
        }
        if is_opencode_zen:
            headers["x-opencode-client"] = "cli"
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()
        usage = data.get("usage") or {}
        self.last_usage = {
            "tokens_in": usage.get("prompt_tokens"),
            "tokens_out": usage.get("completion_tokens"),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                "OpenAI-compatible провайдер вернул неожиданный ответ: "
                + json.dumps(data, ensure_ascii=False)[:500]
            ) from exc

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        text = self._complete(
            SYSTEM_PROMPT,
            build_user_prompt(task_text, team, team_class),
            max_tokens=512,
            schema={"type": "object"},
        )
        return parse_hints(text, self.name)

    def complete(self, system: str, user: str, schema: dict | None = None) -> str:
        return self._complete(system, user, max_tokens=1024, schema=schema)
