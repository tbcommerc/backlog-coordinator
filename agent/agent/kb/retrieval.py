"""Retrieval harness - enforces grounded generation.

Only curated approved sources are searchable; the search result carries
source labels for traceability. Exposes the fact-grounded retrieval used by
the dialogue engine to answer clarification requests and to populate the
'Источники' section of a draft.
"""
from .loader import kb
from .search import search_engine


class RetrievalService:
    def __init__(self, engine=None):
        self.engine = engine or search_engine

    def answer_from_kb(self, query: str, k: int = 4) -> list[dict]:
        """Factual context for clarification intents (grounded answers)."""
        return self.engine.retrieve_context(query, k=k)

    def stats(self) -> dict:
        return kb.stats()


retrieval = RetrievalService()
