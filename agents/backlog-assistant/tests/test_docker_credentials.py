import asyncio
import json
import sys
import time
from runtime import docker


def test_runtime_password_is_not_in_docker_arguments(tmp_path,monkeypatch):
    image="sha256:"+"0"*64
    monkeypatch.setattr(docker.shutil,"which",lambda _:sys.executable)
    launcher=docker.DockerLauncher(tmp_path,"https://opencode.ai/zen/go/v1","synthetic-go-key",image)
    launcher._resolved_hosts[image]=(time.monotonic(),"127.0.0.1")
    workspace=tmp_path/"workspace"
    workspace.mkdir()
    (workspace/"opencode.json").write_text(json.dumps({"provider":{"controlled":{"options":{}}},"mcp":{"dmb":{}}}))
    captured={}
    async def spawn(*args,**kwargs):
        captured.update(args=args,kwargs=kwargs)
        return object()
    monkeypatch.setattr(docker.asyncio,"create_subprocess_exec",spawn)
    asyncio.run(launcher.spawn(tmp_path,{"OPENCODE_SERVER_PASSWORD":"synthetic-runtime-password"},49100,49101,"synthetic-instance"))
    assert "synthetic-runtime-password" not in " ".join(captured["args"])
    assert "synthetic-go-key" not in " ".join(captured["args"])
    assert captured["kwargs"]["env"]["OPENCODE_SERVER_PASSWORD"]=="synthetic-runtime-password"
    assert "OPENCODE_SERVER_PASSWORD" in captured["args"]


def test_publish_port_cannot_be_claimed_by_automatic_health_client(monkeypatch):
    from runtime import local_probe
    selected=iter([0,1])
    ports=[]
    closed=[]
    class Socket:
        def bind(self,address):
            ports.append(address)
            if address[1]==20000:
                raise OSError('synthetic occupied port')
        def close(self):
            closed.append(True)
    monkeypatch.setattr(local_probe.socket,'socket',Socket)
    monkeypatch.setattr(local_probe.secrets,'randbelow',lambda maximum:next(selected))
    assert local_probe.free_runtime_port()==20001
    assert ports==[('127.0.0.1',20000),('127.0.0.1',20001)] and len(closed)==2
