"""История запросов и повторяемость ответов.

Требование владельца: одинаковые данные — одинаковая цифра; небольшое
изменение — небольшое изменение цифры. Первая половина обеспечивается здесь,
вторая — устройством расчёта (медиана по нескольким аналогам не прыгает от
правки формулировки).

Проверка совпадения идёт **до** обращения к модели, а не после: смысл не в
экономии токенов, а в том, что модель недетерминирована. Два вызова с одним
промптом могут выбрать разные наборы драйверов, и тогда одна и та же задача
получила бы две разные оценки — методику стало бы нечем защищать.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from value_priority_assessor.core.models import AgentRequest


def new_request_id() -> str:
    return uuid.uuid4().hex


def find_previous(
    session: Session | None, cache_key: str, request_type: str
) -> AgentRequest | None:
    """Прежний ответ на ровно такие же атрибуты. None — считаем заново.

    Берётся самая свежая запись: ключ включает версии справочников и слепка,
    поэтому совпадение ключа означает совпадение и входа, и настроек расчёта.
    """
    if session is None:
        return None
    return session.scalars(
        select(AgentRequest)
        .where(AgentRequest.cache_key == cache_key, AgentRequest.request_type == request_type)
        .order_by(AgentRequest.id.desc())
        .limit(1)
    ).first()


def remember(
    session: Session | None,
    *,
    request_id: str,
    cache_key: str,
    request_type: str,
    task_key: str,
    attributes: dict[str, Any],
    response: dict[str, Any],
    method: str | None,
    drivers: dict[str, Any] | None,
    snapshot_version: str | None,
    reference_versions: dict[str, int],
    llm_calls: int,
    duration_ms: int | None,
) -> None:
    """Сохраняет запрос и ответ. Без сессии работает вхолостую.

    Отсутствие базы не должно ронять расчёт: сервис обязан отвечать и тогда,
    когда историю писать некуда, — просто без гарантии повторяемости.
    """
    if session is None:
        return
    session.add(
        AgentRequest(
            request_id=request_id,
            cache_key=cache_key,
            request_type=request_type,
            task_key=task_key,
            attributes=attributes,
            response=response,
            method=method,
            drivers=drivers or {},
            snapshot_version=snapshot_version,
            reference_versions=reference_versions,
            llm_calls=llm_calls,
            duration_ms=duration_ms,
        )
    )
    session.flush()
