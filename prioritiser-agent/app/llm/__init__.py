"""LLM-адаптеры. Провайдер выбирается переменной PRIORITISER_LLM_PROVIDER."""

from app.llm.base import LLMAdapter, TaskHints
from app.llm.factory import get_adapter

__all__ = ["LLMAdapter", "TaskHints", "get_adapter"]
