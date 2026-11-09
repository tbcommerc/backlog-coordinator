"""The operator's live flag never bypasses the persisted call reservation."""
import json
import runpy
import sys
from uuid import uuid4
from pathlib import Path
from types import SimpleNamespace

import pytest
import dmb_agent_contracts.go as go


@pytest.mark.parametrize("service", ["business-analyst", "business-analyst-experimental",
    "meeting-analyzer", "value-priority-assessor", "backlog-assistant"])
@pytest.mark.parametrize("exhausted", [False, True])
def test_probe_reserves_before_exactly_one_call(monkeypatch,tmp_path,service,exhausted):
    root=Path(__file__).resolve().parents[3]
    namespace=runpy.run_path(str(root/"scripts/agent-model-probe.py"))
    actions=[]
    config=SimpleNamespace()
    settings=SimpleNamespace(OPENAI_API_KEY="synthetic",OPENAI_BASE_URL="https://opencode.ai/zen/go/v1",
        OPENAI_MODEL="synthetic",model_api_key="synthetic",model_base_url="https://opencode.ai/zen/go/v1",
        model_name="synthetic",openai_api_key="synthetic",openai_base_url="https://opencode.ai/zen/go/v1",
        openai_model="synthetic")
    config.settings=settings
    config.environment=lambda:{"ASSISTANT_MODEL_KEY":"synthetic",
        "ASSISTANT_MODEL_URL":"https://opencode.ai/zen/go/v1","ASSISTANT_MODEL":"synthetic"}
    doctor={"PROFILES":{service:("synthetic_config",)},"diagnose":lambda _: {"status":"ready"},"plain":lambda v:v}
    def reserve(_):
        actions.append("reserve")
        if exhausted: raise RuntimeError("live_budget_exhausted")
        return {"reserved_calls":1}
    original_import=namespace["importlib"].import_module
    monkeypatch.setattr(namespace["importlib"],"import_module",lambda name:config if name=="synthetic_config" else original_import(name))
    monkeypatch.setattr(namespace["runpy"],"run_path",lambda path:doctor if path.endswith("agent-doctor.py") else {"reserve":reserve})
    class Transport:
        def __init__(self,**_):
            actions.append("construct")
            self.client=SimpleNamespace(close=lambda:actions.append("close"))
        def complete(self,request):
            actions.append("wire")
            assert request.max_output_tokens==512
            return SimpleNamespace(structured={"status":"ok"},elapsed_ms=1,
                usage=SimpleNamespace(model_dump=lambda:{"input_tokens":None}))
    monkeypatch.setattr(go,"GoModel",Transport)
    # Every repeat uses new in-workspace evidence, independent of pytest temp names.
    output=root/".runtime"/"operator-probe-tests"/uuid4().hex/"probe.json"
    monkeypatch.setattr(sys,"argv",["probe","--service",service,"--max-calls","1",
        "--max-seconds","5","--output",str(output)])
    if exhausted:
        with pytest.raises(RuntimeError,match="live_budget_exhausted"):namespace["main"]()
        assert actions==["reserve"]
    else:
        assert namespace["main"]()==0
        assert actions==["reserve","construct","wire","close"]
        assert json.loads(output.read_text())["status"]=="PASS"
    output.unlink(missing_ok=True)
    output.parent.rmdir()
