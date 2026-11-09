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
import hashlib
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
from dmb_agent_contracts.operation import limit_timeout


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
        self.controller_ref = hashlib.sha256(str(self.root).encode("utf-8")).hexdigest()
        self.config_overrides = {}
        self.network = os.environ.get('ASSISTANT_DOCKER_NETWORK','')
        self.bridge_ip = os.environ.get('ASSISTANT_DOCKER_BRIDGE_IP','')
        if bool(self.network) != bool(self.bridge_ip):
            raise ValueError('docker_controller_network_and_ip_required')
        if self.network:
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}',self.network):
                raise ValueError('invalid_docker_controller_network')
            self.bridge_ip = str(ipaddress.IPv4Address(self.bridge_ip))

    def runtime_endpoint(self, instance_id, port):
        if self.network:
            return 'http://backlog-runtime-'+str(uuid.UUID(instance_id))+':4096'
        return super().runtime_endpoint(instance_id,port)

    async def controller_address(self):
        # A configured address alone is not proof that it belongs to this
        # controller. Verify its actual attachment through the Docker daemon.
        identity = os.environ.get('HOSTNAME','')
        if not re.fullmatch(r'[a-f0-9]{12,64}',identity):
            raise ValueError('docker_controller_identity_required')
        process = await asyncio.create_subprocess_exec(self.binary,'network','inspect',self.network,
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            output,_ = await asyncio.wait_for(process.communicate(),limit_timeout(10))
        except BaseException:
            if process.returncode is None:
                process.kill()
            with suppress(Exception):
                await asyncio.wait_for(process.wait(),2)
            raise
        if process.returncode:
            raise ValueError('docker_controller_network_unavailable')
        records=json.loads(output)
        if not isinstance(records,list) or len(records)!=1:
            raise ValueError('docker_controller_network_unavailable')
        own=[entry for identifier,entry in (records[0].get('Containers') or {}).items()
            if identifier.startswith(identity)]
        if len(own)!=1 or own[0].get('IPv4Address','').split('/')[0]!=self.bridge_ip:
            raise ValueError('docker_controller_address_mismatch')
        return self.bridge_ip

    def assert_data(self, bridge):
        pass  # Enforced container egress policy replaces the synthetic-only process restriction.

    async def spawn(self, root, env, port, bridge_port, instance_id):
        cached = self._resolved_hosts.get(self.image)
        if self.network:
            bridge_ip = await self.controller_address()
        elif cached and time.monotonic() - cached[0] < 300:
            bridge_ip = cached[1]
        else:
            resolver = await asyncio.create_subprocess_exec(self.binary, "run", "--rm",
                "--name", "backlog-resolver-"+instance_id,
                "--label", "dmb.agent.resolver=backlog-assistant",
                "--label", "dmb.agent.execution="+instance_id,
                "--label", "dmb.agent.controller="+self.controller_ref,
                "--entrypoint", "timeout", self.image, "10", "getent", "ahostsv4", "host.docker.internal",
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                output, _ = await asyncio.wait_for(resolver.communicate(), limit_timeout(30))
            except BaseException:
                if resolver.returncode is None:
                    resolver.kill()
                with suppress(Exception):
                    await asyncio.wait_for(resolver.wait(),2)
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
            "--label", "dmb.agent.runtime=backlog-assistant",
            "--label", "dmb.agent.execution="+instance_id,
            "--label", "dmb.agent.controller="+self.controller_ref,
            "--read-only", "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "SETUID",
            "--cap-add", "SETGID", "--cap-add", "SETPCAP", "--cap-add", "CHOWN", "--security-opt", "no-new-privileges",
            "--pids-limit", "128", "--memory", "768m", "--cpus", "1",
            "--tmpfs", "/state:rw,nosuid,nodev,size=256m", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
            "--env", "OPENCODE_SERVER_PASSWORD",
            "--env", "BRIDGE_PORT="+str(bridge_port), "--env", "BRIDGE_IP="+bridge_ip]
        client_env=dict(os.environ)
        client_env["OPENCODE_SERVER_PASSWORD"]=env["OPENCODE_SERVER_PASSWORD"]
        if self.network:
            args += ['--network',self.network,'--env','OPENCODE_CONFIG_CONTENT']
            client_env['OPENCODE_CONFIG_CONTENT']=json.dumps(cfg,separators=(',',':'))
        else:
            args += ['--publish',f'127.0.0.1:{port}:4096','--mount',
                f"type=bind,source={root / 'workspace' / 'opencode.json'},target=/run/opencode.json,readonly"]
        args.append(self.image)
        return await asyncio.create_subprocess_exec(*args, env=client_env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    async def destroy(self, instance_id):
        uuid.UUID(instance_id)
        async def command(*args):
            process = await asyncio.create_subprocess_exec(self.binary, *args,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                output, _ = await asyncio.wait_for(process.communicate(), 10)
            except BaseException:
                if process.returncode is None:
                    process.kill()
                with suppress(Exception):
                    await asyncio.wait_for(process.wait(), 2)
                raise
            return process.returncode, output

        async def remove_owned(name, kind):
            # A name is only a lookup hint. Removal requires immutable ID and labels.
            code, output = await command("container", "ls", "--all", "--no-trunc",
                "--filter", "name=^/"+name+"$", "--format", "{{.ID}}")
            if code:
                raise ValueError("runtime_cleanup_unconfirmed")
            identities = output.decode("ascii").split()
            if len(identities) > 1:
                raise ValueError("runtime_ownership_mismatch")
            if identities:
                identity = identities[0]
                if not re.fullmatch(r"[a-f0-9]{64}", identity):
                    raise ValueError("runtime_cleanup_unconfirmed")
                code, output = await command("inspect", identity)
                if code:
                    raise ValueError("runtime_cleanup_unconfirmed")
                records = json.loads(output)
                if len(records) != 1:
                    raise ValueError("runtime_ownership_mismatch")
                record = records[0]
                labels = record.get("Config", {}).get("Labels") or {}
                if (record.get("Id") != identity or record.get("Name") != "/"+name
                    or record.get("Image") != self.image
                    or labels.get(kind) != "backlog-assistant"
                    or labels.get("dmb.agent.execution") != instance_id
                    or labels.get("dmb.agent.controller") != self.controller_ref):
                    raise ValueError("runtime_ownership_mismatch")
                code, _ = await command("rm", "--force", identity)
                if code:
                    raise ValueError("runtime_cleanup_unconfirmed")
                code, output = await command("container", "ls", "--all", "--no-trunc",
                    "--filter", "id="+identity, "--format", "{{.ID}}")
                if code or output.strip():
                    raise ValueError("runtime_cleanup_unconfirmed")
        await remove_owned("backlog-runtime-"+instance_id,"dmb.agent.runtime")
        await remove_owned("backlog-resolver-"+instance_id,"dmb.agent.resolver")
        if instance_id not in self.instances:
            target = (self.root / instance_id).resolve()
            if target.parent != self.root:
                raise ValueError("invalid_cleanup_path")
            if target.exists():
                shutil.rmtree(target)
            return
        await super().destroy(instance_id)
