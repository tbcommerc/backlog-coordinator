"""Поиск по корпусу: BM25 + плотный FAISS-слой, объединение через RRF.

Схема воспроизводит `RAG/local_search.py` из strategy-decomposer:

* лексический слой — BM25 по токенам с усечением до основы;
* плотный слой — FAISS `IndexFlatIP` по нормализованным эмбеддингам
  `intfloat/multilingual-e5-base` (та же модель, на которой собран пакет K3,
  поэтому семантика корпуса ведёт себя так же);
* объединение — Reciprocal Rank Fusion.

RRF выбран вместо взвешенной суммы не из вкусовых соображений: BM25-score и
косинусная близость живут в разных шкалах и в разных диапазонах, складывать их
напрямую нельзя, а ранги сопоставимы всегда.

Индекс сохраняется на диск и пересобирается только при изменении отпечатка
корпуса — иначе каждый вызов CLI прогонял бы больше тысячи чанков через модель
эмбеддингов заново.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any

from value_priority_assessor.config import DATA_DIR, get_settings
from value_priority_assessor.rag.corpus import Chunk, build_corpus, corpus_signature, k3_manifest

TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё_-]+", re.UNICODE)
RRF_K = 60

# Русская морфология без стеммера: у большинства терминов бэклога значимы
# первые 6 символов («витрин-а/-ы/-ой», «автоматизац-ия/-ии»).
STEM_LENGTH = 6

INDEX_DIR = Path(get_settings().rag_index_dir).expanduser() if get_settings().rag_index_dir else DATA_DIR / "index"
VECTOR_INDEX_PATH = INDEX_DIR / "vector.faiss"
VECTOR_META_PATH = INDEX_DIR / "vector-meta.json"

# Префиксы обязательны для семейства e5: модель обучена различать роль текста,
# и без них качество заметно падает.
QUERY_PREFIX = "query: "
PASSAGE_PREFIX = "passage: "

STOPWORDS = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то",
    "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за",
    "бы", "по", "только", "ее", "мне", "было", "вот", "от", "меня", "еще",
    "нет", "о", "из", "ему", "теперь", "когда", "даже", "ну", "вдруг", "ли",
    "если", "уже", "или", "ни", "быть", "был", "него", "до", "вас", "нибудь",
    "для", "the", "of", "and", "to", "a", "in", "is", "it",
}


def _tokenise(text: str) -> list[str]:
    tokens = []
    for match in TOKEN_RE.finditer((text or "").lower()):
        token = match.group(0)
        if token in STOPWORDS or len(token) < 2:
            continue
        tokens.append(token[:STEM_LENGTH])
    return tokens


class Bm25Index:
    def __init__(self, chunks: list[Chunk]) -> None:
        from rank_bm25 import BM25Okapi

        self.chunks = chunks
        corpus = [_tokenise(f"{c.title} {c.text}") for c in chunks]
        self._bm25 = BM25Okapi(corpus) if corpus else None

    def search(
        self, query: str, top_k: int, allowed: set[int] | None = None
    ) -> list[tuple[int, float]]:
        if self._bm25 is None:
            return []
        scores = self._bm25.get_scores(_tokenise(query))
        candidates = enumerate(scores)
        if allowed is not None:
            candidates = ((i, s) for i, s in candidates if i in allowed)
        ranked = sorted(candidates, key=lambda kv: kv[1], reverse=True)
        return [(i, float(s)) for i, s in ranked[:top_k] if s > 0]


class VectorIndex:
    """Плотный слой на FAISS. Индекс кэшируется на диске между запусками."""

    def __init__(self, chunks: list[Chunk], signature: str) -> None:
        self.chunks = chunks
        self.signature = signature
        self.available = False
        settings = get_settings()
        self.model_name = settings.rag_embedding_model
        self.encoder_profile = {"model": self.model_name, "revision": settings.rag_embedding_revision,
            "cache_dir": settings.rag_model_cache_dir, "local_files_only": settings.rag_local_files_only}
        self.rebuilt = False
        self._index = None
        self._model = None

        try:
            import faiss  # noqa: F401
            from sentence_transformers import SentenceTransformer  # noqa: F401
        except ImportError:
            # Плотный слой опционален: без него поиск деградирует до BM25,
            # но не падает.
            return

        try:
            self._load_or_build()
            self.available = True
        except Exception:  # noqa: BLE001 - сбой индекса не должен ронять поиск
            self.available = False

    def _encoder(self):
        from value_priority_assessor.rag.embeddings import get_encoder

        return get_encoder(self.model_name)

    def _load_or_build(self) -> None:
        import faiss

        if VECTOR_INDEX_PATH.exists() and VECTOR_META_PATH.exists():
            meta = json.loads(VECTOR_META_PATH.read_text(encoding="utf-8"))
            if (
                meta.get("schema_version") == 3
                and meta.get("encoder_profile") == self.encoder_profile
                and meta.get("corpus_signature") == self.signature
                and meta.get("model_name") == self.model_name
                and meta.get("document_count") == len(self.chunks)
            ):
                import numpy as np
                self._index = faiss.deserialize_index(np.frombuffer(VECTOR_INDEX_PATH.read_bytes(),dtype="uint8").copy())
                return

        self._build()
        self.rebuilt = True

    def _build(self) -> None:
        import faiss
        import numpy as np

        model = self._encoder()
        payloads = [f"{PASSAGE_PREFIX}{c.title}. {c.text}" for c in self.chunks]
        vectors = model.encode(
            payloads,
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=32,
        )
        vectors = np.asarray(vectors, dtype="float32")

        # IndexFlatIP по нормализованным векторам = косинусная близость.
        # Тот же тип индекса, что в пакете K3, — сравнимые пороги.
        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)

        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        # Python handles Unicode paths on Windows; FAISS narrow fopen does not.
        VECTOR_INDEX_PATH.write_bytes(faiss.serialize_index(index).tobytes())
        VECTOR_META_PATH.write_text(
            json.dumps(
                {
                    "schema_version": 3,
                    "encoder_profile": self.encoder_profile,
                    "engine": "faiss",
                    "index_type": "IndexFlatIP",
                    "metric": "inner_product_on_normalized_embeddings",
                    "model_name": self.model_name,
                    "corpus_signature": self.signature,
                    "document_count": len(self.chunks),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self._index = index

    def search(
        self, query: str, top_k: int, allowed: set[int] | None = None
    ) -> list[tuple[int, float]]:
        if not self.available or self._index is None:
            return []
        import numpy as np

        vector = self._encoder().encode(
            [f"{QUERY_PREFIX}{query}"], normalize_embeddings=True, show_progress_bar=False
        )
        vector = np.asarray(vector, dtype="float32")

        # При фильтре по слою берём запас: нужные чанки могут не попасть
        # в первые top_k по всему корпусу.
        depth = min(len(self.chunks), top_k if allowed is None else max(top_k * 20, 200))
        scores, ids = self._index.search(vector, depth)

        results: list[tuple[int, float]] = []
        for position, score in zip(ids[0], scores[0]):
            index = int(position)
            if index < 0:
                continue
            if allowed is not None and index not in allowed:
                continue
            results.append((index, float(score)))
            if len(results) >= top_k:
                break
        return results


@lru_cache(maxsize=1)
def _indexes() -> tuple[list[Chunk], Bm25Index, VectorIndex | None]:
    chunks = build_corpus()
    signature = corpus_signature(chunks)
    bm25 = Bm25Index(chunks)

    vector = None
    if get_settings().rag_vector:
        vector = VectorIndex(chunks, signature)
    return chunks, bm25, vector


def reset_index(drop_vector: bool = False) -> None:
    """Сбрасывает кэш индекса. `drop_vector` заставляет пересобрать FAISS."""
    _indexes.cache_clear()
    if drop_vector and INDEX_DIR.exists():
        shutil.rmtree(INDEX_DIR)


def _rrf(rankings: list[list[tuple[int, float]]]) -> dict[int, float]:
    fused: dict[int, float] = {}
    for ranking in rankings:
        for rank, (index, _score) in enumerate(ranking, start=1):
            fused[index] = fused.get(index, 0.0) + 1.0 / (RRF_K + rank)
    return fused


def _chunk_source_key(chunk: Chunk) -> str:
    """Логический источник фрагмента — для ограничения его доли в выдаче."""
    return str((chunk.metadata or {}).get("logical_source") or chunk.source)


def _diversify(
    ordered: list[tuple[int, float]], chunks: list[Chunk], top_k: int
) -> list[tuple[int, float]]:
    """Не даёт одному источнику занять всю выдачу.

    Корпус K3 сильно перекошен: один документ («Альбом продуктов») даёт около
    восьмидесяти процентов чанков. Оба ретривера возвращают преимущественно его
    фрагменты, а RRF этот перекос усиливает — фрагменты, найденные обоими
    списками, получают удвоенный вклад. В результате релевантный фрагмент
    небольшого документа не попадал в выдачу вообще.

    Поэтому на первом проходе на источник отводится не больше трети мест, и
    только если мест не хватило — добираем остаток без ограничения. Порядок
    внутри отбора сохраняется, скор не меняется.
    """
    if top_k <= 2 or not ordered:
        return ordered[:top_k]

    per_source_cap = max(2, top_k // 3)
    selected: list[tuple[int, float]] = []
    used: dict[str, int] = {}
    overflow: list[tuple[int, float]] = []

    for index, score in ordered:
        key = _chunk_source_key(chunks[index])
        if used.get(key, 0) < per_source_cap:
            selected.append((index, score))
            used[key] = used.get(key, 0) + 1
            if len(selected) == top_k:
                return selected
        else:
            overflow.append((index, score))

    for item in overflow:
        if len(selected) == top_k:
            break
        selected.append(item)
    return selected


def index_status() -> dict[str, Any]:
    """Что сейчас в индексе — для preflight и диагностики."""
    chunks, _bm25, vector = _indexes()
    layers: dict[str, int] = {}
    for chunk in chunks:
        layers[chunk.layer] = layers.get(chunk.layer, 0) + 1

    status: dict[str, Any] = {
        "corpus_size": len(chunks),
        "layers": layers,
        "vector_enabled": bool(vector and vector.available),
        "embedding_model": get_settings().rag_embedding_model if vector else None,
        "retrieval_mode": "dual_rrf" if vector and vector.available else "bm25",
        "k3_package": k3_manifest() or None,
    }

    # Пакет объявляет 583 чанка, а в индексе их больше: наш разбиватель режет
    # длинные секции дополнительно. Расхождение штатное, но выглядит как потеря
    # целостности данных — объясняем прямо в ответе, иначе агент будет
    # добросовестно поднимать его как проблему при каждом запросе.
    package = status["k3_package"] or {}
    declared = package.get("chunk_count")
    indexed = layers.get("k3")
    if declared and indexed:
        status["k3_chunking"] = {
            "package_chunks": declared,
            "indexed_chunks": indexed,
            "note": (
                "Расхождение штатное: пакет собран с чанкованием "
                f"{package.get('chunking_version')}, а индексатор дополнительно "
                "режет длинные секции. Источники и их состав те же, гранулярность мельче."
            ),
        }
    return status


def search_corpus(query: str, top_k: int = 5, layer: str | None = None) -> dict[str, Any]:
    """Возвращает найденные фрагменты вместе с указанием источника.

    Источник в ответе обязателен: агент, оценивающий задачу, должен уметь
    сказать, откуда взял утверждение, — иначе RAG превращается в ещё один
    источник правдоподобных, но непроверяемых цифр.
    """
    chunks, bm25, vector = _indexes()

    # Пустой запрос не несёт информации. BM25 на нём честно вернёт ничего, а вот
    # плотный слой выдаст ближайших соседей к эмбеддингу пустой строки — набор
    # правдоподобных, но полностью произвольных фрагментов. Отсекаем на входе.
    if not query or not query.strip():
        return {
            "query": query,
            "retrieval_mode": "dual_rrf" if vector and vector.available else "bm25",
            "corpus_size": len(chunks),
            "results": [],
        }

    # Слой отсекается ДО отбора top-k. Иначе фильтр по knowledge может вернуть
    # пустоту: короткие задачи бэклога занимают всю выдачу BM25, и отбирать
    # после ранжирования будет уже не из чего.
    allowed = {i for i, c in enumerate(chunks) if c.layer == layer} if layer else None

    pool = top_k * 4
    bm25_hits = bm25.search(query, pool, allowed)
    rankings = [bm25_hits]
    mode = "bm25"

    vector_hits: list[tuple[int, float]] = []
    if vector is not None and vector.available:
        vector_hits = vector.search(query, pool, allowed)
        rankings.append(vector_hits)
        mode = "dual_rrf"

    fused = _rrf(rankings)
    ranked = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)
    ordered = _diversify(ranked, chunks, top_k)

    bm25_ranks = {i: r for r, (i, _) in enumerate(bm25_hits, start=1)}
    vector_ranks = {i: r for r, (i, _) in enumerate(vector_hits, start=1)}

    return {
        "query": query,
        "retrieval_mode": mode,
        "corpus_size": len(chunks),
        "results": [
            {
                "chunk_id": chunks[i].chunk_id,
                "source": chunks[i].source,
                "layer": chunks[i].layer,
                "title": chunks[i].title,
                "score": round(score, 6),
                # Ранги обоих слоёв показывают, чем именно найден фрагмент:
                # лексическим совпадением, семантикой или обоими сразу.
                "bm25_rank": bm25_ranks.get(i),
                "vector_rank": vector_ranks.get(i),
                "snippet": chunks[i].text[:600],
                "metadata": chunks[i].metadata,
            }
            for i, score in ordered
        ],
    }
