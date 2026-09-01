"""Преобразование ответов по рубрике в баллы факторов F5 и F6.

Здесь проходит граница ответственности между моделью и кодом. Субагент
отвечает на критерии рубрики и приводит обоснование; арифметику — веса,
свёртку, штрафы, шкалу — выполняют функции этого модуля.

Разделение не косметическое. Балл, названный моделью одним числом, нельзя ни
воспроизвести, ни оспорить по существу: спорить придётся с цифрой. Ответ по
критериям оспаривается по пунктам, а при изменении весов пересчитывается без
повторного обращения к модели.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

FACTOR_STRATEGY = "F5_strategy_fit"
FACTOR_DEPENDENCIES = "F6_dependencies"

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"


class RubricError(ValueError):
    """Ответ не соответствует рубрике."""


@dataclass
class StrategyAssessment:
    raw_score: float                       # 1..10, шкала ТЗ
    normalised: float                      # 0..1, взвешенная сумма критериев
    answers: dict[str, str]
    breakdown: list[dict[str, Any]]
    confidence: str
    rationale: str
    evidence: list[str] = field(default_factory=list)
    rubric_version: int = 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "raw_score": self.raw_score,
            "normalised": self.normalised,
            "answers": self.answers,
            "breakdown": self.breakdown,
            "confidence": self.confidence,
            "rationale": self.rationale,
            "evidence": self.evidence,
            "rubric_version": self.rubric_version,
        }


@dataclass
class DependencyAssessment:
    score: float                           # 0..1, готовый балл фактора F6
    teams: list[dict[str, Any]]
    blocking_count: int
    rationale: str
    evidence: list[str] = field(default_factory=list)
    rubric_version: int = 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "teams": self.teams,
            "blocking_count": self.blocking_count,
            "rationale": self.rationale,
            "evidence": self.evidence,
            "rubric_version": self.rubric_version,
        }


# --- F5 ----------------------------------------------------------------------


def validate_strategy_rubric(payload: dict[str, Any], tolerance: float = 1e-6) -> None:
    """Сумма весов критериев обязана равняться 1 — как и у весов факторов."""
    criteria = (payload.get("strategy_fit") or {}).get("criteria") or []
    if not criteria:
        raise RubricError("в рубрике нет критериев стратегического соответствия")
    total = sum(float(c.get("weight", 0)) for c in criteria)
    if abs(total - 1.0) > tolerance:
        raise RubricError(f"сумма весов критериев должна быть равна 1, получено {total:.6f}")


def score_strategy(
    answers: dict[str, str],
    rubric: dict[str, Any],
    rationale: str = "",
    evidence: list[str] | None = None,
) -> StrategyAssessment:
    """Считает балл F5 по ответам на критерии.

    Отсутствие ответа — ошибка, а не повод подставить середину: пропущенный
    критерий означает, что оценка неполная, и молча превращать её в «среднее»
    значит выдавать незаполненную рубрику за заполненную.
    """
    section = rubric.get("strategy_fit") or {}
    criteria = section.get("criteria") or []
    evidence = list(evidence or [])

    known = {c["id"] for c in criteria}
    unknown = set(answers) - known
    if unknown:
        raise RubricError(f"неизвестные критерии: {sorted(unknown)}")

    breakdown: list[dict[str, Any]] = []
    normalised = 0.0

    for criterion in criteria:
        code = criterion["id"]
        if code not in answers:
            raise RubricError(f"не отвечен критерий {code}")
        option_key = answers[code]
        options = criterion.get("options") or {}
        if option_key not in options:
            raise RubricError(
                f"недопустимый ответ {option_key!r} для критерия {code}; "
                f"ожидалось одно из {sorted(options)}"
            )
        weight = float(criterion.get("weight", 0))
        value = float(options[option_key].get("value", 0))
        contribution = weight * value
        normalised += contribution
        breakdown.append(
            {
                "criterion": code,
                "title": criterion.get("title"),
                "answer": option_key,
                "answer_title": options[option_key].get("title"),
                "weight": weight,
                "value": value,
                "contribution": round(contribution, 4),
            }
        )

    scale = section.get("scale") or {}
    raw_min = float(scale.get("raw_min", 1))
    raw_max = float(scale.get("raw_max", 10))
    raw = raw_min + normalised * (raw_max - raw_min)

    confidence_config = section.get("confidence") or {}
    high_min = int(confidence_config.get("high_min_evidence", 2))
    medium_min = int(confidence_config.get("medium_min_evidence", 1))
    if len(evidence) >= high_min:
        confidence = CONFIDENCE_HIGH
    elif len(evidence) >= medium_min:
        confidence = CONFIDENCE_MEDIUM
    else:
        confidence = CONFIDENCE_LOW

    return StrategyAssessment(
        raw_score=round(raw, 3),
        normalised=round(normalised, 4),
        answers=dict(answers),
        breakdown=breakdown,
        confidence=confidence,
        rationale=rationale.strip(),
        evidence=evidence,
        rubric_version=int(section.get("rubric_version", 1)),
    )


# --- F6 ----------------------------------------------------------------------


def score_dependencies(
    teams: list[dict[str, Any]],
    rubric: dict[str, Any],
    rationale: str = "",
    evidence: list[str] | None = None,
) -> DependencyAssessment:
    """Считает балл F6 по списку зависимостей с указанием типа связи.

    Прежняя формула штрафовала за само число вовлечённых команд. Три команды,
    которые достаточно уведомить, и одна чужая поставка, без которой работа не
    начнётся, — разные по управляемости, и одинаковый штраф за них искажает
    ранжирование. Поэтому штраф берётся по типу связи.
    """
    section = rubric.get("dependencies") or {}
    types = section.get("types") or {}
    base = float(section.get("base_score", 1.0))
    floor = float(section.get("floor", 0.2))

    normalised_teams: list[dict[str, Any]] = []
    penalty = 0.0
    blocking = 0

    for entry in teams:
        if not isinstance(entry, dict):
            raise RubricError(f"зависимость должна быть объектом, получено {type(entry).__name__}")
        name = str(entry.get("team") or "").strip()
        if not name:
            raise RubricError("у зависимости не указана команда")
        kind = str(entry.get("type") or "").strip()
        if kind not in types:
            raise RubricError(
                f"недопустимый тип зависимости {kind!r}; ожидалось одно из {sorted(types)}"
            )
        penalty += float(types[kind].get("penalty", 0))
        blocking += int(kind == "blocking")
        normalised_teams.append(
            {
                "team": name,
                "type": kind,
                "type_title": types[kind].get("title"),
                "reason": str(entry.get("reason") or "").strip(),
            }
        )

    score = max(floor, base - penalty)

    return DependencyAssessment(
        score=round(score, 4),
        teams=normalised_teams,
        blocking_count=blocking,
        rationale=rationale.strip(),
        evidence=list(evidence or []),
        rubric_version=int(section.get("rubric_version", 1)),
    )
