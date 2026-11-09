"""Encoder profile isolation without importing torch or loading real weights."""
from types import SimpleNamespace
from value_priority_assessor import config
from value_priority_assessor.rag import embeddings


def test_encoder_cache_is_scoped_to_revision_and_offline_profile(monkeypatch):
    settings=SimpleNamespace(rag_embedding_revision="revision-a",rag_model_cache_dir="",rag_local_files_only=True)
    monkeypatch.setattr(config,"get_settings",lambda:settings)
    loaded=[]
    def load(name,profile):
        loaded.append(profile)
        return object()
    monkeypatch.setattr(embeddings,"_load_encoder",load)
    embeddings.reset_encoders()
    try:
        first=embeddings.get_encoder("synthetic-model")
        assert embeddings.get_encoder("synthetic-model") is first
        settings.rag_embedding_revision="revision-b"
        assert embeddings.get_encoder_status("synthetic-model")=="not_started"
        second=embeddings.get_encoder("synthetic-model")
        assert second is not first
        settings.rag_local_files_only=False
        assert embeddings.get_encoder("synthetic-model") is not second
        assert loaded==[("synthetic-model","revision-a",None,True),
                        ("synthetic-model","revision-b",None,True),
                        ("synthetic-model","revision-b",None,False)]
    finally:
        embeddings.reset_encoders()
