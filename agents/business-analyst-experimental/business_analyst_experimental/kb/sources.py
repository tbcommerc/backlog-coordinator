"""Adapters for concrete knowledge source types."""
import re
from typing import Any
from urllib.parse import quote

from .contracts import KnowledgeRecord, RetrievalResult
from .loader import kb
from .requirements_history import history
from .search import search_engine


class MarkdownKnowledgeSource:
    """Expose the current manifest/Markdown KB through the common contract."""

    source_id = "curated_markdown"
    source_type = "markdown"

    def __init__(self, engine=None, knowledge_base=None):
        self.engine = engine or search_engine
        self.knowledge_base = knowledge_base or kb

    def retrieve(
        self,
        query: str,
        k: int = 6,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievalResult]:
        hits = self.engine.search_scored(query, k=k)
        results = []
        for rank, hit in enumerate(hits, start=1):
            chunk = hit.chunk
            section_key = re.sub(r"[^a-zа-яё0-9]+", "-", chunk.section.lower()).strip("-")
            record_id = f"{chunk.doc_id}#{section_key}" if section_key else chunk.doc_id
            encoded_section = quote(section_key, safe="")
            uri = f"kb://{quote(chunk.doc_id, safe='')}"
            if encoded_section:
                uri += f"#{encoded_section}"
            metadata = {
                "domain": chunk.domain,
                "priority": chunk.priority,
                "products": list(chunk.products),
                "modules": list(chunk.modules),
                "processes": list(chunk.processes),
            }
            record = KnowledgeRecord(
                record_id=record_id,
                content=chunk.text,
                source_id=chunk.doc_id,
                source_type=self.source_type,
                title=chunk.doc_title,
                section=chunk.section or None,
                uri=uri,
                status=chunk.status,
                version=chunk.version,
                updated_at=chunk.updated_at,
                metadata=metadata,
            )
            results.append(RetrievalResult(
                record=record,
                score=hit.score,
                raw_score=round(hit.raw_score, 4),
                provider=self.source_id,
                rank=rank,
            ))
        return results

    def stats(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            **self.knowledge_base.stats(),
        }


markdown_source = MarkdownKnowledgeSource()


class RequirementsHistorySource:
    """Expose requirement history independently of its current JSON storage."""

    source_id = "requirements_history"
    source_type = "requirements_history"

    def __init__(self, history_store=None):
        self.history_store = history_store or history

    def retrieve(
        self,
        query: str,
        k: int = 3,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievalResult]:
        results = []
        for rank, item in enumerate(self.history_store.find_similar(query, limit=k), start=1):
            requirement_id = str(item.get("id", f"history:{rank}"))
            content = "\n".join(part for part in (
                item.get("title", ""),
                item.get("summary", ""),
                item.get("decision", ""),
                item.get("reason", ""),
            ) if part)
            metadata = {key: value for key, value in item.items() if key != "score"}
            record = KnowledgeRecord(
                record_id=requirement_id,
                content=content,
                source_id=self.source_id,
                source_type=self.source_type,
                title=item.get("title", requirement_id),
                uri=f"requirement://{requirement_id}",
                status=item.get("status", ""),
                updated_at=item.get("updated_at") or item.get("modified_at") or item.get("date"),
                metadata=metadata,
            )
            results.append(RetrievalResult(
                record=record,
                score=item.get("score"),
                raw_score=item.get("score"),
                provider=self.source_id,
                rank=rank,
            ))
        return results

    def find_similar(self, query: str, limit: int = 3) -> list[dict]:
        """Compatibility shape consumed by the requirement composer."""
        return [
            {"score": result.score, **result.record.metadata}
            for result in self.retrieve(query, k=limit)
        ]

    def stats(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            "items": len(self.history_store.items),
        }


requirements_history_source = RequirementsHistorySource()
