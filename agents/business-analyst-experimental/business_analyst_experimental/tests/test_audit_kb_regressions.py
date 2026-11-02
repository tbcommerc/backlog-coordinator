import json

from business_analyst_experimental.kb.contracts import KnowledgeRecord, RetrievalResult
from business_analyst_experimental.kb.loader import KnowledgeBase
from business_analyst_experimental.kb.search import KBSearch
from business_analyst_experimental.kb.sources import MarkdownKnowledgeSource


def test_serialization_retains_qualifying_clause_after_600_characters():
    content = "Пояснение. " * 75 + "Исключение: повторная отправка запрещена после подтверждения."
    result = RetrievalResult(KnowledgeRecord("r", content, "d", "markdown"))
    assert result.to_dict()["text"] == content
    assert "[фрагмент сокращён]" in result.to_dict(text_limit=600)["text"]


def test_markdown_metadata_preserves_declared_version_and_date(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"documents": [{
        "id": "guide", "title": "Реестр", "status": "approved", "version": "2.1",
        "updated_at": "2026-08-30", "priority": 90,
    }]}, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "guide.md").write_text("## Реестр\nРеестр содержит историю статусов отправки.", encoding="utf-8")
    kb = KnowledgeBase(tmp_path)
    source = MarkdownKnowledgeSource(engine=KBSearch(knowledge_base=kb), knowledge_base=kb)
    result = source.retrieve("история статусов", k=1)[0]
    assert result.to_dict()["version"] == "2.1"
    assert result.to_dict()["updated_at"] == "2026-08-30"
