"""Index metadata must bind the exact frozen encoder, without loading torch."""
import json
import sys
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("changed", [None,"revision","cache_dir","local_files_only","model","schema","corpus","count"])
def test_vector_cache_profile_fences_reuse(tmp_path,monkeypatch,changed):
    from value_priority_assessor.rag import search
    profile={"model":"synthetic-encoder","revision":"synthetic-r1",
             "cache_dir":"synthetic-cache","local_files_only":True}
    vector=search.VectorIndex.__new__(search.VectorIndex)
    vector.encoder_profile=profile.copy()
    vector.model_name=profile["model"]
    vector.signature="synthetic-corpus"
    vector.chunks=[object()]
    vector.rebuilt=False
    calls=[]
    vector._build=lambda:calls.append("build")
    monkeypatch.setitem(sys.modules,"numpy",SimpleNamespace(frombuffer=lambda *a,**k:SimpleNamespace(copy=lambda:b"synthetic")))
    monkeypatch.setitem(sys.modules,"faiss",SimpleNamespace(deserialize_index=lambda _:"cached-index"))
    index=tmp_path/"index.faiss"
    index.write_bytes(b"synthetic")
    meta=tmp_path/"meta.json"
    payload={"schema_version":3,"encoder_profile":profile.copy(),"model_name":profile["model"],
             "corpus_signature":vector.signature,"document_count":1}
    if changed in profile:
        payload["encoder_profile"][changed]=False if changed=="local_files_only" else "different"
    elif changed=="schema":payload["schema_version"]=2
    elif changed=="corpus":payload["corpus_signature"]="different"
    elif changed=="count":payload["document_count"]=2
    meta.write_text(json.dumps(payload),encoding="utf-8")
    monkeypatch.setattr(search,"VECTOR_INDEX_PATH",index)
    monkeypatch.setattr(search,"VECTOR_META_PATH",meta)
    vector._load_or_build()
    assert vector.rebuilt is (changed is not None)
    assert calls==([] if changed is None else ["build"])
    if changed is None:assert vector._index=="cached-index"


def test_vector_cache_writes_unicode_path_without_native_fopen(tmp_path,monkeypatch):
    from value_priority_assessor.rag import search
    monkeypatch.setitem(sys.modules,"numpy",SimpleNamespace(asarray=lambda rows,**k:SimpleNamespace(shape=(len(rows),len(rows[0])))))
    directory=tmp_path/"Индекс"
    monkeypatch.setattr(search,"INDEX_DIR",directory)
    monkeypatch.setattr(search,"VECTOR_INDEX_PATH",directory/"vector.faiss")
    monkeypatch.setattr(search,"VECTOR_META_PATH",directory/"vector-meta.json")
    class Index:
        def __init__(self,dimension):assert dimension==2
        def add(self,vectors):assert vectors.shape==(1,2)
    fake=SimpleNamespace(IndexFlatIP=Index,
        serialize_index=lambda _:SimpleNamespace(tobytes=lambda:b"synthetic-faiss"))
    monkeypatch.setitem(sys.modules,"faiss",fake)
    vector=search.VectorIndex.__new__(search.VectorIndex)
    vector.chunks=[SimpleNamespace(title="Synthetic",text="Synthetic")]
    vector.model_name="synthetic-encoder"
    vector.encoder_profile={"revision":"synthetic"}
    vector.signature="synthetic-corpus"
    vector._encoder=lambda:SimpleNamespace(encode=lambda *a,**k:[[1,0]])
    vector._build()
    assert search.VECTOR_INDEX_PATH.read_bytes()==b"synthetic-faiss"
    assert json.loads(search.VECTOR_META_PATH.read_text())["schema_version"]==3
