from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from dmb_agent_contracts.model import ModelRequest
from dmb_agent_contracts.operation import operation_scope
from dmb_agent_contracts.remote import RemoteOpenCode
from dmb_agent_contracts.runtime_model import RuntimeModel
from test_remote_http import CONFIG, SCHEMA, emulator


def test_model_port_checkpoints_unknown_delivery_before_reference_dispatch():
    with emulator(disconnect=True) as (url, state), httpx.Client(base_url=url, timeout=5, trust_env=False) as client:
        runtime = RemoteOpenCode(base_url="https://reference.invalid", expected_config=CONFIG,
            model={"providerID": "controlled", "modelID": "synthetic"}, agent="bounded", client=client, enabled=True)
        port = RuntimeModel(lambda: runtime, model_actual="synthetic")
        run_id = uuid4()
        request = ModelRequest(request_id=uuid4(), run_id=run_id, purpose="extraction",
            messages=[{"role": "user", "content": "synthetic"}], system_prompt="Return JSON", output_schema=SCHEMA,
            model_profile="contract_emulator", deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20), max_output_tokens=100)
        checkpoints = []
        def checkpoint(request, value):
            if value["delivery"] == "unknown" and not checkpoints[-1].get("dispatch_ref"):
                assert state["dispatch_count"] == 0
            checkpoints.append(dict(value))
        with operation_scope(run_id=run_id, deadline_at=request.deadline_at) as operation:
            operation.runtime_checkpoint = checkpoint
            result = port.complete(request)
            assert operation.model_attempts == 1
        assert result.structured == {"items": []} and result.usage.unavailable_reason == "runtime_not_reported"
        assert state["dispatch_count"] == 1
        assert checkpoints[0]["delivery"] == "not_attempted"
        assert checkpoints[0]["session_id"] is None
        assert any(value["delivery"] == "unknown" for value in checkpoints)
        assert checkpoints[-1]["cleanup"] == "confirmed"


def test_profile_change_is_rejected_before_prepare_or_model_attempt():
    import pytest
    from dmb_agent_contracts.model import AgentError
    request=ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose='extraction',
        messages=[{'role':'user','content':'synthetic'}],system_prompt='Synthetic',
        model_profile='fixture',deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20),max_output_tokens=100)
    def forbidden_factory():
        pytest.fail('A changed profile may not create a resource')
    with operation_scope(run_id=request.run_id,acquire_gate=False) as context:
        context.model_profile_ref='original-profile'
        with pytest.raises(AgentError,match='runtime_profile_changed'):
            RuntimeModel(forbidden_factory,model_actual='synthetic',profile_ref='changed-profile').complete(request)
        assert context.model_attempts==0 and not context._cleanup_pending


def test_missing_tool_capability_rejects_before_factory_or_attempt():
    import pytest
    from dmb_agent_contracts.model import AgentError
    request=ModelRequest(request_id=uuid4(),run_id=uuid4(),purpose='extraction',
        messages=[{'role':'user','content':'synthetic'}],system_prompt='Synthetic',
        allowed_tools=[{'name':'synthetic_read'}],model_profile='fixture',
        deadline_at=datetime.now(timezone.utc)+timedelta(seconds=20),max_output_tokens=100)
    def forbidden_factory():
        pytest.fail('Missing capability may not prepare a runtime')
    with operation_scope(run_id=request.run_id,acquire_gate=False) as context:
        context.runtime_checkpoint=lambda *args:pytest.fail('Rejected request created an intent')
        with pytest.raises(AgentError,match='model_capability_missing'):
            RuntimeModel(forbidden_factory,model_actual='synthetic').complete(request)
        assert context.model_attempts==0 and not context._cleanup_pending
