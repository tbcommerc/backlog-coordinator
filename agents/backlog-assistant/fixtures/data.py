"""Synthetic DataPort. Objects and identities exist ONLY in process memory."""
import copy
import secrets
import time
import uuid
from datetime import datetime, timezone
from contracts.catalog import catalog
from contracts.models import ToolResult, Source, Coverage


class FakeData:
    def __init__(self, tools=None):
        self.executions, self.receipts, self.grants = {}, {}, {}
        self.revoked_owners = set()
        self.allowed_tools = tools

    def register(self, owner, execution=None):
        execution = execution or str(uuid.uuid4())
        self.executions[execution] = {"owner": owner, "expires": time.time()+75, "revoked": False, "lease": None}
        return execution

    async def activate(self, execution, lease):
        e = self.executions[execution]
        if e["revoked"] or e["expires"] <= time.time() or e["owner"] in self.revoked_owners:
            raise ValueError("execution_denied")
        # Lease replacement revokes the old grant; same lease is idempotent.
        if e["lease"] != lease:
            e["lease"] = lease
            self.grants[execution] = secrets.token_urlsafe(32)
        return self.grants[execution]

    async def check(self, execution, grant):
        e = self.executions[execution]
        if (not grant or not secrets.compare_digest(grant, self.grants.get(execution, ""))
                or e["revoked"] or e["expires"] <= time.time() or e["owner"] in self.revoked_owners):
            raise ValueError("execution_denied")

    async def catalog(self, execution, grant):
        await self.check(execution, grant)
        result = catalog()
        if self.allowed_tools is not None:
            result["tools"] = [t for t in result["tools"] if t["name"] in self.allowed_tools]
        return result

    async def tool(self, execution, grant, name, arguments, call_id):
        await self.check(execution, grant)
        ref = str(uuid.uuid4())
        owner = self.executions[execution]["owner"]
        source = Source(source_id=ref, receipt_ref=ref, kind="synthetic", version="1", fields=["title"])
        result = ToolResult(tool_call_id=call_id, execution_ref=execution, tool_name=name, status="ok",
            data={"items": [{"object_ref": "task:synthetic", "title": "Синтетическая задача"}], "total": 1},
            snapshot_ref=ref, observed_at=datetime.now(timezone.utc), coverage=Coverage(matched_total=1, displayed_count=1),
            sources=[source], limitations=["Имитатор API; рабочие данные не использованы."])
        self.receipts[ref] = {"owner": owner, "execution": execution, "result": result.model_dump(mode="json")}
        return result

    async def verify(self, execution, grant, candidate, receipts):
        await self.check(execution, grant)
        owner = self.executions[execution]["owner"]
        for ref in receipts:
            if self.receipts[ref]["owner"] != owner or self.receipts[ref]["execution"] != execution:
                raise ValueError("receipt_denied")
        sources = {s["source_id"] for r in receipts for s in self.receipts[r]["result"]["sources"]}
        if any(s.source_id not in sources for s in candidate.sources):
            raise ValueError("receipt_denied")
        for block in candidate.data_blocks:
            if block.server_result_ref not in receipts:
                raise ValueError("result_denied")
        answer = candidate.model_dump(mode="json")
        # Server renders every numeric/table value, never trusts model-generated values.
        answer["verified_blocks"] = [copy.deepcopy(self.receipts[b.server_result_ref]["result"]["data"]) for b in candidate.data_blocks]
        return answer

    async def validate(self, owner, receipts, proof):
        if proof != "synthetic-current-read" or owner in self.revoked_owners:
            raise ValueError("read_denied")
        if any(self.receipts.get(ref, {}).get("owner") != owner for ref in receipts):
            raise ValueError("receipt_denied")

    async def revoke(self, execution, grant):
        self.executions[execution]["revoked"] = True
        self.grants.pop(execution, None)

    async def result(self, owner, result_id, cursor, proof):
        await self.validate(owner, [result_id], proof)
        return copy.deepcopy(self.receipts[result_id]["result"])

    async def purge(self, owner, receipts):
        for ref in receipts:
            if self.receipts.get(ref, {}).get("owner") == owner:
                del self.receipts[ref]
