"""Оценщики факторов F5 и F6.

По ТЗ (Ф16, И3) значения этих факторов приходят от внешнего агента Strategy
Decomposer. Решение владельца от 2026-08-11: считать их внутри проекта.

Три провайдера с одинаковым контрактом:

* `stub` — детерминированная эвристика без сети, доступная только при явном
  выборе в тестах;
* `agent` — собственный оценщик на LLM-адаптере, отвечает по рубрике и
  опирается на найденные в корпусе материалы; это рабочий default;
* `rest` — внешний Strategy Decomposer, как в исходном ТЗ.

Во всех трёх случаях итоговый балл считает `app/strategy/rubric.py`. Провайдер
отвечает только за ответы по критериям.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.config import get_settings
from app.llm.base import (
    RUBRIC_SYSTEM_PROMPT,
    build_dependency_prompt,
    build_strategy_prompt,
    parse_json_object,
)
from app.strategy.decomposer import RestStrategyDecomposer, StubStrategyDecomposer
from app.strategy.rubric import (
    DependencyAssessment,
    RubricError,
    StrategyAssessment,
    score_dependencies,
    score_strategy,
)

# Сколько фрагментов корпуса подмешивать в промпт оценщика. Больше — не лучше:
# длинный контекст размывает вопрос рубрики и провоцирует пересказ вместо ответа.
EVIDENCE_TOP_K = 4


class StrategyAnalyst(Protocol):
    name: str

    def assess(
        self, task_text: str, team: str | None, rubric: dict[str, Any]
    ) -> StrategyAssessment:
        ...


class DependencyAnalyst(Protocol):
    name: str

    def assess(
        self,
        task_text: str,
        team: str | None,
        declared: str | None,
        known_teams: list[str],
        rubric: dict[str, Any],
    ) -> DependencyAssessment:
        ...


def _gather_evidence(query: str, layers: tuple[str, ...] = ("k3", "knowledge")) -> tuple[str, list[str]]:
    """Собирает материалы корпуса для обоснования оценки.

    Возвращает текст для промпта и список идентификаторов фрагментов —
    последний уходит в оценку как evidence, чтобы суждение можно было
    проверить, а не принимать на слово.
    """
    from app.rag.search import search_corpus

    blocks: list[str] = []
    evidence: list[str] = []
    per_layer = max(1, EVIDENCE_TOP_K // max(1, len(layers)))

    for layer in layers:
        try:
            found = search_corpus(query, top_k=per_layer, layer=layer)
        except Exception:  # noqa: BLE001 - без корпуса оценка всё равно возможна
            continue
        for item in found.get("results", []):
            evidence.append(item["chunk_id"])
            blocks.append(f"[{item['chunk_id']}] {item['title']}: {item['snippet'][:400]}")

    return "\n".join(blocks), evidence


# --- F5 ----------------------------------------------------------------------


class StubStrategyAnalyst:
    """Детерминированная оценка без сети — через ту же рубрику."""

    name = "stub"

    def __init__(self) -> None:
        self._legacy = StubStrategyDecomposer()

    def assess(self, task_text: str, team: str | None, rubric: dict[str, Any]) -> StrategyAssessment:
        text = (task_text or "").lower()

        def has(*markers: str) -> bool:
            return any(marker in text for marker in markers)

        answers = {
            "strategic_theme": "supporting" if has("платформ", "ibp", "ai", "процесс") else "adjacent",
            "revenue_link": "direct"
            if has("доход", "сделк", "выдач", "воронк", "лид", "продаж")
            else ("enabling" if has("конверси", "клиент") else "none"),
            "client_impact": "core"
            if has("клиент", "сделк")
            else ("partial" if has("отчёт", "отчет", "витрин") else "internal"),
            "platform_leverage": "platform" if has("платформ", "интеграц", "сервис") else "team",
            "mandate_fit": "core",
        }
        return score_strategy(
            answers,
            rubric,
            rationale="Детерминированная оценка без обращения к модели: по ключевым словам постановки.",
            evidence=[],
        )


class AgentStrategyAnalyst:
    """Собственный оценщик на LLM-адаптере с опорой на корпус знаний."""

    name = "agent"

    def __init__(self, adapter, use_rag: bool = True) -> None:
        self._adapter = adapter
        self._use_rag = use_rag
        self.model = getattr(adapter, "model", adapter.name)

    def assess(self, task_text: str, team: str | None, rubric: dict[str, Any]) -> StrategyAssessment:
        criteria = (rubric.get("strategy_fit") or {}).get("criteria") or []
        context, evidence = _gather_evidence(task_text) if self._use_rag else ("", [])

        prompt = build_strategy_prompt(task_text, team, criteria, context)
        schema = {
            "type": "object",
            "properties": {
                "answers": {
                    "type": "object",
                    "properties": {
                        c["id"]: {"type": "string", "enum": sorted((c.get("options") or {}).keys())}
                        for c in criteria
                    },
                    "required": [c["id"] for c in criteria],
                    "additionalProperties": False,
                },
                "rationale": {"type": "string"},
            },
            "required": ["answers", "rationale"],
            "additionalProperties": False,
        }

        raw = self._adapter.complete(RUBRIC_SYSTEM_PROMPT, prompt, schema)
        payload = parse_json_object(raw)
        return score_strategy(
            payload.get("answers") or {},
            rubric,
            rationale=str(payload.get("rationale") or ""),
            evidence=evidence,
        )


class RestStrategyAnalyst:
    """Внешний Strategy Decomposer: балл 1–10 приходит готовым.

    Рубрика в этом случае не заполняется — внешний агент отдаёт число, и
    разложить его обратно по критериям нельзя. Это и есть причина, по которой
    оценку решили перенести внутрь: у внешнего балла нельзя оспорить основание.
    """

    name = "rest"

    def __init__(self, client: RestStrategyDecomposer) -> None:
        self._client = client

    def assess(self, task_text: str, team: str | None, rubric: dict[str, Any]) -> StrategyAssessment:
        fit = self._client.score(task_text, team)
        scale = (rubric.get("strategy_fit") or {}).get("scale") or {}
        raw_min = float(scale.get("raw_min", 1))
        raw_max = float(scale.get("raw_max", 10))
        raw = max(raw_min, min(raw_max, float(fit.score)))
        normalised = (raw - raw_min) / (raw_max - raw_min) if raw_max != raw_min else 1.0

        return StrategyAssessment(
            raw_score=round(raw, 3),
            normalised=round(normalised, 4),
            answers={},
            breakdown=[],
            confidence="medium",
            rationale=fit.rationale,
            evidence=[],
            rubric_version=int((rubric.get("strategy_fit") or {}).get("rubric_version", 1)),
        )


# --- F6 ----------------------------------------------------------------------


class DeclaredDependencyAnalyst:
    """Зависимости из атрибута бэклога «Другие вовлечённые команды».

    Тип связи в бэклоге не указан, поэтому все команды считаются требующими
    согласования. Это осознанно консервативно: назвать чужую поставку
    блокирующей без подтверждения значит завысить штраф.
    """

    name = "declared"

    def assess(
        self,
        task_text: str,
        team: str | None,
        declared: str | None,
        known_teams: list[str],
        rubric: dict[str, Any],
    ) -> DependencyAssessment:
        from app.core.normalise import split_teams

        teams = [
            {"team": name, "type": "coordination", "reason": "Указана в атрибуте бэклога"}
            for name in split_teams(declared)
            if name != team
        ]
        return score_dependencies(
            teams,
            rubric,
            rationale=(
                "Зависимости взяты из атрибута бэклога; тип связи не указан, "
                "принят как согласование."
                if teams
                else "В бэклоге вовлечённые команды не указаны."
            ),
        )


class AgentDependencyAnalyst:
    """Собственный оценщик зависимостей на LLM-адаптере.

    Полезен там, где атрибут бэклога пуст — а он пуст у 354 задач из 440.
    """

    name = "agent"

    def __init__(self, adapter, use_rag: bool = True) -> None:
        self._adapter = adapter
        self._use_rag = use_rag
        self.model = getattr(adapter, "model", adapter.name)

    def assess(
        self,
        task_text: str,
        team: str | None,
        declared: str | None,
        known_teams: list[str],
        rubric: dict[str, Any],
    ) -> DependencyAssessment:
        types = (rubric.get("dependencies") or {}).get("types") or {}
        context, evidence = (
            _gather_evidence(task_text, layers=("knowledge",)) if self._use_rag else ("", [])
        )

        prompt = build_dependency_prompt(task_text, team, known_teams, declared, types, context)
        schema = {
            "type": "object",
            "properties": {
                "teams": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "team": {"type": "string", "enum": known_teams},
                            "type": {"type": "string", "enum": sorted(types.keys())},
                            "reason": {"type": "string"},
                        },
                        "required": ["team", "type", "reason"],
                        "additionalProperties": False,
                    },
                },
                "rationale": {"type": "string"},
            },
            "required": ["teams", "rationale"],
            "additionalProperties": False,
        }

        raw = self._adapter.complete(RUBRIC_SYSTEM_PROMPT, prompt, schema)
        payload = parse_json_object(raw)

        teams = [t for t in (payload.get("teams") or []) if t.get("team") != team]
        return score_dependencies(
            teams,
            rubric,
            rationale=str(payload.get("rationale") or ""),
            evidence=evidence,
        )


# --- фабрики -----------------------------------------------------------------


def get_strategy_analyst(provider: str | None = None, adapter=None) -> StrategyAnalyst:
    settings = get_settings()
    name = (provider if provider is not None else settings.strategy_provider).strip().lower()
    if not name:
        raise RuntimeError("не задан PRIORITISER_STRATEGY_PROVIDER")

    if name == "agent":
        from app.llm.factory import get_adapter

        return AgentStrategyAnalyst(adapter or get_adapter(), use_rag=settings.strategy_use_rag)
    if name == "rest":
        url = settings.strategy_decomposer_url
        if not url:
            raise RuntimeError("не задан STRATEGY_DECOMPOSER_URL")
        return RestStrategyAnalyst(RestStrategyDecomposer(url, settings.strategy_decomposer_token))
    if name == "stub":
        return StubStrategyAnalyst()
    raise ValueError(f"неизвестный strategy provider: {name}")


def get_dependency_analyst(provider: str | None = None, adapter=None) -> DependencyAnalyst:
    settings = get_settings()
    name = (provider if provider is not None else settings.dependency_provider).strip().lower()
    if not name:
        raise RuntimeError("не задан PRIORITISER_DEPENDENCY_PROVIDER")

    if name == "agent":
        from app.llm.factory import get_adapter

        return AgentDependencyAnalyst(adapter or get_adapter(), use_rag=settings.strategy_use_rag)
    if name == "declared":
        return DeclaredDependencyAnalyst()
    raise ValueError(f"неизвестный dependency provider: {name}")


__all__ = [
    "AgentDependencyAnalyst",
    "AgentStrategyAnalyst",
    "DeclaredDependencyAnalyst",
    "RestStrategyAnalyst",
    "RubricError",
    "StubStrategyAnalyst",
    "get_dependency_analyst",
    "get_strategy_analyst",
]
