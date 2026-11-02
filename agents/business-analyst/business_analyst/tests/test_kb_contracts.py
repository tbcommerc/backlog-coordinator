from business_analyst.kb.contracts import (
    KnowledgeRecord,
    KnowledgeSource,
    RetrievalPolicy,
    RetrievalResult,
)
from business_analyst.kb.retrieval import RetrievalService
from business_analyst.kb.sources import MarkdownKnowledgeSource, RequirementsHistorySource


class _ExternalRAG:
    source_id = "external_rag"
    source_type = "rag"

    def retrieve(self, query, k=6, filters=None):
        record = KnowledgeRecord(
            record_id="rag:42",
            content="Ответ внешнего RAG",
            source_id="corporate-rag",
            source_type=self.source_type,
            title="Корпоративная база",
            uri="https://rag.example/items/42",
            metadata={"acl": "internal"},
        )
        return [RetrievalResult(record=record, score=0.91, provider=self.source_id, rank=1)]

    def stats(self):
        return {"source_id": self.source_id, "source_type": self.source_type}


def test_external_source_satisfies_common_protocol():
    assert isinstance(_ExternalRAG(), KnowledgeSource)


def test_retrieval_service_accepts_non_markdown_source():
    service = RetrievalService(sources=[_ExternalRAG()])

    result = service.answer_from_kb("вопрос", k=1)[0]

    assert result["record_id"] == "rag:42"
    assert result["source_type"] == "rag"
    assert result["score"] == 0.91
    assert result["doc_id"] == "corporate-rag"


def test_markdown_source_returns_common_result_contract():
    source = MarkdownKnowledgeSource()

    results = source.retrieve("failed settlement", k=1)

    assert results
    assert results[0].record.source_type == "markdown"
    assert results[0].record.record_id
    assert results[0].record.uri.startswith("kb://")
    assert " " not in results[0].record.uri
    assert 0 < results[0].score <= 1
    assert results[0].raw_score > 0


def test_legacy_retrieval_shape_is_preserved():
    result = RetrievalService(sources=[_ExternalRAG()]).answer_from_kb("вопрос", k=1)[0]

    assert result["doc_id"]
    assert result["source"]
    assert result["text"]


class _HistoryStore:
    items = [{"id": "REQ-1"}]

    def find_similar(self, query, limit=3):
        return [{
            "id": "REQ-1",
            "title": "Повторная отправка инструкции",
            "summary": "Повторить расчёт",
            "status": "approved",
            "score": 0.75,
        }]


def test_requirement_history_json_is_exposed_through_adapter():
    source = RequirementsHistorySource(history_store=_HistoryStore())

    result = source.retrieve("повторить расчёт", k=1)[0]

    assert result.record.record_id == "REQ-1"
    assert result.record.source_type == "requirements_history"
    assert result.score == 0.75
    assert source.find_similar("повторить расчёт", limit=1)[0]["id"] == "REQ-1"


class _LowConfidenceSource(_ExternalRAG):
    def retrieve(self, query, k=6, filters=None):
        result = super().retrieve(query, k, filters)[0]
        return [RetrievalResult(
            record=result.record,
            score=0.1,
            raw_score=12.0,
            provider=self.source_id,
            rank=1,
        )]


def test_retrieval_policy_filters_low_confidence_results():
    service = RetrievalService(
        sources=[_LowConfidenceSource()],
        policy=RetrievalPolicy(default_min_score=0.3),
    )

    assert service.retrieve("вопрос") == []


def test_retrieval_policy_supports_source_specific_thresholds():
    service = RetrievalService(
        sources=[_LowConfidenceSource()],
        policy=RetrievalPolicy(
            default_min_score=0.3,
            min_score_by_source_type={"rag": 0.05},
        ),
    )

    assert service.retrieve("вопрос")


def test_unscored_database_like_results_are_configurable():
    record = KnowledgeRecord(
        record_id="db:1",
        content="Точная запись",
        source_id="requirements_db",
        source_type="database",
    )

    assert RetrievalPolicy(allow_unscored=True).accepts(RetrievalResult(record))
    assert not RetrievalPolicy(allow_unscored=False).accepts(RetrievalResult(record))


class _StaticSource:
    def __init__(self, source_type, score, status="approved", updated_at=None):
        self.source_id = source_type
        self.source_type = source_type
        self.score = score
        self.status = status
        self.updated_at = updated_at

    def retrieve(self, query, k=6, filters=None):
        return [RetrievalResult(
            KnowledgeRecord(
                record_id=f"{self.source_type}:1", content=self.source_type,
                source_id=self.source_id, source_type=self.source_type,
                status=self.status, updated_at=self.updated_at,
            ),
            score=self.score, provider=self.source_id, rank=1,
        )]

    def stats(self):
        return {}


def test_retrieval_policy_prioritizes_authoritative_source_before_raw_score():
    service = RetrievalService(sources=[
        _StaticSource("rag", 0.99),
        _StaticSource("markdown", 0.40),
    ])

    results = service.retrieve("вопрос", k=2)

    assert [item.record.source_type for item in results] == ["markdown", "rag"]


def test_retrieval_policy_can_reject_stale_records():
    service = RetrievalService(
        sources=[_StaticSource("rag", 0.9, updated_at="2020-01-01T00:00:00Z")],
        policy=RetrievalPolicy(max_age_days=30),
    )

    assert service.retrieve("вопрос") == []
