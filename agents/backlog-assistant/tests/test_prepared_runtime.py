"""Adapter component: reference HTTP fixture and service-owned synthetic evidence."""
import asyncio
import runpy
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from bridge.tools import ToolBridge
from contracts.models import Answer, Context
from dmb_agent_contracts.operation import operation_scope
from dmb_agent_contracts.prepared_runtime import digest
from dmb_agent_contracts.provisioning import IsolatedLease
from fixtures.data import FakeData
from runtime.prepared import PreparedRuntime, RuntimeSpec


@pytest.mark.asyncio
async def test_prepared_runtime_preserves_verified_result_and_cleanup():
    fixture = runpy.run_path(str(Path(__file__).resolve().parents[3]/"packages/dmb-agent-contracts/tests/test_remote_http.py"))
    data = FakeData(tools=["search_work_items"])
    execution = data.register("synthetic-owner")
    grant = await data.activate(execution, "synthetic-lease")
    bridge = ToolBridge(data, execution, grant, await data.catalog(execution, grant), deadline=time.monotonic()+60)
    run_id = str(uuid4())
    context = {"run_id":run_id,"execution_ref":execution,"deadline":time.monotonic()+60}
    with fixture["emulator"]() as (url, state), httpx.Client(base_url=url, timeout=2, trust_env=False) as client:
        class Deployment:
            removed = False
            bridge_closed = False
            async def prepare(self, context, bridge, schema):
                result = await bridge.call("search_work_items", {"query":{},"limit":20})
                state["candidate"] = {"kind":"answer","data_blocks":[{"type":"list","server_result_ref":result.snapshot_ref}],"clarification":None}
                manifest = {"version":"1.0","catalog_hash":bridge.catalog_hash,
                    "tools":{"dmb_"+name:schema for name,schema in bridge.schemas.items()},
                    "network":{"tool_bridge":"https://bridge.invalid/mcp","model_broker":"https://broker.invalid/v1"},
                    "budgets":{"model_requests":4,"tool_calls":6,"execution_seconds":60,"container_lifetime_seconds":90}}
                config = {**fixture["CONFIG"],"permission":{"*":"deny","StructuredOutput":"allow","dmb_search_work_items":"allow"},
                    "provider":{"controlled":{"options":{"baseURL":"https://broker.invalid/v1"}}},"enabled_providers":["controlled"],
                    "mcp":{"dmb":{"type":"remote","url":"https://bridge.invalid/mcp","oauth":False}}}
                state["config"] = config
                state["agents"] = [{"name":"bounded","mode":"primary","options":{},"permission":[
                    {"permission":name,"pattern":"*","action":action} for name,action in config["permission"].items()]}]
                lease = IsolatedLease("synthetic-lease",run_id,"https://reference.invalid","1.17.13","sha256:"+"1"*64,
                    datetime.now(timezone.utc)+timedelta(seconds=50),"workspace","state","credentials",digest(config),digest(manifest),("synthetic-grant",))
                self.lease = lease
                return RuntimeSpec(self,config,{"providerID":"controlled","modelID":"synthetic"},"bounded",manifest,
                    ("https://reference.invalid",),{"run_id":run_id,"refs":["synthetic-grant"]},lambda _:client)
            def acquire(self,*args): return self.lease
            def inspect(self,lease): return self.lease
            def recover(self,identity): return self.lease
            def revoke(self,lease): return True
            def dispose(self,lease):
                self.removed = True
                return {"lease_id":lease.lease_id,"run_id":run_id,"cleanup":"confirmed","resources_absent":True}
            async def close_bridge(self,binding):
                self.bridge_closed = True
                return True
            async def recover_cleanup(self,binding):
                raise AssertionError("Unexpected recovery")
        deployment = Deployment()
        runtime = PreparedRuntime(deployment)
        with operation_scope(run_id=run_id,deadline_at=datetime.now(timezone.utc)+timedelta(seconds=60)) as operation:
            parent_cleanup = operation.hold_slot_for_cleanup()
            handle = await runtime.prepare(context,bridge,Answer.model_json_schema())
            assert await runtime.submit(handle,{"text":"Synthetic","context":Context().model_dump(mode="json")},"dispatch") == "accepted"
            answer = await runtime.collect(handle)
            verified = await data.verify(execution,grant,answer,bridge.receipts)
            assert verified["verified_blocks"][0]["total"] == 1
            await runtime.dispose(handle)
            assert operation._cleanup_pending  # The worker still owns grant cleanup.
            await data.revoke(execution,grant)
            operation.confirm_cleanup(parent_cleanup)
        assert deployment.removed and deployment.bridge_closed and not runtime.instances
        assert state["dispatch_count"] == 1
