from concurrent.futures import Future

from app.api import main
from app.rag import embeddings


def test_encoder_warmup_is_single_flight(monkeypatch):
    loaded = []
    result = object()

    def load(model_name):
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
        "app.rag.embeddings.start_encoder_warmup", lambda _model_name: pending
    )
    monkeypatch.setattr(
        "app.rag.embeddings.get_encoder_status", lambda _model_name: "loading"
    )

    response = main.ready()

    assert response.status_code == 503
    assert b'"embedding_model":"loading"' in response.body
