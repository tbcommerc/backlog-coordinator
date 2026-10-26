"""Выбор LLM-провайдера и кэширование ответов.

НФ5 требует кэшировать ответы модели по хешу промпта, НФ18 — логировать токены,
время и стоимость каждого вызова. И то и другое закрывает таблица `llm_call`.
"""

from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.models import LlmCall
from app.llm.base import (
    SYSTEM_PROMPT,
    LLMAdapter,
    TaskHints,
    build_user_prompt,
    parse_hints,
    prompt_hash,
)
from app.llm.mock import MockAdapter
from app.llm.singleflight import run_singleflight

_PURPOSE = "classify_task"


def get_adapter(provider: str | None = None) -> LLMAdapter:
    """Создаёт адаптер по имени провайдера.

    Реальные клиенты импортируются лениво: прототип должен запускаться и на
    машине без пакета anthropic и без доступа в контур банка.
    """
    settings = get_settings()
    name = (provider if provider is not None else settings.llm_provider).strip().lower()
    if not name:
        raise RuntimeError("не задан PRIORITISER_LLM_PROVIDER")

    if name == "mock":
        return MockAdapter()
    if name == "openai_compat":
        from app.llm.openai_compat import OpenAICompatAdapter

        return OpenAICompatAdapter(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            model=settings.openai_model,
            timeout=settings.llm_timeout_seconds,
            retry_attempts=settings.llm_retry_attempts,
            retry_base_seconds=settings.llm_retry_base_seconds,
            retry_max_seconds=settings.llm_retry_max_seconds,
        )
    if name == "anthropic":
        from app.llm.claude import ClaudeAdapter

        return ClaudeAdapter(
            model=settings.anthropic_model, timeout=settings.llm_timeout_seconds
        )
    if name == "gigachat":
        from app.llm.gigachat import GigaChatAdapter

        return GigaChatAdapter(
            model=settings.gigachat_model, timeout=settings.llm_timeout_seconds
        )
    if name == "gigacode":
        from app.llm.gigachat import GigaCodeAdapter

        return GigaCodeAdapter(
            model=settings.gigachat_model, timeout=settings.llm_timeout_seconds
        )
    raise ValueError(f"неизвестный LLM-провайдер: {name}")


def classify_with_cache(
    adapter: LLMAdapter,
    task_text: str,
    team: str | None,
    team_class: str,
    session: Session | None = None,
    cache_status: dict[str, bool] | None = None,
) -> TaskHints:
    """Классифицирует задачу, переиспользуя ранее полученный ответ.

    Кэш обязателен не только ради экономии: пересчёт всего бэклога при смене
    весов не должен снова опрашивать модель — веса на классификацию не влияют,
    а 446 сетевых вызовов не уложились бы в норматив НФ8.
    """
    model = getattr(adapter, "model", adapter.name)
    user_prompt = build_user_prompt(task_text, team, team_class)
    key = prompt_hash(SYSTEM_PROMPT, user_prompt, str(model))

    settings = get_settings()
    use_cache = settings.llm_cache_enabled and session is not None

    if use_cache:
        cached = session.scalar(
            select(LlmCall)
            .where(
                LlmCall.provider == adapter.name,
                LlmCall.purpose == _PURPOSE,
                LlmCall.prompt_hash == key,
                LlmCall.error.is_(None),
            )
            .order_by(LlmCall.id.desc())
        )
        if cached is not None and cached.response:
            if cache_status is not None:
                cache_status["hit"] = True
            return parse_hints(cached.response, adapter.name)

    def invoke() -> str:
        started = time.perf_counter()
        error: str | None = None
        failure: Exception | None = None
        hints: TaskHints | None = None
        try:
            hints = adapter.classify(task_text, team, team_class)
        except Exception as exc:  # noqa: BLE001 - ошибка записывается и возвращается вызывающему коду
            error = f"{type(exc).__name__}: {exc}"
            failure = exc

        raw = _serialise(hints) if hints is not None else None
        if session is not None:
            usage: dict[str, Any] = dict(getattr(adapter, "last_usage", {}) or {})
            session.add(
                LlmCall(
                    provider=adapter.name,
                    model=str(model),
                    purpose=_PURPOSE,
                    prompt_hash=key,
                    prompt=user_prompt,
                    response=raw if error is None else None,
                    tokens_in=usage.get("tokens_in"),
                    tokens_out=usage.get("tokens_out"),
                    latency_ms=usage.get("latency_ms")
                    or int((time.perf_counter() - started) * 1000),
                    error=error,
                )
            )
            session.flush()

        if failure is not None:
            raise RuntimeError(
                "LLM недоступна: классификация задачи не выполнена"
            ) from failure
        if raw is None:
            raise RuntimeError("LLM не вернула результат классификации")
        return raw

    raw, shared = run_singleflight(
        f"{adapter.name}:{_PURPOSE}:{key}",
        invoke,
        retain_seconds=5.0 if use_cache else 0.0,
    )
    if cache_status is not None:
        cache_status["hit"] = shared
    return parse_hints(raw, adapter.name)


def complete_with_cache(
    adapter: LLMAdapter,
    *,
    purpose: str,
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any] | None = None,
    session: Session | None = None,
) -> tuple[str, bool]:
    """Run an arbitrary structured completion with the shared LLM audit/cache.

    The cache key includes the actual prompt, schema and model. Reusing a
    response therefore changes neither rubric answers nor scoring; it only
    avoids repeating the same non-deterministic network operation.
    """
    model = str(getattr(adapter, "model", adapter.name))
    schema_text = json.dumps(schema or {}, ensure_ascii=False, sort_keys=True)
    key = prompt_hash(system_prompt, user_prompt, f"{model}\0{schema_text}")
    settings = get_settings()
    use_cache = settings.llm_cache_enabled and session is not None

    if use_cache:
        cached = session.scalar(
            select(LlmCall)
            .where(
                LlmCall.provider == adapter.name,
                LlmCall.purpose == purpose,
                LlmCall.prompt_hash == key,
                LlmCall.error.is_(None),
            )
            .order_by(LlmCall.id.desc())
        )
        if cached is not None and cached.response:
            return cached.response, True

    def invoke() -> str:
        started = time.perf_counter()
        raw: str | None = None
        error: str | None = None
        failure: Exception | None = None
        try:
            raw = adapter.complete(system_prompt, user_prompt, schema)
        except Exception as exc:  # noqa: BLE001 - recorded below and propagated
            error = f"{type(exc).__name__}: {exc}"
            failure = exc

        if session is not None:
            usage: dict[str, Any] = dict(getattr(adapter, "last_usage", {}) or {})
            session.add(
                LlmCall(
                    provider=adapter.name,
                    model=model,
                    purpose=purpose,
                    prompt_hash=key,
                    prompt=user_prompt,
                    response=raw if error is None else None,
                    tokens_in=usage.get("tokens_in"),
                    tokens_out=usage.get("tokens_out"),
                    latency_ms=usage.get("latency_ms")
                    or int((time.perf_counter() - started) * 1000),
                    error=error,
                )
            )
            session.flush()

        if failure is not None:
            raise RuntimeError(f"LLM недоступна: {purpose} не выполнен") from failure
        if raw is None:
            raise RuntimeError(f"LLM не вернула результат: {purpose}")
        return raw

    return run_singleflight(
        f"{adapter.name}:{purpose}:{key}",
        invoke,
        retain_seconds=5.0 if use_cache else 0.0,
    )


def _serialise(hints: TaskHints) -> str:
    import json

    payload = hints.raw or {
        "kind": hints.kind,
        "deals_per_year": hints.deals_per_year,
        "users": hints.users,
        "minutes_per_operation": hints.minutes_per_operation,
        "operations_per_year": hints.operations_per_year,
        "confident": hints.confident,
        "rationale": hints.rationale,
    }
    return json.dumps(payload, ensure_ascii=False)
