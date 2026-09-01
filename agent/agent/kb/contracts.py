"""Source-agnostic contracts for knowledge retrieval.

The agent consumes these contracts and does not need to know whether knowledge
came from Markdown, a database, an external RAG service, or another provider.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class KnowledgeRecord:
    """A normalized unit of knowledge exposed by any source adapter."""

    record_id: str
    content: str
    source_id: str
    source_type: str
    title: str = ""
    section: str | None = None
    uri: str | None = None
    status: str = "approved"
    version: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievalResult:
    """A provider-independent search result with traceability metadata."""

    record: KnowledgeRecord
    # Provider-normalized confidence in the [0, 1] range. ``raw_score`` keeps
    # the native BM25/similarity/distance value for diagnostics.
    score: float | None = None
    raw_score: float | None = None
    provider: str = ""
    rank: int | None = None
    highlights: tuple[str, ...] = ()

    @property
    def source_label(self) -> str:
        if self.record.section:
            return f"{self.record.title} · {self.record.section}"
        return self.record.title or self.record.source_id

    def to_dict(self, text_limit: int | None = 600) -> dict[str, Any]:
        """Serialize with legacy keys used by Q&A and requirement drafts."""
        text = self.record.content
        if text_limit is not None:
            text = text[:text_limit]
        return {
            "doc_id": self.record.source_id,
            "source": self.source_label,
            "text": text,
            "record_id": self.record.record_id,
            "source_type": self.record.source_type,
            "title": self.record.title,
            "section": self.record.section,
            "uri": self.record.uri,
            "score": self.score,
            "raw_score": self.raw_score,
            "provider": self.provider,
            "rank": self.rank,
            "version": self.record.version,
            "status": self.record.status,
            "updated_at": self.record.updated_at,
            "metadata": dict(self.record.metadata),
        }


@dataclass(frozen=True)
class RetrievalPolicy:
    """Provider-neutral filtering rules applied after source retrieval."""

    default_min_score: float = 0.25
    min_score_by_source_type: dict[str, float] = field(default_factory=dict)
    allow_unscored: bool = True
    priority_by_source_type: dict[str, int] = field(default_factory=lambda: {
        "markdown": 300, "requirements_history": 250, "database": 200, "rag": 100,
    })
    priority_by_status: dict[str, int] = field(default_factory=lambda: {
        "approved": 40, "in_progress": 30, "draft": 20, "archived": -50,
    })
    max_age_days: int | None = None

    def threshold_for(self, source_type: str) -> float:
        return self.min_score_by_source_type.get(source_type, self.default_min_score)

    def accepts(self, result: RetrievalResult) -> bool:
        if self.max_age_days is not None and result.record.updated_at:
            try:
                updated = datetime.fromisoformat(result.record.updated_at.replace("Z", "+00:00"))
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - updated).days > self.max_age_days:
                    return False
            except ValueError:
                pass
        if result.score is None:
            return self.allow_unscored
        return result.score >= self.threshold_for(result.record.source_type)

    def rank_key(self, result: RetrievalResult) -> tuple:
        source_priority = self.priority_by_source_type.get(result.record.source_type, 0)
        status_priority = self.priority_by_status.get(result.record.status.lower(), 0)
        return (
            -source_priority,
            -status_priority,
            -(result.score if result.score is not None else -1.0),
            result.rank if result.rank is not None else 10**9,
            result.provider,
            result.record.record_id,
        )


@runtime_checkable
class KnowledgeSource(Protocol):
    """Adapter contract implemented by Markdown, DB, RAG, and API sources."""

    source_id: str
    source_type: str

    def retrieve(
        self,
        query: str,
        k: int = 6,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievalResult]: ...

    def stats(self) -> dict[str, Any]: ...
