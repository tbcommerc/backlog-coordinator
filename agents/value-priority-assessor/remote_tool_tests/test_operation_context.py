import httpx
from dmb_agent_contracts.operation import operation_scope
from value_priority_assessor.llm import openai_compat


def test_factor_roles_share_run_budget_but_keep_distinct_provider_sessions(monkeypatch):
    calls=[]
    def transport(request):
        calls.append(request)
        if len(calls)==1:return httpx.Response(429,json={"error":"synthetic"})
        return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]})
    client=httpx.Client(transport=httpx.MockTransport(transport))
    monkeypatch.setattr(openai_compat,"_http_client",lambda:client)
    adapter=openai_compat.OpenAICompatAdapter(api_key="synthetic",base_url="https://opencode.ai/zen/go/v1",
        model="synthetic",retry_attempts=2,retry_base_seconds=0,retry_max_seconds=0)
    captured=[]
    original=adapter.complete_model
    def complete(request):
        captured.append(request)
        return original(request)
    monkeypatch.setattr(adapter,"complete_model",complete)
    with operation_scope(max_model_attempts=3) as owner:
        adapter.complete("Synthetic F5","Synthetic",schema={"type":"object"})
        adapter.complete("Synthetic F6","Synthetic",schema={"type":"object"})
        assert captured[0].run_id==captured[1].run_id==owner.run_id
        assert owner.model_attempts==3 and len(calls)==3
        assert calls[0].headers["x-opencode-session"]==calls[1].headers["x-opencode-session"]
        assert calls[1].headers["x-opencode-session"]!=calls[2].headers["x-opencode-session"]
    client.close()
