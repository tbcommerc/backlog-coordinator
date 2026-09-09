"""One optional synthetic live-model probe; never uses the application database.

Explicit invocation: python docs/dev-testing/evidence/ai-ba-2026-09-08/live_probe.py --execute
Uses the provider selected in agent/.env (UTF-8 BOM supported), without editing it.
It sends synthetic business requirements and the application's ordinary system
prompt to that configured provider. Credentials are never included in the result.
"""
import argparse
import importlib.util
import json
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
from unittest.mock import patch
from pathlib import Path

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--execute", action="store_true")
args = parser.parse_args()
if not args.execute:
    parser.print_help()
    raise SystemExit(0)

path = Path(__file__).with_name("reproduce.py")
spec = importlib.util.spec_from_file_location("audit_reproduce", path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
from dotenv import dotenv_values
from agent.config import settings
from agent.llm.factory import get_llm

cfg = dotenv_values(audit.ROOT / "agent/.env", encoding="utf-8-sig")
provider = cfg.get("LLM_PROVIDER", "")
if provider != "openai_compat":
    raise SystemExit("A real provider is not selected in the local configuration file.")
settings.LLM_PROVIDER = provider
if urlparse(settings.OPENAI_BASE_URL).hostname != "opencode.ai" or settings.OPENAI_MODEL != "glm-5.1":
    raise SystemExit("This authorized probe is limited to glm-5.1 at opencode.ai.")
llm = get_llm()
http_requests = []
execution_observation = {}
original_urlopen = urllib.request.urlopen


def one_authorized_request(request, *args, **kwargs):
    """Keep the user's permission to one external request, including retries."""
    url = request.full_url
    if urlparse(url).hostname != "opencode.ai" or request.get_method() != "POST":
        raise RuntimeError("Probe destination or method is outside the authorized scope")
    if http_requests:
        raise RuntimeError("Single-request probe budget exhausted; no further network request sent")
    http_requests.append({"host": "opencode.ai", "method": "POST"})
    try:
        response = original_urlopen(request, *args, **kwargs)
        execution_observation["http_status"] = getattr(response, "status", None)
        return response
    except urllib.error.HTTPError as exc:
        execution_observation.update({"http_status": exc.code, "error_type": "HTTPError"})
        raise


store = audit.MemoryStore(audit.make_state())
orch = audit.AgenticOrchestrator(store)
message = (
    "Нужен экран истории изменения лимита по клиенту. Его используют риск-менеджеры "
    "при рассмотрении заявки. На экране должны быть старое и новое значение, дата, "
    "инициатор и причина. Пользователь должен отфильтровать историю по периоду и инициатору."
)
started = time.perf_counter()
with patch("agent.dialogue.agentic.get_llm", return_value=llm), patch("urllib.request.urlopen", one_authorized_request):
    response = orch.handle_message("synthetic-audit", message)
result = {
    "method": "Single synthetic live-model turn; in-memory Python store; no HTTP/UI/backend DB; "
              "local file provider selection with utf-8-sig encoding; no settings files changed; "
              "external request budget is one, automatic external retries are blocked",
    "model": settings.OPENAI_MODEL,
    "provider": provider,
    "input": message,
    "seconds": round(time.perf_counter() - started, 2),
    "http_requests": len(http_requests),
    "execution_observation": execution_observation,
    "provider_response_meta": llm.last_response_meta,
    "action": response.action,
    "reply": response.message,
    "facts": {k: {"value": s.value, "confidence": s.confidence, "assumption": s.assumption}
              for k, s in store.state.slots.items() if s.status == "filled"},
    "decision": store.state.last_agent_decision,
}
Path(__file__).with_name("live_probe.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
