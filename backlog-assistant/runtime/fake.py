import uuid
from datetime import datetime, timezone
from contracts.models import Answer, Context, Coverage, DataBlock


class FakeRuntime:
    """Deterministic synthetic contract fixture, not a language-model fallback."""
    def __init__(self):
        self.instances = {}

    async def prepare(self, context, bridge, schema):
        handle = {"instance": str(uuid.uuid4()), "session": str(uuid.uuid4()), "message": str(uuid.uuid4())}
        self.instances[handle["instance"]] = {"bridge": bridge, "state": "ready", "context": context}
        return handle

    async def submit(self, handle, envelope, dispatch_ref):
        state = self.instances[handle["instance"]]
        if state["state"] != "ready":
            raise ValueError("duplicate_dispatch")
        await state["bridge"].check()
        result = await state["bridge"].call("search_work_items", {"query": envelope["context"]["filters"], "limit": 20})
        state["answer"] = Answer(kind="answer" if result.coverage.matched_total else "no_results",
            context=Context.model_validate(envelope["context"]), as_of=datetime.now(timezone.utc),
            data_blocks=[DataBlock(type="list", server_result_ref=result.snapshot_ref)], sources=result.sources,
            coverage=result.coverage, limitations=["Синтетический runtime: языковая интерпретация не выполняется."])
        state["state"] = "completed"
        return "accepted"

    async def inspect(self, handle):
        return self.instances[handle["instance"]]["state"]

    async def observe(self, handle, cursor=None):
        return [{"type": "candidate_ready"}] if await self.inspect(handle) == "completed" else []

    async def collect(self, handle):
        return self.instances[handle["instance"]]["answer"]

    async def cancel(self, handle):
        if handle["instance"] in self.instances:
            self.instances[handle["instance"]]["state"] = "cancelled"

    async def dispose(self, handle):
        self.instances.pop(handle["instance"], None)
