"""Real Docker isolation probe using two synthetic executions and no LLM calls."""
import argparse
import asyncio
import json
import time
from pathlib import Path
import httpx
from fixtures.data import FakeData
from bridge.tools import ToolBridge
from runtime.docker import DockerLauncher


async def main(image, root):
    launcher = DockerLauncher(root, "https://synthetic.invalid", "unused", image)
    instances = []
    async def command(instance, *args):
        process = await asyncio.create_subprocess_exec("docker", "exec", "--user", "10001", "backlog-runtime-"+instance["id"],
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        output, _ = await process.communicate()
        return process.returncode, output.decode()
    try:
        for owner in ("one", "two"):
            data = FakeData()
            execution = data.register(owner)
            grant = await data.activate(execution, "test")
            bridge = ToolBridge(data, execution, grant, await data.catalog(execution, grant), deadline=time.monotonic()+90)
            instances.append(await launcher.launch({"execution_ref": execution}, bridge, "synthetic"))
        one, two = instances
        assert one["id"] != two["id"] and one["password"] != two["password"]
        async with httpx.AsyncClient(trust_env=False) as client:
            assert (await client.get(one["endpoint"]+"/global/health", auth=("opencode", two["password"]))).status_code == 401
        code, status = await command(one, "cat", "/proc/1/status")
        assert code == 0 and "CapEff:\t0000000000000000" in status and "NoNewPrivs:\t1" in status
        code, _ = await command(one, "node", "-e", "require('fs').writeFileSync('/state/workspace/sentinel','one')")
        assert code == 0
        code, _ = await command(two, "test", "-e", "/state/workspace/sentinel")
        assert code != 0
        code, _ = await command(one, "node", "-e", "require('fs').writeFileSync('/run/not-allowed','x')")
        assert code != 0
        code, _ = await command(one, "node", "-e", "const s=require('net').connect(443,'1.1.1.1');s.on('connect',()=>process.exit(7));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),1500)")
        assert code == 0
        code, _ = await command(one, "test", "-e", "/var/run/docker.sock")
        assert code != 0
    finally:
        for instance in instances:
            await launcher.destroy(instance["id"])
    assert not any(Path(root).iterdir())
    print(json.dumps({"two_instances": True, "cross_credentials_denied": True, "state_separated": True,
        "capabilities_dropped": True, "root_read_only": True, "external_egress_denied": True,
        "docker_socket_absent": True, "state_cleaned": True}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--state", default=".runtime/isolation")
    args = parser.parse_args()
    asyncio.run(main(args.image, args.state))
