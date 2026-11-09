import asyncio
import json
import sys
from uuid import uuid4

import pytest
from runtime import docker


@pytest.mark.parametrize("foreign", [False, True])
@pytest.mark.parametrize("kind", ["runtime", "resolver"])
def test_cleanup_requires_owned_immutable_container(tmp_path, monkeypatch, foreign, kind):
    monkeypatch.setattr(docker.shutil, "which", lambda _: sys.executable)
    launcher = docker.DockerLauncher(tmp_path, "https://synthetic.invalid", "unused", "sha256:"+"1"*64)
    execution = str(uuid4())
    identity = "2"*64
    calls = []
    record = {"Id": identity, "Name": "/backlog-"+kind+"-"+execution,
        "Image": launcher.image, "Config": {"Labels": {
            "dmb.agent."+kind: "backlog-assistant", "dmb.agent.execution": execution,
            "dmb.agent.controller": "foreign" if foreign else launcher.controller_ref}}}

    class Process:
        returncode = 0
        async def communicate(self):
            args = calls[-1]
            if args[1] == "inspect":
                return json.dumps([record]).encode(), b""
            if "name=^/backlog-"+kind+"-"+execution+"$" in args:
                return identity.encode(), b""
            return b"", b""

    async def spawn(*args, **kwargs):
        calls.append(args)
        return Process()

    monkeypatch.setattr(docker.asyncio, "create_subprocess_exec", spawn)
    if foreign:
        with pytest.raises(ValueError, match="runtime_ownership_mismatch"):
            asyncio.run(launcher.destroy(execution))
        assert not any("rm" in call for call in calls)
    else:
        asyncio.run(launcher.destroy(execution))
        assert any(call[1:] == ("rm", "--force", identity) for call in calls)


@pytest.mark.parametrize('address_matches',[True,False])
def test_controller_network_address_is_verified_against_own_container(tmp_path,monkeypatch,address_matches):
    monkeypatch.setattr(docker.shutil,'which',lambda _:sys.executable)
    monkeypatch.setenv('ASSISTANT_DOCKER_NETWORK','synthetic-network')
    monkeypatch.setenv('ASSISTANT_DOCKER_BRIDGE_IP','172.29.233.10')
    monkeypatch.setenv('HOSTNAME','a'*12)
    launcher=docker.DockerLauncher(tmp_path,'https://synthetic.invalid','unused','sha256:'+'1'*64)
    class Process:
        returncode=0
        async def communicate(self):
            return json.dumps([{'Containers':{'a'*64:{'IPv4Address':
                ('172.29.233.10' if address_matches else '172.29.233.11')+'/24'}}}]).encode(),b''
    async def spawn(*args,**kwargs):
        assert args[1:]==('network','inspect','synthetic-network')
        return Process()
    monkeypatch.setattr(docker.asyncio,'create_subprocess_exec',spawn)
    if address_matches:
        assert asyncio.run(launcher.controller_address())=='172.29.233.10'
    else:
        with pytest.raises(ValueError,match='docker_controller_address_mismatch'):
            asyncio.run(launcher.controller_address())


def test_container_controller_transfers_config_without_host_path_or_secret_in_argv(tmp_path,monkeypatch):
    monkeypatch.setattr(docker.shutil,'which',lambda _:sys.executable)
    monkeypatch.setenv('ASSISTANT_DOCKER_NETWORK','synthetic-network')
    monkeypatch.setenv('ASSISTANT_DOCKER_BRIDGE_IP','172.29.233.10')
    launcher=docker.DockerLauncher(tmp_path,'https://synthetic.invalid','provider-key-never-forwarded','sha256:'+'1'*64)
    execution=str(uuid4())
    root=tmp_path/execution
    (root/'workspace').mkdir(parents=True)
    from runtime.opencode import config
    cfg=config('model','http://unused/v1','http://unused/mcp','limited-bridge-credential',[])
    (root/'workspace/opencode.json').write_text(json.dumps(cfg),encoding='utf-8')
    async def address():return '172.29.233.10'
    monkeypatch.setattr(launcher,'controller_address',address)
    async def spawn(*args,**kwargs):
        assert '--mount' not in args and '--publish' not in args
        assert '--network' in args and 'synthetic-network' in args
        assert not any(value in ' '.join(args) for value in
            ('limited-bridge-credential','runtime-password','provider-key-never-forwarded'))
        assert kwargs['env']['OPENCODE_SERVER_PASSWORD']=='runtime-password'
        payload=json.loads(kwargs['env']['OPENCODE_CONFIG_CONTENT'])
        assert payload['provider']['controlled']['options']['baseURL']=='http://172.29.233.10:12345/v1'
        assert 'provider-key-never-forwarded' not in kwargs['env']['OPENCODE_CONFIG_CONTENT']
        return 'synthetic-process'
    monkeypatch.setattr(docker.asyncio,'create_subprocess_exec',spawn)
    assert asyncio.run(launcher.spawn(root,{'OPENCODE_SERVER_PASSWORD':'runtime-password'},20001,12345,execution))=='synthetic-process'
    assert launcher.runtime_endpoint(execution,20001)=='http://backlog-runtime-'+execution+':4096'
