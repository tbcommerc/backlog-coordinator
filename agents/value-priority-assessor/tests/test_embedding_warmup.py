from concurrent.futures import Future

from value_priority_assessor.api import main
from value_priority_assessor.rag import embeddings
from value_priority_assessor.service import warmup


def test_encoder_warmup_is_single_flight(monkeypatch):
    loaded = []
    result = object()

    def load(model_name, profile=None):
        loaded.append(model_name)
        return result

    embeddings.reset_encoders()
    monkeypatch.setattr(embeddings, "_load_encoder", load)

    first = embeddings.start_encoder_warmup("test-model")
    second = embeddings.start_encoder_warmup("test-model")

    assert first is second
    assert embeddings.get_encoder("test-model") is result
    assert loaded == ["test-model"]
    assert embeddings.get_encoder_status("test-model") == "ok"
    embeddings.reset_encoders()


def test_ready_reports_loading_without_waiting_for_encoder(monkeypatch):
    settings = main.get_settings()
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "llm_provider", "mock")
    monkeypatch.setattr(settings, "strategy_provider", "agent")
    monkeypatch.setattr(settings, "rag_vector", True)
    monkeypatch.setattr(settings, "value_analogy", False)

    pending = Future()
    monkeypatch.setattr(
        "value_priority_assessor.rag.embeddings.start_encoder_warmup", lambda _model_name: pending
    )
    monkeypatch.setattr(
        "value_priority_assessor.rag.embeddings.get_encoder_status", lambda _model_name: "loading"
    )
    monkeypatch.setattr("value_priority_assessor.service.warmup.start_runtime_warmup", lambda: pending)
    monkeypatch.setattr(
        "value_priority_assessor.service.warmup.get_runtime_warmup_status", lambda: "loading"
    )

    response = main.ready()

    assert response.status_code == 503
    assert b'"embedding_model":"loading"' in response.body
    assert b'"runtime_indexes":"loading"' in response.body


def test_runtime_index_warmup_is_single_flight(monkeypatch):
    loaded = []

    def load():
        loaded.append(True)
        return {"rag": "vector", "analogy": "ok"}

    warmup.reset_runtime_warmup()
    monkeypatch.setattr(warmup, "_warm_runtime", load)

    first = warmup.start_runtime_warmup()
    second = warmup.start_runtime_warmup()

    assert first is second
    assert first.result() == {"rag": "vector", "analogy": "ok"}
    assert loaded == [True]
    assert warmup.get_runtime_warmup_status() == "ok"
    warmup.reset_runtime_warmup()
