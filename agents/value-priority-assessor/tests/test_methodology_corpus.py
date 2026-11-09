from value_priority_assessor.rag import corpus


def test_deployment_instructions_never_enter_business_corpus(tmp_path, monkeypatch):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "METHODOLOGY.md").write_text("# Value\nBusiness method evidence", encoding="utf-8")
    operational = docs / "REMOTE_TOOLS.md"
    operational.write_text("# Deployment\noperational sentinel", encoding="utf-8")
    monkeypatch.setattr(corpus, "REPO_ROOT", tmp_path)
    before = corpus._methodology_chunks()
    assert before
    assert "Business method evidence" in str(before)
    assert "operational sentinel" not in str(before)
    operational.write_text("# Completely changed deployment", encoding="utf-8")
    assert corpus._methodology_chunks() == before
