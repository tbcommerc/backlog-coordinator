"""Cache identity changes with every actual encoder input; no DB fixtures."""
import pytest
from value_priority_assessor.core.analogy import AnalogyIndex


def index():
    value=AnalogyIndex.__new__(AnalogyIndex)
    value.model_name="synthetic"
    value.encoder_profile={"model":"synthetic","revision":"r1","cache_dir":"cache","local_files_only":True}
    value.entries=[{"task_key":"synthetic","title":"Synthetic title","team":"synthetic",
        "project":"synthetic","task_type":"synthetic","description":"Synthetic description","value_mln":1}]
    return value


@pytest.mark.parametrize("field",["model","revision","cache_dir","local_files_only"])
def test_analogy_signature_binds_encoder_profile(field):
    first,second=index(),index()
    assert first._signature()==second._signature()
    second.encoder_profile[field]="different" if field!="local_files_only" else False
    assert first._signature()!=second._signature()


def test_analogy_description_change_invalidates_cache():
    first,second=index(),index()
    second.entries[0]["description"]="Changed synthetic description"
    assert first._signature()!=second._signature()
