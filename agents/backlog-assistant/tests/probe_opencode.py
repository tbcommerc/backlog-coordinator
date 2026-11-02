"""Opt-in live probe with synthetic facts. Never imports DMB or its database."""
import argparse
import asyncio
import json
import os
import time
from contextlib import suppress
from pathlib import Path
from bridge.tools import ToolBridge
from contracts.models import Answer, Context
from fixtures.data import FakeData
from runtime.local_probe import LocalProbeLauncher
from runtime.opencode import OpenCodeRuntime


async def probe(args):
    values = {}
    if args.provider_env:
        for line in Path(args.provider_env).read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in {"OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"}:
                values[key.strip()] = value.strip().strip('"').strip("'")
    endpoint = os.environ.get("ASSISTANT_MODEL_URL", values.get("OPENAI_BASE_URL", ""))
    key = os.environ.get("ASSISTANT_MODEL_KEY", values.get("OPENAI_API_KEY", ""))
    model = os.environ.get("ASSISTANT_MODEL", values.get("OPENAI_MODEL", ""))
    if not all((endpoint, key, model)):
        raise ValueError("provider_configuration_missing")
    data = FakeData(tools=None if args.full_catalog else ["search_work_items", "read_task"])
    execution = data.register("synthetic-probe")
    data.executions[execution]["expires"] = time.time()+120
    grant = await data.activate(execution, "probe")
    bridge = ToolBridge(data, execution, grant, await data.catalog(execution, grant), deadline=time.monotonic()+120)
    if args.docker_image:
        from runtime.docker import DockerLauncher
        launcher = DockerLauncher(args.state, endpoint, key, args.docker_image)
    else:
        launcher = LocalProbeLauncher(args.binary, args.state, endpoint, key, synthetic_only=True)
    runtime = OpenCodeRuntime(launcher, model=model)
    handle = None
    report = {"model": model, "data": "synthetic", "production_qualified": False}
    try:
        if args.broker_only:
            from bridge.model import ModelBroker
            broker = ModelBroker(bridge, endpoint, key, model)
            try:
                result = await broker.completion({"model": model, "messages": [{"role": "user", "content": "Ответь одним словом: OK"}]})
                report.update(status="completed", model_requests=broker.requests, usage=result["usage"])
            finally:
                await broker.client.aclose()
        elif args.preflight:
            instance = await launcher.launch({"execution_ref": execution}, bridge, model)
            import httpx
            async with httpx.AsyncClient(base_url=instance["endpoint"], auth=("opencode", instance["password"]), trust_env=False, timeout=30) as client:
                health = (await client.get("/global/health")).json()
                cfg = (await client.get("/config")).json()
                agents = (await client.get("/agent")).json()
                report["health"] = health
                report["agents"] = [{"name": a["name"], "mode": a.get("mode")} for a in agents]
                report["config_matches"] = {field: cfg.get(field) == instance["config"].get(field)
                    for field in ("permission", "mcp", "provider", "enabled_providers", "share", "snapshot", "autoupdate")}
                report["plugins_empty"] = not cfg.get("plugin")
                if not args.docker_image:
                    spec = (await client.get("/doc")).json()
                    Path(args.schema).write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
            await launcher.destroy(instance["id"])
        else:
            handle = await runtime.prepare({"execution_ref": execution}, bridge, Answer.model_json_schema())
            report["dispatch"] = await runtime.submit(handle, {"text": "Найди задачи. Покажи список из доступных источников.",
                "context": Context().model_dump(mode="json")}, "synthetic-dispatch")
            while await runtime.inspect(handle) == "running":
                await asyncio.sleep(.5)
            from pydantic import ValidationError
            try:
                candidate = await runtime.collect(handle)
                report["candidate_valid"] = True
            except ValidationError as exc:
                report["candidate_valid"] = False
                report["schema_errors"] = [{"loc": e["loc"], "type": e["type"], "message": e["msg"]} for e in exc.errors()]
                if not bridge.results:
                    raise
                from backlog_assistant.worker import fallback_candidate
                candidate = fallback_candidate(bridge, Context().model_dump(mode="json"))
            verified = await data.verify(execution, grant, candidate, bridge.receipts)
            report.update(status="completed", kind=verified["kind"], tool_calls=bridge.calls,
                sources=len(bridge.receipts), model_requests=launcher.instances[handle["instance"]][4].requests)
    except Exception as exc:
        # Only allowlisted diagnostic codes. No URLs, keys, prompts or stack traces.
        report["status"] = "failed"
        report["error_type"] = type(exc).__name__
        from pydantic import ValidationError
        if isinstance(exc, ValidationError):
            report["schema_errors"] = [{"loc": e["loc"], "type": e["type"]} for e in exc.errors()]
        if getattr(launcher, "start_diagnostic", None):
            report["startup_diagnostic"] = launcher.start_diagnostic
        if hasattr(launcher, "start_exit_code"):
            report["startup_exit"] = launcher.start_exit_code
        import httpx
        if isinstance(exc, httpx.HTTPStatusError):
            report["http_status"] = exc.response.status_code
            report["operation"] = exc.request.url.path.split("/")[-1]
            diagnostic = exc.response.text
            for sensitive in (key, endpoint, grant):
                diagnostic = diagnostic.replace(sensitive, "[redacted]")
            report["diagnostic"] = diagnostic[:1500]
        elif isinstance(exc, httpx.RequestError) and exc.request:
            report["operation"] = exc.request.url.path.split("/")[-1]
        if isinstance(exc, ValueError) and str(exc) in {"runtime_config_mismatch", "runtime_config_contaminated",
            "primary_agent_missing", "unexpected_agent", "runtime_version_mismatch", "unexpected_permission",
            "candidate_missing", "runtime_start_failed", "tool_budget_exceeded", "model_budget_exceeded"}:
            report["error_code"] = str(exc)
    finally:
        await data.revoke(execution, grant)
        if handle:
            with suppress(Exception):
                messages = await runtime._messages(handle)
                report["message_states"] = [{"role": m.get("info", {}).get("role"),
                    "finish": m.get("info", {}).get("finish"),
                    "completed": bool(m.get("info", {}).get("time", {}).get("completed")),
                    "structured": m.get("info", {}).get("structured") is not None,
                    "parts": [{"type": p.get("type"), "tool": p.get("tool"), "status": p.get("state", {}).get("status")} for p in m.get("parts", [])]}
                    for m in messages]
            broker = launcher.instances[handle["instance"]][4]
            report["model_requests"] = broker.requests
            report["max_input_bytes"] = broker.max_input_bytes
            report["broker_errors"] = broker.errors
            if broker.provider_error:
                report["synthetic_provider_diagnostic"] = broker.provider_error
            report["tool_calls"] = bridge.calls
            try:
                with suppress(Exception):
                    await runtime.cancel(handle)
            finally:
                await runtime.dispose(handle)
        for instance_id in list(launcher.instances):
            await launcher.destroy(instance_id)
        report["state_cleaned"] = not any(Path(args.state).iterdir())
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--provider-env")
    parser.add_argument("--state", default=".runtime/opencode")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--full-catalog", action="store_true")
    parser.add_argument("--broker-only", action="store_true")
    parser.add_argument("--docker-image")
    parser.add_argument("--schema", default="contracts/opencode-1.17.13.openapi.json")
    result = asyncio.run(probe(parser.parse_args()))
    raise SystemExit(1 if result.get("status") == "failed" else 0)
