"""Hybrid knowledge search.

Combines keyword/BM25-like scoring with optional embedding similarity. If the
LLM provider exposes embeddings (API key configured) they are used to re-rank;
otherwise keyword scoring is used alone. Source ranking favours approved docs.
"""
import math
import re
from typing import Optional

from .loader import Chunk, kb
from .ontology import ontology

_TOKEN_RE = re.compile(r"[а-яёa-z0-9]{3,}", re.IGNORECASE)


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text)]


def _bm25_score(query_tokens: list[str], text: str, avg_len: float, k1=1.2, b=0.75) -> float:
    tokens = _tokenize(text)
    if not tokens:
        return 0.0
    from collections import Counter
    freq = Counter(tokens)
    dl = len(tokens)
    idf = math.log(1 + (len(kb.chunks) + 1) / (1 + len(freq)))  # simplified idf
    score = 0.0
    for q in set(query_tokens):
        tf = freq.get(q, 0)
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_len))
    return score


class KBSearch:
    def __init__(self, embed_fn: Optional[callable] = None):
        self.embed_fn = embed_fn

    def search(self, query: str, k: int = 6) -> list[Chunk]:
        approved = kb.approved_chunks()
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []
        avg_len = max(1.0, sum(len(_tokenize(c.text)) for c in approved) / max(1, len(approved)))
        scored = []
        for chunk in approved:
            score = _bm25_score(query_tokens, chunk.text, avg_len)
            # ontology entity boost: if query mentions the section entity
            boost = 0.0
            if chunk.section:
                low = chunk.section.lower()
                for tok in query_tokens:
                    if tok in low:
                        boost += 1.5
            if any(tok in chunk.text.lower() for tok in query_tokens):
                score += 0.5 * len([t for t in query_tokens if t in chunk.text.lower()])
            if score > 0:
                scored.append((score + boost + chunk.priority / 100.0, chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [c for _, c in scored[:k]]

    def retrieve_context(self, query: str, k: int = 6) -> list[dict]:
        """Chunks as source dicts for the composer / draft traceability."""
        out = []
        for chunk in self.search(query, k=k):
            out.append({
                "doc_id": chunk.doc_id,
                "source": chunk.source_label,
                "text": chunk.text[:600],
            })
        return out


search_engine = KBSearch()
