"""Synthetic-data probes only. Process isolation is NOT a production network sandbox."""
import asyncio
import hmac
import json
import os
import secrets
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
import httpx
import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response, StreamingResponse
from bridge.model import ModelBroker
from runtime.opencode import config


def event_stream(result):
    choices = []
    for choice in result.get("choices", []):
        message = dict(choice.get("message", {}))
        if "tool_calls" in message:
            message["tool_calls"] = [dict(call, index=i) for i, call in enumerate(message["tool_calls"])]
        choices.append({"index": choice.get("index", 0), "delta": message, "finish_reason": None})
    base = {"id": result.get("id", "completion"), "object": "chat.completion.chunk",
            "created": result.get("created", int(time.time())), "model": result.get("model", "")}
    yield "data: " + json.dumps(dict(base, choices=choices)) + "\n\n"
    yield "data: " + json.dumps(dict(base, choices=[{"index": c.get("index", 0), "delta": {},
        "finish_reason": c.get("finish_reason", "stop")} for c in result.get("choices", [])], usage=result.get("usage", {}))) + "\n\n"
    yield "data: [DONE]\n\n"


class LocalProbeLauncher:
    broker_host = "127.0.0.1"
    broker_url_host = "127.0.0.1"
    def __init__(self, binary, root, provider_url, provider_key, *, synthetic_only=False):
        if not synthetic_only:
            raise ValueError("local_process_launcher_is_synthetic_only")
        self.binary = str(Path(binary).resolve(strict=True))
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.provider_url, self.provider_key = provider_url, provider_key
        self.instances = {}
        self.stderr_tasks = {}
        self.diagnostics = {}

    async def drain_stderr(self, instance_id, process, secrets_to_hide):
        if not process.stderr:
            return
        tail = ""
        while True:
            chunk = await process.stderr.read(4096)
            if not chunk:
                break
            tail = (tail + chunk.decode("utf-8", errors="replace"))[-4096:]
            safe = tail
            for secret in secrets_to_hide:
                safe = safe.replace(secret, "[redacted]")
            self.diagnostics[instance_id] = safe[-1200:]

    def assert_data(self, bridge):
        from fixtures.data import FakeData
        if not isinstance(bridge.data, FakeData):
            raise ValueError("live_data_not_allowed_in_local_probe")

    async def spawn(self, root, env, port, bridge_port, instance_id):
        return await asyncio.create_subprocess_exec(self.binary, "serve", "--hostname", "127.0.0.1", "--port", str(port),
            cwd=str(root / "workspace"), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    async def launch(self, context, bridge, model):
        self.assert_data(bridge)
        # Stable private identity is persisted before prepare, so a janitor can
        # remove an orphan even if the controller dies during container startup.
        instance_id = str(uuid.UUID(context["execution_ref"]))
        root = self.root / instance_id
        root.mkdir()
        for name in ("workspace", "home", "config", "data", "state", "cache", "temp"):
            (root / name).mkdir()
        token, password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        broker = ModelBroker(bridge, self.provider_url, self.provider_key, model)
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

        async def authorize(request):
            if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
                raise HTTPException(401)
            try:
                await bridge.check()
            except Exception:
                raise HTTPException(403, "execution_denied")

        @app.post("/mcp")
        async def mcp(request: Request):
            await authorize(request)
            result = await bridge.rpc(await request.json())
            return JSONResponse(result) if result is not None else Response(status_code=202)

        @app.post("/v1/chat/completions")
        async def completion(request: Request):
            await authorize(request)
            body = await request.json()
            try:
                result = await broker.completion(body)
            except Exception as exc:
                broker.errors.append(str(exc) if isinstance(exc, ValueError) else
                    f"HTTP_{exc.response.status_code}" if isinstance(exc, httpx.HTTPStatusError) else type(exc).__name__)
                if isinstance(exc, ValueError):
                    bridge.failure = "model_boundary_rejected"
                raise HTTPException(503, "controlled_model_unavailable")
            if body.get("stream"):
                return StreamingResponse(event_stream(result), media_type="text/event-stream")
            return result

        sock = socket.socket()
        sock.bind((self.broker_host, 0))
        bridge_port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False, timeout_graceful_shutdown=2))
        server_task = asyncio.create_task(server.serve(sockets=[sock]))
        runtime_socket = socket.socket()
        runtime_socket.bind(("127.0.0.1", 0))
        port = runtime_socket.getsockname()[1]
        runtime_socket.close()
        cfg = config(model, f"http://{self.broker_url_host}:{bridge_port}/v1", f"http://{self.broker_url_host}:{bridge_port}/mcp", token, bridge.schemas)
        (root / "workspace" / "opencode.json").write_text(json.dumps(cfg), encoding="utf-8")
        env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "PATH"}}
        env.update({"HOME": str(root / "home"), "USERPROFILE": str(root / "home"),
            "APPDATA": str(root / "config"), "LOCALAPPDATA": str(root / "data"),
            "XDG_CONFIG_HOME": str(root / "config"), "XDG_DATA_HOME": str(root / "data"),
            "XDG_STATE_HOME": str(root / "state"), "XDG_CACHE_HOME": str(root / "cache"),
            "TMP": str(root / "temp"), "TEMP": str(root / "temp"),
            "OPENCODE_SERVER_PASSWORD": password, "OPENCODE_SERVER_USERNAME": "opencode",
            "OPENCODE_DISABLE_AUTOUPDATE": "true", "OPENCODE_DISABLE_DEFAULT_PLUGINS": "true",
            "OPENCODE_DISABLE_PROJECT_CONFIG": "true", "OPENCODE_CONFIG": str(root / "workspace" / "opencode.json"),
            "OPENCODE_DISABLE_CLAUDE_CODE": "true", "OPENCODE_DISABLE_EXTERNAL_SKILLS": "true"})
        try:
            process = await self.spawn(root, env, port, bridge_port, instance_id)
        except BaseException:
            server.should_exit = True
            await server_task
            await broker.client.aclose()
            shutil.rmtree(root)
            raise
        self.instances[instance_id] = (process, root, server, server_task, broker)
        self.stderr_tasks[instance_id] = asyncio.create_task(self.drain_stderr(instance_id, process, (password, token)))
        try:
            async with httpx.AsyncClient(trust_env=False, auth=("opencode", password), timeout=1) as client:
                for _ in range(200):
                    try:
                        response = await client.get(f"http://127.0.0.1:{port}/global/health")
                        if response.status_code == 200:
                            return {"id": instance_id, "endpoint": f"http://127.0.0.1:{port}", "password": password,
                                "config": getattr(self, "config_overrides", {}).pop(instance_id, cfg)}
                    except httpx.HTTPError:
                        pass
                    if process.returncode is not None:
                        self.start_exit_code = process.returncode
                        await self.stderr_tasks[instance_id]
                        self.start_diagnostic = self.diagnostics.get(instance_id, "")
                        raise ValueError("runtime_start_failed")
                    await asyncio.sleep(.1)
            raise TimeoutError("runtime_start_timeout")
        except BaseException:
            await self.destroy(instance_id)
            raise

    async def destroy(self, instance_id):
        entry = self.instances.get(instance_id)
        target = (self.root / instance_id).resolve()
        if target.parent != self.root or target.name != str(uuid.UUID(instance_id)):
            raise ValueError("invalid_cleanup_path")
        if entry:
            process, root, server, task, broker = entry
            if process.returncode is None:
                process.kill()
            await process.wait()
            drain = self.stderr_tasks.pop(instance_id, None)
            if drain:
                await drain
            server.should_exit = True
            await task
            import logging
            logging.getLogger("backlog.runtime").warning("Runtime finished: model_requests=%s input_bound=%s errors=%s", broker.requests, broker.max_input_bytes, broker.errors)
            await broker.client.aclose()
        elif target.exists():
            # After controller restart, cannot prove that an orphan process stopped.
            raise ValueError("orphan_requires_supervisor_cleanup")
        if target.exists():
            for attempt in range(10):
                try:
                    shutil.rmtree(target)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    await asyncio.sleep(.2)
        self.instances.pop(instance_id, None)
        self.diagnostics.pop(instance_id, None)
