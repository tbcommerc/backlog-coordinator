"""Оценка факторов F5 «Стратегическое соответствие» и F6 «Зависимость от команд».

По ТЗ (Ф16, И3) оба значения приходят от внешнего агента Strategy Decomposer.
Решением владельца от 2026-08-11 оценка перенесена внутрь проекта: субагенты
отвечают на критерии рубрики, балл считает код, суждение сохраняется с
обоснованием и ссылками на источники.
"""

from app.strategy.analysts import get_dependency_analyst, get_strategy_analyst
from app.strategy.decomposer import StrategyFit, get_strategy_provider
from app.strategy.rubric import (
    DependencyAssessment,
    RubricError,
    StrategyAssessment,
    score_dependencies,
    score_strategy,
)

__all__ = [
    "DependencyAssessment",
    "RubricError",
    "StrategyAssessment",
    "StrategyFit",
    "get_dependency_analyst",
    "get_strategy_analyst",
    "get_strategy_provider",
    "score_dependencies",
    "score_strategy",
]
