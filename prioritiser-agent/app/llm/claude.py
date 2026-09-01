"""Адаптер Claude (Anthropic Messages API).

Используется официальный SDK `anthropic`. Ответ ограничен JSON-схемой через
structured outputs — так модель физически не может вернуть текст, который потом
придётся вылавливать регуляркой, и разбор ответа перестаёт быть источником
плавающих ошибок.
"""

from __future__ import annotations

import json
import time

from app.llm.base import SYSTEM_PROMPT, TaskHints, build_user_prompt, parse_hints

DEFAULT_MODEL = "claude-opus-5"

# Схема ответа. Числовые поля обязаны допускать null: «нет данных» — валидный
# и, по методике, предпочтительный ответ (см. правило 2 в SYSTEM_PROMPT).
_NULLABLE_NUMBER = {"anyOf": [{"type": "number"}, {"type": "null"}]}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["revenue", "time_saving", "regulatory", "rnd"]},
        "deals_per_year": _NULLABLE_NUMBER,
        "users": _NULLABLE_NUMBER,
        "minutes_per_operation": _NULLABLE_NUMBER,
        "operations_per_year": _NULLABLE_NUMBER,
        "confident": {"type": "boolean"},
        "rationale": {"type": "string"},
    },
    "required": [
        "kind",
        "deals_per_year",
        "users",
        "minutes_per_operation",
        "operations_per_year",
        "confident",
        "rationale",
    ],
    "additionalProperties": False,
}


class ClaudeAdapter:
    """Клиент Claude через Messages API."""

    name = "anthropic"

    def __init__(self, model: str | None = None, timeout: float = 30.0) -> None:
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - зависит от окружения
            raise RuntimeError(
                "не установлен пакет anthropic: pip install anthropic"
            ) from exc

        # Ключ берётся из ANTHROPIC_API_KEY или профиля `ant auth login`.
        self._client = anthropic.Anthropic(timeout=timeout)
        self.model = model or DEFAULT_MODEL
        self.last_usage: dict[str, int | float | None] = {}

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        user_prompt = build_user_prompt(task_text, team, team_class)
        started = time.perf_counter()

        response = self._client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            # Задача узкая и хорошо описанная — глубокое рассуждение здесь не
            # окупается, а НФ7 даёт на всю задачу 10 секунд.
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
            },
        )

        self.last_usage = {
            "tokens_in": response.usage.input_tokens,
            "tokens_out": response.usage.output_tokens,
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

        # Проверять stop_reason нужно до чтения content: при отказе модели
        # список блоков может оказаться пустым.
        if response.stop_reason == "refusal":
            return TaskHints(
                provider=self.name,
                rationale="модель отклонила запрос по правилам безопасности",
            )

        text = next((block.text for block in response.content if block.type == "text"), "")
        return parse_hints(text, self.name)

    def raw_response_text(self, hints: TaskHints) -> str:
        return json.dumps(hints.raw, ensure_ascii=False)

    def complete(self, system: str, user: str, schema: dict | None = None) -> str:
        """Свободный вызов для оценки по рубрике.

        Когда схема задана, ответ ограничивается ею через structured outputs —
        разбор перестаёт быть источником плавающих ошибок.
        """
        output_config: dict = {"effort": "low"}
        if schema:
            output_config["format"] = {"type": "json_schema", "schema": schema}

        response = self._client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config=output_config,
        )
        self.last_usage = {
            "tokens_in": response.usage.input_tokens,
            "tokens_out": response.usage.output_tokens,
        }
        if response.stop_reason == "refusal":
            raise RuntimeError("модель отклонила запрос по правилам безопасности")
        return next((b.text for b in response.content if b.type == "text"), "")
