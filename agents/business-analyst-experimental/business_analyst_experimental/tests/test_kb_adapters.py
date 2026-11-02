import pytest

from business_analyst_experimental.kb.adapters import (
    DatabaseKnowledgeSource,
    ExternalRAGSource,
    ResultFieldMap,
    distance_score,
    signed_cosine_score,
)
from business_analyst_experimental.kb.contracts import KnowledgeSource, RetrievalPolicy
from business_analyst_experimental.kb.retrieval import RetrievalService


def test_external_rag_maps_nested_provider_response():
    def fetcher(query, k, filters):
        assert query == "расчёты"
        assert filters == {"module": "settlement"}
        return [{
            "chunk": {"id": "c-42", "text": "Порядок обработки расчёта"},
            "document": {"name": "Регламент", "url": "https://kb/doc/7"},
            "similarity": 0.82,
            "attributes": {"acl": "internal"},
        }]

    source = ExternalRAGSource(
        source_id="corporate_rag",
        fetcher=fetcher,
        fields=ResultFieldMap(
            content="chunk.text",
            record_id="chunk.id",
            title="document.name",
            uri="document.url",
            score="similarity",
            metadata="attributes",
        ),
    )

    result = source.retrieve("расчёты", k=3, filters={"module": "settlement"})[0]

    assert isinstance(source, KnowledgeSource)
    assert result.record.record_id == "c-42"
    assert result.record.title == "Регламент"
    assert result.record.uri == "https://kb/doc/7"
    assert result.score == 0.82
    assert result.record.metadata["acl"] == "internal"


def test_database_adapter_only_calls_injected_read_callback():
    calls = []

    def read_search(query, k, filters):
        calls.append((query, k, filters))
        return [{"id": 17, "body": "Запись из базы", "name": "Требование 17"}]

    source = DatabaseKnowledgeSource(
        source_id="requirements_db",
        fetcher=read_search,
        fields=ResultFieldMap(content="body", title="name", score=""),
        score_normalizer=None,
    )

    result = source.retrieve("запись", k=1, filters={"status": "approved"})[0]

    assert calls == [("запись", 1, {"status": "approved"})]
    assert result.record.source_type == "database"
    assert result.record.record_id == "17"
    assert result.score is None


def test_database_adapter_works_with_unscored_policy():
    source = DatabaseKnowledgeSource(
        source_id="catalog",
        fetcher=lambda query, k, filters: [{"id": "A", "content": "Точное значение"}],
        score_normalizer=None,
    )
    service = RetrievalService(
        sources=[source],
        policy=RetrievalPolicy(allow_unscored=True),
    )

    assert service.retrieve("точное значение", k=1)


@pytest.mark.parametrize(
    ("normalizer", "raw", "expected"),
    [
        (signed_cosine_score, -1.0, 0.0),
        (signed_cosine_score, 0.0, 0.5),
        (signed_cosine_score, 1.0, 1.0),
        (distance_score, 0.0, 1.0),
        (distance_score, 1.0, 0.5),
        (distance_score, 3.0, 0.25),
    ],
)
def test_score_normalizers(normalizer, raw, expected):
    assert normalizer(raw) == expected


def test_adapter_skips_empty_records_and_honours_k():
    source = ExternalRAGSource(
        source_id="rag",
        fetcher=lambda query, k, filters: [
            {"id": "empty", "content": ""},
            {"id": "one", "content": "Первый", "score": 0.9},
            {"id": "two", "content": "Второй", "score": 0.8},
        ],
    )

    results = source.retrieve("запрос", k=2)

    assert [result.record.record_id for result in results] == ["one", "two"]
