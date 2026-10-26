"""Source-agnostic retrieval facade used by the dialogue engine."""
from typing import Any

from .contracts import KnowledgeSource, RetrievalPolicy, RetrievalResult
from .sources import markdown_source


class RetrievalService:
    def __init__(
        self,
        sources: list[KnowledgeSource] | None = None,
        engine=None,
        policy: RetrievalPolicy | None = None,
    ):
        # ``engine`` is kept for compatibility with existing integrations.
        if sources is not None:
            self.sources = sources
        elif engine is not None:
            from .sources import MarkdownKnowledgeSource
            self.sources = [MarkdownKnowledgeSource(engine=engine)]
        else:
            self.sources = [markdown_source]
        self.policy = policy or RetrievalPolicy()

    def retrieve(
        self,
        query: str,
        k: int = 4,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievalResult]:
        """Retrieve normalized results from all configured knowledge sources."""
        if not query.strip() or k <= 0:
            return []
        results = []
        for source in self.sources:
            results.extend(source.retrieve(query, k=k, filters=filters))
        results = [result for result in results if self.policy.accepts(result)]
        # Calibrated confidence wins across providers. Unscored authoritative
        # sources retain their provider rank after scored results.
        results.sort(key=self.policy.rank_key)
        return results[:k]

    def answer_from_kb(self, query: str, k: int = 4) -> list[dict]:
        """Backward-compatible dictionaries for Q&A and requirement drafts."""
        return [result.to_dict() for result in self.retrieve(query, k=k)]

    def stats(self) -> dict:
        source_stats = [source.stats() for source in self.sources]
        if len(source_stats) == 1:
            return source_stats[0]
        return {"sources": source_stats, "source_count": len(source_stats)}


retrieval = RetrievalService()
