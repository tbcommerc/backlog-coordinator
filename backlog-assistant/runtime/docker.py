"""Trusted Docker launcher. The model container never receives the Docker socket."""
import asyncio
import os
import re
import shutil
import subprocess
import uuid
import ipaddress
import json
import time
from contextlib import suppress


async def wait_process(process, timeout=10):
    try:
        return await asyncio.wait_for(process.wait(), timeout)
    except BaseException:
        if process.returncode is None:
            process.kill()
        with suppress(Exception):
            await asyncio.wait_for(process.wait(), 2)
        raise
from runtime.local_probe import LocalProbeLauncher


class DockerLauncher(LocalProbeLauncher):
    _resolved_hosts = {}
    broker_host = "0.0.0.0"
    broker_url_host = "host.docker.internal"

    def __init__(self, root, provider_url, provider_key, image):
        executable = shutil.which("docker")
        if not executable or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise ValueError("pinned_runtime_image_required")
        super().__init__(executable, root, provider_url, provider_key, synthetic_only=True)
        self.image = image
        self.config_overrides = {}

    def assert_data(self, bridge):
        pass  # Enforced container egress policy replaces the synthetic-only process restriction.

    async def spawn(self, root, env, port, bridge_port, instance_id):
        cached = self._resolved_hosts.get(self.image)
        if cached and time.monotonic() - cached[0] < 300:
            bridge_ip = cached[1]
        else:
            resolver = await asyncio.create_subprocess_exec(self.binary, "run", "--rm", "--entrypoint", "getent",
                self.image, "ahostsv4", "host.docker.internal", stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                output, _ = await asyncio.wait_for(resolver.communicate(), 10)
            except BaseException:
                resolver.kill()
                raise
            if resolver.returncode != 0 or not output.strip():
                raise ValueError("docker_resolver_unavailable")
            bridge_ip = str(ipaddress.IPv4Address(output.decode().split()[0]))
            self._resolved_hosts[self.image] = (time.monotonic(), bridge_ip)
        path = root / "workspace" / "opencode.json"
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cfg["provider"]["controlled"]["options"]["baseURL"] = f"http://{bridge_ip}:{bridge_port}/v1"
        cfg["mcp"]["dmb"]["url"] = f"http://{bridge_ip}:{bridge_port}/mcp"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        self.config_overrides[instance_id] = cfg
        args = [self.binary, "run", "--rm", "--name", "backlog-runtime-"+instance_id,
            "--read-only", "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "SETUID",
            "--cap-add", "SETGID", "--cap-add", "SETPCAP", "--cap-add", "CHOWN", "--security-opt", "no-new-privileges",
            "--pids-limit", "128", "--memory", "768m", "--cpus", "1",
            "--tmpfs", "/state:rw,nosuid,nodev,size=256m", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
            "--publish", f"127.0.0.1:{port}:4096",
            "--mount", f"type=bind,source={root / 'workspace' / 'opencode.json'},target=/run/opencode.json,readonly",
            "--env", "OPENCODE_SERVER_PASSWORD="+env["OPENCODE_SERVER_PASSWORD"],
            "--env", "BRIDGE_PORT="+str(bridge_port), "--env", "BRIDGE_IP="+bridge_ip, self.image]
        return await asyncio.create_subprocess_exec(*args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    async def destroy(self, instance_id):
        uuid.UUID(instance_id)
        # Container removal is authoritative, including after worker restart.
        process = await asyncio.create_subprocess_exec(self.binary, "rm", "--force", "backlog-runtime-"+instance_id,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        await wait_process(process)
        check = await asyncio.create_subprocess_exec(self.binary, "inspect", "backlog-runtime-"+instance_id,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if await wait_process(check) == 0:
            raise ValueError("runtime_cleanup_unconfirmed")
        # Verify Docker itself is reachable; inspect failure alone is not absence.
        health = await asyncio.create_subprocess_exec(self.binary, "version", "--format", "{{.Server.Version}}",
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if await wait_process(health) != 0:
            raise ValueError("runtime_cleanup_unconfirmed")
        if instance_id not in self.instances:
            target = (self.root / instance_id).resolve()
            if target.parent != self.root:
                raise ValueError("invalid_cleanup_path")
            if target.exists():
                shutil.rmtree(target)
            return
        await super().destroy(instance_id)
