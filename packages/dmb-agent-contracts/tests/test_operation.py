import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from uuid import uuid4

import httpx
import pytest

from dmb_agent_contracts.go import GoModel
from dmb_agent_contracts.model import AgentError,ModelRequest
from dmb_agent_contracts.operation import (OperationContext,operation_scope,current_operation,
    bind_request,reserve_model_attempt,model_operation,submit_in_operation,limit_timeout)


def request():
    return ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose="extraction",
        system_prompt="Synthetic",messages=[{"role":"user","content":"Synthetic"}],
        output_schema={},model_profile="synthetic",max_output_tokens=32,
        deadline_at=datetime.now(timezone.utc)+timedelta(seconds=30))


def test_parallel_runtime_cleanup_requires_every_owned_resource():
    context = OperationContext(run_id=uuid4())
    first, second = context.hold_slot_for_cleanup(), context.hold_slot_for_cleanup()
    with pytest.raises(AgentError, match="cleanup_scope_required"):
        context.confirm_cleanup()
    context.confirm_cleanup(first)
    assert context._cleanup_pending and second in context._cleanup_refs
    with pytest.raises(AgentError, match="cleanup_scope_mismatch"):
        context.confirm_cleanup(first)
    context.confirm_cleanup(second)
    assert not context._cleanup_pending and not context._cleanup_refs


def test_nested_context_keeps_logical_run_and_subrequest_identity():
    original=request()
    deadline=datetime.now(timezone.utc)+timedelta(seconds=10)
    with operation_scope(deadline_at=deadline,max_model_attempts=3) as owner:
        with operation_scope(deadline_at=deadline+timedelta(seconds=20),max_model_attempts=8) as nested:
            result=bind_request(original)
            assert nested is owner
            assert result.run_id==owner.run_id and result.request_id==original.request_id
            assert result.deadline_at==deadline and owner.max_model_attempts==3
        assert current_operation() is owner
        assert original.run_id!=owner.run_id and original.deadline_at>deadline
        assert 0<limit_timeout(30)<=10
    assert current_operation() is None
    with pytest.raises(AgentError,match="operation_already_finished"):owner.reserve_model_attempt()


def test_conflicting_run_does_not_replace_owner():
    with operation_scope() as owner:
        with pytest.raises(AgentError,match="operation_context_conflict"):
            with operation_scope(run_id=uuid4()):pass
        assert current_operation() is owner


def test_parallel_nested_attempts_share_one_finite_budget():
    with operation_scope(max_model_attempts=3) as owner,ThreadPoolExecutor(max_workers=8) as pool:
        def attempt():
            assert current_operation() is owner
            try:return reserve_model_attempt()
            except AgentError as error:return error.code
        results=[future.result() for future in [submit_in_operation(pool,attempt) for _ in range(20)]]
        assert sorted(x for x in results if isinstance(x,int))==[1,2,3]
        assert results.count("local_budget_exceeded")==17 and owner.model_attempts==3


@pytest.mark.parametrize("limit",[0,-1,False,1.5,"2"])
def test_budget_requires_positive_integer(limit):
    with pytest.raises(ValueError):OperationContext(uuid4(),max_model_attempts=limit)


def test_borrowed_context_does_not_end_the_owner():
    owner=OperationContext(uuid4(),max_model_attempts=2)
    for _ in range(2):
        with operation_scope(context=owner):reserve_model_attempt()
    assert owner.model_attempts==2
    owner.cancel()
    with pytest.raises(AgentError,match="cancelled"):owner.check()


def test_async_decorator_covers_await_and_restores_context():
    @model_operation
    async def operation():
        first=current_operation()
        await asyncio.sleep(0)
        assert current_operation() is first
        return first.run_id
    first=asyncio.run(operation())
    second=asyncio.run(operation())
    assert first!=second and current_operation() is None


def test_generator_requires_explicit_scope():
    def generator():yield "synthetic"
    with pytest.raises(ValueError,match="explicit operation_scope"):model_operation(generator)


def test_go_reserves_one_attempt_and_rejects_over_budget_before_wire():
    calls=[]
    def transport(value):
        calls.append(value)
        return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]})
    model=GoModel(base_url="https://opencode.ai/zen/go/v1",api_key="synthetic",model="synthetic",
        client=httpx.Client(transport=httpx.MockTransport(transport)))
    with operation_scope(max_model_attempts=1) as owner:
        model.complete(request())
        with pytest.raises(AgentError,match="local_budget_exceeded"):model.complete(request())
        assert owner.model_attempts==1 and len(calls)==1
    model.client.close()


def test_cancel_during_transport_prevents_returning_candidate():
    with operation_scope() as owner:
        def transport(value):
            owner.cancel()
            return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]})
        model=GoModel(base_url="https://opencode.ai/zen/go/v1",api_key="synthetic",model="synthetic",
            client=httpx.Client(transport=httpx.MockTransport(transport)))
        with pytest.raises(AgentError,match="cancelled"):model.complete(request())
        assert owner.model_attempts==1
        model.client.close()


def test_expired_owner_never_spends_an_attempt():
    with operation_scope(deadline_at=datetime.now(timezone.utc)-timedelta(seconds=1)) as owner:
        with pytest.raises(AgentError,match="operation_deadline_exceeded"):reserve_model_attempt()
        assert owner.model_attempts==0


def test_nested_replacement_cannot_reset_same_run_budget():
    with operation_scope(max_model_attempts=1) as owner:
        reserve_model_attempt()
        replacement=OperationContext(owner.run_id,max_model_attempts=100)
        with pytest.raises(AgentError,match="operation_context_conflict"):
            with operation_scope(context=replacement):pass
        assert owner.model_attempts==1


def test_naive_owner_deadline_is_rejected():
    with pytest.raises(ValueError,match="requires timezone"):
        OperationContext(uuid4(),deadline_at=datetime.now())
