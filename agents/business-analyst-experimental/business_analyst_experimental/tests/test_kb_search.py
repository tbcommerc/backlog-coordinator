from business_analyst_experimental.kb.loader import Chunk
from business_analyst_experimental.kb.search import KBSearch, _tokenize


class _TestKnowledgeBase:
    def __init__(self, chunks):
        self._chunks = chunks

    def approved_chunks(self):
        return [chunk for chunk in self._chunks if chunk.status == "approved"]


def _chunk(doc_id, section, text, *, status="approved", priority=80, **metadata):
    return Chunk(
        doc_id=doc_id,
        doc_title=metadata.pop("doc_title", doc_id),
        domain=metadata.pop("domain", "business"),
        status=status,
        priority=priority,
        section=section,
        text=text,
        products=metadata.pop("products", []),
        modules=metadata.pop("modules", []),
        processes=metadata.pop("processes", []),
    )


def test_tokenizer_normalizes_common_russian_case_endings():
    assert _tokenize("облигаций") == _tokenize("облигациями")
    assert _tokenize("расчёты") == _tokenize("расчётов")


def test_search_uses_section_title_and_document_title():
    engine = KBSearch(knowledge_base=_TestKnowledgeBase([
        _chunk("statuses", "Статус Failed", "Инструкция ожидает обработки."),
        _chunk("other", "Общая информация", "Инструкция ожидает обработки."),
    ]))

    results = engine.search("failed", k=2)

    assert results[0].doc_id == "statuses"


def test_search_uses_metadata_for_ranking():
    engine = KBSearch(knowledge_base=_TestKnowledgeBase([
        _chunk("bonds", "Обработка", "Повторная отправка инструкции.", products=["облигации"]),
        _chunk("shares", "Обработка", "Повторная отправка инструкции.", products=["акции"]),
    ]))

    results = engine.search("инструкция по облигациям", k=2)

    assert results[0].doc_id == "bonds"


def test_search_excludes_draft_chunks():
    engine = KBSearch(knowledge_base=_TestKnowledgeBase([
        _chunk("draft", "Уникальный термин", "супертермин", status="draft", priority=100),
        _chunk("approved", "Другое", "супертермин", priority=1),
    ]))

    results = engine.search("супертермин")

    assert [result.doc_id for result in results] == ["approved"]


def test_real_kb_finds_failed_settlement_status_first():
    from business_analyst_experimental.kb.search import search_engine

    results = search_engine.search("причины несостоявшихся расчётов failed settlement", k=3)

    assert results
    assert results[0].doc_id == "settlement_statuses"
    assert results[0].section == "Статус Failed (несостоявшийся расчёт)"


def test_scored_search_returns_normalized_and_native_scores():
    from business_analyst_experimental.kb.search import search_engine

    hit = search_engine.search_scored("failed settlement", k=1)[0]

    assert 0 < hit.score <= 1
    assert hit.raw_score > 0


def test_question_words_do_not_reduce_subject_confidence():
    from business_analyst_experimental.kb.search import search_engine

    direct = search_engine.search_scored("облигации", k=1)[0]
    conversational = search_engine.search_scored("что такое облигации", k=1)[0]

    assert conversational.chunk.doc_id == "products"
    assert conversational.score == direct.score
