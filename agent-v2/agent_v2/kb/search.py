"""Lexical knowledge search with BM25 ranking and metadata boosts."""
from collections import Counter
from dataclasses import dataclass
import math
import re
from typing import Optional

from .loader import Chunk, kb
from .ontology import stem

_TOKEN_RE = re.compile(r"[а-яёa-z0-9]{3,}", re.IGNORECASE)
_STOP_WORDS = {
    "что", "тако", "как", "каки", "какой", "кака", "каких",
    "есть", "это", "для", "или", "при", "про", "где", "когда", "почему",
    "зачем", "можно", "нужн", "расскаж", "объясн", "покаж", "подскаж",
    "the", "and", "for", "what", "how", "where", "when", "with",
}


@dataclass(frozen=True)
class SearchHit:
    """A lexical hit with native BM25 score and normalized confidence."""

    chunk: Chunk
    raw_score: float
    score: float


def _tokenize(text: str) -> list[str]:
    """Normalize Russian/English terms identically for queries and sources."""
    normalized = [stem(t.lower().replace("ё", "е")) for t in _TOKEN_RE.findall(text)]
    return [token for token in normalized if token not in _STOP_WORDS]


def _bm25_score(
    query_tokens: list[str],
    tokens: list[str],
    avg_len: float,
    document_count: int,
    document_frequency: Counter,
    k1: float = 1.2,
    b: float = 0.75,
) -> float:
    """Calculate BM25 using corpus-level document frequency."""
    if not tokens:
        return 0.0
    freq = Counter(tokens)
    dl = len(tokens)
    score = 0.0
    for q in set(query_tokens):
        tf = freq.get(q, 0)
        if not tf:
            continue
        df = document_frequency.get(q, 0)
        idf = math.log(1 + (document_count - df + 0.5) / (df + 0.5))
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_len))
    return score


def _chunk_text(chunk: Chunk) -> str:
    """Text participating in BM25, including useful document metadata."""
    metadata = " ".join([
        chunk.doc_title,
        chunk.section,
        chunk.domain,
        *map(str, chunk.products),
        *map(str, chunk.modules),
        *map(str, chunk.processes),
    ])
    return f"{metadata}\n{chunk.text}"


class KBSearch:
    def __init__(self, embed_fn: Optional[callable] = None, knowledge_base=None):
        self.embed_fn = embed_fn
        self.kb = knowledge_base or kb

    def search_scored(self, query: str, k: int = 6) -> list[SearchHit]:
        approved = self.kb.approved_chunks()
        query_tokens = _tokenize(query)
        if not query_tokens or not approved or k <= 0:
            return []

        corpus_tokens = [_tokenize(_chunk_text(chunk)) for chunk in approved]
        avg_len = max(1.0, sum(map(len, corpus_tokens)) / len(corpus_tokens))
        document_frequency = Counter()
        for tokens in corpus_tokens:
            document_frequency.update(set(tokens))

        scored: list[SearchHit] = []
        unique_query_tokens = set(query_tokens)
        for chunk, tokens in zip(approved, corpus_tokens):
            bm25 = _bm25_score(
                query_tokens,
                tokens,
                avg_len,
                len(approved),
                document_frequency,
            )
            section_tokens = set(_tokenize(chunk.section))
            title_tokens = set(_tokenize(chunk.doc_title))
            metadata_tokens = set(_tokenize(" ".join([
                *map(str, chunk.products),
                *map(str, chunk.modules),
                *map(str, chunk.processes),
            ])))
            boost = 1.5 * len(set(query_tokens) & section_tokens)
            boost += 0.6 * len(set(query_tokens) & title_tokens)
            boost += 0.4 * len(set(query_tokens) & metadata_tokens)
            if bm25 > 0:
                raw_score = bm25 + boost + chunk.priority / 100.0
                matched = len(unique_query_tokens & set(tokens))
                coverage = matched / len(unique_query_tokens)
                strength = raw_score / (raw_score + 2.0)
                confidence = round(coverage * strength, 4)
                scored.append(SearchHit(chunk, raw_score, confidence))
        scored.sort(key=lambda hit: (-hit.raw_score, hit.chunk.doc_id, hit.chunk.section))
        return scored[:k]

    def search(self, query: str, k: int = 6) -> list[Chunk]:
        """Compatibility API returning chunks without score details."""
        return [hit.chunk for hit in self.search_scored(query, k=k)]

    def retrieve_context(self, query: str, k: int = 6) -> list[dict]:
        """Chunks as source dicts for the composer / draft traceability."""
        out = []
        for hit in self.search_scored(query, k=k):
            chunk = hit.chunk
            out.append({
                "doc_id": chunk.doc_id,
                "source": chunk.source_label,
                "text": chunk.text[:600],
                "score": hit.score,
                "raw_score": round(hit.raw_score, 4),
            })
        return out


search_engine = KBSearch()
