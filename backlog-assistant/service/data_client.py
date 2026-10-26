"""Fixed-origin, mTLS Data API client; redirects and ambient proxies disabled."""
import httpx
from contracts.models import ToolResult


class HTTPDataPort:
    def __init__(self, base_url, service_token, *, verify, cert, transport=None):
        if not base_url.startswith("https://") and transport is None:
            raise ValueError("data_api_requires_tls")
        self.client = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/", timeout=3,
            headers={"Authorization": "Bearer " + service_token}, verify=verify, cert=cert,
            follow_redirects=False, trust_env=False, transport=transport)

    async def request(self, method, path, grant=None, body=None, proof=None):
        headers = {}
        if grant:
            headers["X-Execution-Grant"] = grant
        if proof:
            headers["X-Read-Proof"] = proof
        r = await self.client.request(method, path, headers=headers, json=body)
        r.raise_for_status()
        return r.json()

    async def activate(self, execution, lease):
        return (await self.request("POST", f"executions/{execution}/activate", body={"lease": lease}))["grant"]

    async def check(self, execution, grant):
        await self.request("POST", f"executions/{execution}/check", grant, {})

    async def catalog(self, execution, grant):
        return await self.request("GET", f"executions/{execution}/tools", grant)

    async def tool(self, execution, grant, name, arguments, call_id):
        try:
            return ToolResult.model_validate(await self.request("POST", f"executions/{execution}/tools/{name}", grant,
                {"arguments": arguments, "tool_call_id": call_id}))
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403, 404}:
                raise PermissionError("source_access_denied") from None
            raise

    async def verify(self, execution, grant, candidate, receipts):
        return await self.request("POST", "answers/verify", grant,
            {"execution_ref": execution, "candidate": candidate.model_dump(mode="json"), "receipt_refs": receipts})

    async def validate(self, owner, receipts, proof):
        await self.request("POST", "sources/validate", body={"owner": owner, "receipt_refs": receipts}, proof=proof)

    async def revoke(self, execution, grant):
        await self.request("POST", f"executions/{execution}/revoke", grant, {})

    async def result(self, owner, result_id, cursor, proof):
        return await self.request("POST", f"results/{result_id}", body={"owner": owner,
            "receipt_refs": [result_id], "cursor": cursor}, proof=proof)

    async def purge(self, owner, receipts):
        await self.request("POST", "receipts/purge", body={"owner": owner, "receipt_refs": receipts})

    async def conversation(self, execution, grant, receipts):
        return await self.request("POST", f"executions/{execution}/conversation", grant, {"receipt_refs": receipts})
