"""RAG над бэклогом и обезличенной базой знаний трайба."""

from app.rag.corpus import build_corpus
from app.rag.search import search_corpus

__all__ = ["build_corpus", "search_corpus"]
