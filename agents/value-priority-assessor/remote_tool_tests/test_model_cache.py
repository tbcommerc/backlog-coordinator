"""Cache qualification with one technical table; no protected reference fixture."""
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from value_priority_assessor.core.models import LlmCall
from value_priority_assessor.llm import factory
from value_priority_assessor.llm.singleflight import reset_singleflight


@pytest.fixture
def cache(monkeypatch):
    engine=create_engine("sqlite:///:memory:")
    LlmCall.__table__.create(engine)
    monkeypatch.setattr(factory,"get_settings",lambda:SimpleNamespace(llm_cache_enabled=True))
    reset_singleflight()
    with Session(engine) as session:
        yield session
    reset_singleflight()
    engine.dispose()


class Adapter:
    name="synthetic"
    model="synthetic-model"
    cache_profile_ref="profile-a"
    last_usage={"tokens_in":12,"tokens_out":4}
    def __init__(self): self.calls=0
    def complete(self,*a,**kw):
        self.calls+=1
        return '{"ok":true}'


def run(adapter,session,**changes):
    values=dict(purpose="factor_assessment",system_prompt="Synthetic system",user_prompt="Synthetic task",
                schema={"type":"object"},session=session)
    return factory.complete_with_cache(adapter,**(values|changes))


def test_hit_keeps_usage_and_one_record(cache):
    adapter=Adapter()
    assert run(adapter,cache)==('{"ok":true}',False)
    assert run(adapter,cache)==('{"ok":true}',True)
    row=cache.scalars(select(LlmCall)).one()
    assert adapter.calls==1 and row.tokens_in==12 and row.tokens_out==4


def test_profile_schema_and_purpose_do_not_share_entries(cache):
    adapter=Adapter()
    run(adapter,cache)
    adapter.cache_profile_ref="profile-b"
    assert run(adapter,cache)[1] is False
    assert run(adapter,cache,purpose="document_review")[1] is False
    assert run(adapter,cache,schema={"type":"object","required":["ok"]})[1] is False
    assert adapter.calls==4 and len(cache.scalars(select(LlmCall)).all())==4


def test_failure_is_not_cached_and_body_is_not_saved(cache):
    class Broken(Adapter):
        def complete(self,*a,**kw):
            self.calls+=1
            raise RuntimeError("synthetic-private-provider-body")
    adapter=Broken()
    for _ in range(2):
        with pytest.raises(RuntimeError) as error:
            run(adapter,cache)
        assert "synthetic-private-provider-body" not in str(error.value)
    rows=cache.scalars(select(LlmCall)).all()
    assert adapter.calls==2 and len(rows)==2
    assert all(row.error=="RuntimeError" and row.response is None for row in rows)
