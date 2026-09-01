"""Configurable adapters for external RAG services and read-only databases."""
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
import math
from typing import Any

from .contracts import KnowledgeRecord, RetrievalResult


ResultFetcher = Callable[[str, int, dict[str, Any] | None], Iterable[Mapping[str, Any]]]
ScoreNormalizer = Callable[[float], float]


def normalized_score(value: float) -> float:
    """Accept an already calibrated confidence and clamp it to [0, 1]."""
    return max(0.0, min(1.0, float(value)))


def signed_cosine_score(value: float) -> float:
    """Convert cosine similarity from [-1, 1] to confidence [0, 1]."""
    return normalized_score((float(value) + 1.0) / 2.0)


def distance_score(value: float) -> float:
    """Convert a non-negative distance (lower is better) to confidence."""
    return 1.0 / (1.0 + max(0.0, float(value)))


def exponential_distance_score(value: float) -> float:
    """Convert a non-negative distance using exp(-distance)."""
    return math.exp(-max(0.0, float(value)))


@dataclass(frozen=True)
class ResultFieldMap:
    """Map provider response fields to the common knowledge contract."""

    content: str = "content"
    record_id: str = "id"
    title: str = "title"
    section: str = "section"
    uri: str = "uri"
    status: str = "status"
    version: str = "version"
    updated_at: str = "updated_at"
    score: str = "score"
    metadata: str = "metadata"
    source_id: str = "source_id"
    defaults: dict[str, Any] = field(default_factory=dict)


def _value(item: Mapping[str, Any], path: str, default=None):
    """Read flat or dotted paths from mapping-like provider responses."""
    if not path:
        return default
    current: Any = item
    for part in path.split("."):
        if not isinstance(current, Mapping) or part not in current:
            return default
        current = current[part]
    return current


class MappingKnowledgeSource:
    """Base adapter for providers returning mapping/dictionary rows."""

    def __init__(
        self,
        *,
        source_id: str,
        source_type: str,
        fetcher: ResultFetcher,
        fields: ResultFieldMap | None = None,
        score_normalizer: ScoreNormalizer | None = normalized_score,
        stats_fetcher: Callable[[], Mapping[str, Any]] | None = None,
    ):
        self.source_id = source_id
        self.source_type = source_type
        self.fetcher = fetcher
        self.fields = fields or ResultFieldMap()
        self.score_normalizer = score_normalizer
        self.stats_fetcher = stats_fetcher

    def retrieve(
        self,
        query: str,
        k: int = 6,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievalResult]:
        if not query.strip() or k <= 0:
            return []
        rows = self.fetcher(query, k, filters)
        results = []
        for row in rows:
            if len(results) >= k:
                break
            content = str(_value(row, self.fields.content, "") or "").strip()
            if not content:
                continue
            rank = len(results) + 1
            defaults = self.fields.defaults
            record_id = str(_value(
                row, self.fields.record_id, defaults.get("record_id", f"{self.source_id}:{rank}")
            ))
            raw_score = _value(row, self.fields.score)
            raw_score = float(raw_score) if raw_score is not None else None
            score = None
            if raw_score is not None and self.score_normalizer is not None:
                score = normalized_score(self.score_normalizer(raw_score))
            metadata = _value(row, self.fields.metadata, defaults.get("metadata", {})) or {}
            if not isinstance(metadata, Mapping):
                metadata = {"provider_metadata": metadata}
            record = KnowledgeRecord(
                record_id=record_id,
                content=content,
                source_id=str(_value(row, self.fields.source_id, self.source_id)),
                source_type=self.source_type,
                title=str(_value(row, self.fields.title, defaults.get("title", "")) or ""),
                section=_value(row, self.fields.section, defaults.get("section")),
                uri=_value(row, self.fields.uri, defaults.get("uri")),
                status=str(_value(row, self.fields.status, defaults.get("status", "approved"))),
                version=_value(row, self.fields.version, defaults.get("version")),
                updated_at=_value(row, self.fields.updated_at, defaults.get("updated_at")),
                metadata=dict(metadata),
            )
            results.append(RetrievalResult(
                record=record,
                score=score,
                raw_score=raw_score,
                provider=self.source_id,
                rank=rank,
            ))
        return results

    def stats(self) -> dict[str, Any]:
        provider_stats = dict(self.stats_fetcher()) if self.stats_fetcher else {}
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            **provider_stats,
        }


class ExternalRAGSource(MappingKnowledgeSource):
    """Adapter for an external RAG/search API supplied by the application."""

    def __init__(self, *, source_id: str, fetcher: ResultFetcher, **kwargs):
        super().__init__(
            source_id=source_id,
            source_type="rag",
            fetcher=fetcher,
            **kwargs,
        )


class DatabaseKnowledgeSource(MappingKnowledgeSource):
    """Adapter over an application-owned, read-only database search callback.

    The adapter never constructs or executes SQL and therefore cannot mutate a
    database. Query construction, access control, and transaction mode remain
    the responsibility of the injected callback.
    """

    def __init__(self, *, source_id: str, fetcher: ResultFetcher, **kwargs):
        super().__init__(
            source_id=source_id,
            source_type="database",
            fetcher=fetcher,
            **kwargs,
        )
