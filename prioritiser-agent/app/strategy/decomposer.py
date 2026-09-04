"""Клиент Strategy Decomposer — единственная agentic-часть приоритизатора.

ТЗ (И3, НФ6): запрос — описание задачи, ответ — балл соответствия стратегии
1–10 и краткое обоснование. Балл идёт в фактор F5 (вес 0.10).

В MVP по умолчанию работает детерминированная заглушка: реальный внешний агент
живёт во внутреннем контуре и снаружи недоступен. Заглушка возвращает не
случайное число, а воспроизводимый балл — иначе два прогона одного бэклога дали
бы разные приоритеты, и методику нельзя было бы защитить.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

import httpx

# Слова, по которым заглушка приподнимает балл: это грубая, но объяснимая
# эвристика «задача звучит стратегически».
STRATEGIC_MARKERS = (
    "стратег", "платформ", "ibp", "масштаб", "трансформ", "экосистем",
    "ai", "genai", "автоматиз", "клиентск", "доход", "воронк",
)


@dataclass(frozen=True)
class StrategyFit:
    score: float          # 1..10
    rationale: str
    provider: str


class StubStrategyDecomposer:
    """Детерминированная заглушка: одинаковый текст — одинаковый балл."""

    name = "stub"

    def score(self, task_text: str, team: str | None = None) -> StrategyFit:
        text = (task_text or "").lower()
        hits = sum(1 for marker in STRATEGIC_MARKERS if marker in text)

        # База 4–7 из хеша текста, чтобы задачи различались между собой,
        # плюс до +3 за стратегические маркеры. Диапазон итога — 4..10.
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        base = 4 + digest[0] % 4
        score = min(10, base + min(3, hits))

        return StrategyFit(
            score=float(score),
            rationale=(
                f"Заглушка Strategy Decomposer: базовый балл {base}, "
                f"стратегических маркеров в тексте — {hits}."
            ),
            provider=self.name,
        )


class RestStrategyDecomposer:
    """Реальный внешний агент по REST."""

    name = "rest"

    def __init__(self, url: str, token: str = "", timeout: float = 10.0) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def score(self, task_text: str, team: str | None = None) -> StrategyFit:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        response = httpx.post(
            f"{self.url}/score",
            headers=headers,
            json={"description": task_text, "team": team},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()

        return StrategyFit(
            score=float(payload.get("score", 5)),
            rationale=str(payload.get("rationale", ""))[:1000],
            provider=self.name,
        )


def get_strategy_provider(provider: str | None = None):
    from app.config import get_settings

    settings = get_settings()
    name = (provider if provider is not None else settings.strategy_provider).strip().lower()
    if not name:
        raise RuntimeError("не задан PRIORITISER_STRATEGY_PROVIDER")

    if name == "rest":
        url = settings.strategy_decomposer_url or os.getenv("STRATEGY_DECOMPOSER_URL", "")
        if not url:
            raise RuntimeError("не задан STRATEGY_DECOMPOSER_URL")
        return RestStrategyDecomposer(url, settings.strategy_decomposer_token)
    if name == "stub":
        return StubStrategyDecomposer()
    raise ValueError(f"неизвестный strategy provider: {name}")
