"""Prove fail-closed behaviour after a real Redis RDB rollback, not just DEL."""
import argparse
import json
import subprocess
import time
import socket
from pathlib import Path
from uuid import uuid4


def docker(*args,timeout=60):
    result=subprocess.run(["docker",*args],capture_output=True,text=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError("owned_redis_qualification_command_failed")
    return result.stdout.strip()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--image-id",required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():
        raise RuntimeError("evidence_exists_no_replacement")
    if not args.image_id.startswith("sha256:") or len(args.image_id)!=71:
        raise RuntimeError("immutable_local_image_required")
    from dmb_agent_contracts.limiter import LimiterConfig,RedisLimiter
    from dmb_agent_contracts.model import AgentError
    marker=uuid4().hex
    name="agent-gate-rdb-"+marker[:12]
    args.output.parent.mkdir(parents=True,exist_ok=True)
    from agent_evidence import evidence_header
    report={**evidence_header("NFR-04,NFR-10","real_disposable_redis_restart_rdb_rollback","limiter-rdb-rollback-v1"),"status":"FAIL","live_go_calls":0}
    identity=None
    try:
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1",0))
            fixed_port=reservation.getsockname()[1]
        identity=docker("run","--detach","--pull=never","--name",name,"--label","dmb.agent.qualification="+marker,
            "--publish",f"127.0.0.1:{fixed_port}:6379",args.image_id,"redis-server","--appendonly","no","--save","")
        info=json.loads(docker("inspect",identity))[0]
        assert info["Id"]==identity
        port=info["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"]
        gate=RedisLimiter(LimiterConfig("redis://127.0.0.1:"+port+"/0","rdb-proof-"+marker,
            uuid4().hex,args.output.parent.resolve()/"leases"))
        assert json.loads(gate.config.profile)["protocol"]>=3
        deadline=time.monotonic()+15
        while True:
            try:
                gate.bootstrap(initialize=True)
                break
            except AgentError:
                if time.monotonic()>=deadline:raise
                time.sleep(.1)
        gate.client.command("SAVE")
        first,second=gate.acquire(uuid4(),"one"),gate.acquire(uuid4(),"two")
        assert gate.client.command("HLEN",gate.keys[2])==2
        old_generation=gate.client.command("GET",gate.keys[8])
        # Only this freshly created immutable ID, after label/identity proof.
        current=json.loads(docker("inspect",identity))[0]
        assert current["Config"]["Labels"]["dmb.agent.qualification"]==marker
        docker("restart","--time","0",identity)
        deadline=time.monotonic()+15
        while True:
            try:
                assert gate.client.command("PING")=="PONG"
                break
            except (AgentError,AssertionError):
                if time.monotonic()>=deadline:raise
                time.sleep(.1)
        assert gate.client.command("GET",gate.keys[0])==gate.config.epoch
        assert gate.client.command("HLEN",gate.keys[2])==0  # Old RDB lost the open leases.
        assert gate.client.command("GET",gate.keys[8])==old_generation
        try:
            gate.acquire(uuid4(),"must-not-start")
        except AgentError as error:
            assert error.code=="global_limiter_unavailable"
        else:
            raise AssertionError("restored_epoch_reopened_capacity")
        try:
            gate.reconcile_after_restart()
        except AgentError as error:
            assert error.code=="limiter_recovery_required"
        else:
            raise AssertionError("unconfirmed_owners_were_discarded")
        first.release();second.release()  # Explicit synthetic physical cleanup proof.
        gate.reconcile_after_restart()
        gate.bootstrap()
        assert gate.client.command("GET",gate.keys[8])!=old_generation
        next_lease=gate.acquire(uuid4(),"after-confirmed-cleanup")
        next_lease.release()
        report.update(status="PASS",restored_epoch_did_not_reopen_slots=True,
            repair_before_cleanup="REFUSED",repair_after_cleanup="PASS",active_after=gate.client.command("HLEN",gate.keys[2]))
    finally:
        if not identity:
            # A timed-out docker run can still have created the container.
            try:
                candidate=json.loads(docker("inspect",name,timeout=10))[0]
                if candidate["Config"]["Labels"].get("dmb.agent.qualification")==marker:
                    identity=candidate["Id"]
            except Exception:
                report["owned_test_container_cleanup"]="unconfirmed"
        if identity:
            try:
                current=json.loads(docker("inspect",identity,timeout=10))[0]
                if current["Config"]["Labels"].get("dmb.agent.qualification")!=marker:
                    raise RuntimeError("ownership_mismatch")
                docker("rm","--force","--volumes",identity,timeout=15)
                report["owned_test_container_cleanup"]="confirmed"
            except Exception:
                report["owned_test_container_cleanup"]="unconfirmed"
                report["status"]="FAIL"
        args.output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report),flush=True)


if __name__=="__main__":
    main()
