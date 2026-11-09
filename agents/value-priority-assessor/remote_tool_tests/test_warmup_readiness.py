from types import SimpleNamespace
import pytest
from value_priority_assessor.service import warmup


@pytest.mark.parametrize("vector_enabled",[False,True])
def test_configured_dense_index_must_be_available(monkeypatch,vector_enabled):
    settings=SimpleNamespace(strategy_use_rag=True,strategy_provider="agent",dependency_provider="agent",
        rag_vector=True,value_analogy=False)
    monkeypatch.setattr(warmup,"get_settings",lambda:settings)
    monkeypatch.setattr("value_priority_assessor.rag.search.index_status",lambda:{
        "vector_enabled":vector_enabled,"retrieval_mode":"dual_rrf" if vector_enabled else "bm25"})
    if vector_enabled:assert warmup._warm_runtime()=={"rag":"dual_rrf"}
    else:
        with pytest.raises(RuntimeError,match="rag_index_not_ready"):warmup._warm_runtime()


def test_available_snapshot_requires_successful_analogy_index(monkeypatch):
    settings=SimpleNamespace(strategy_use_rag=False,value_analogy=True)
    monkeypatch.setattr(warmup,"get_settings",lambda:settings)
    monkeypatch.setattr("value_priority_assessor.snapshot.get_snapshot",lambda:SimpleNamespace(available=True))
    monkeypatch.setattr("value_priority_assessor.service.scenarios._analogy_index",lambda _:SimpleNamespace(available=False))
    with pytest.raises(RuntimeError,match="analogy_index_not_ready"):warmup._warm_runtime()
