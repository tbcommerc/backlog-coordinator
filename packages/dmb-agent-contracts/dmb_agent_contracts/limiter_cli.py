"""Explicit coordinator bootstrap for service launchers; no provider calls."""
import argparse
import json
import os
from pathlib import Path
from uuid import uuid4

from .limiter import LimiterConfig, RedisLimiter
from .model import AgentError


def prepare(directory, namespace, mode, redis_url, reconcile=False):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / "prepare.lock"
    stream_lock = lock.open("a+b")
    stream_lock.seek(0, 2)
    if stream_lock.tell() == 0:
        stream_lock.write(b"0")
        stream_lock.flush()
    stream_lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream_lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            if reconcile:
                raise AgentError("limiter_recovery_required",503)
            import fcntl
            fcntl.flock(stream_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        stream_lock.close()
        raise AgentError("limiter_initialization_busy", 503) from None
    try:
        path = directory / "epoch.json"
        if path.exists():
            state = json.loads(path.read_text(encoding="utf-8"))
            if state.get("namespace") != namespace or state.get("mode") != mode:
                raise AgentError("limiter_configuration_conflict", 503)
        else:
            state = {"namespace": namespace, "mode": mode, "epoch": uuid4().hex, "state": "initializing"}
            with path.open("x", encoding="utf-8") as stream:
                json.dump(state, stream)
                stream.flush()
                os.fsync(stream.fileno())
        config = LimiterConfig(redis_url=redis_url, namespace=namespace, epoch=state["epoch"],
            journal_dir=directory / "leases", limit=2 if mode == "global" else 1)
        gate = RedisLimiter(config)
        if reconcile:
            gate.reconcile_after_restart()
        gate.bootstrap(initialize=state["state"] == "initializing")
        gate.recover_confirmed()
        state["state"] = "ready"
        temporary = directory / ("epoch-"+uuid4().hex+".tmp")
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        return {"mode": mode, "namespace": namespace, "epoch": config.epoch,
            "journal_dir": str(config.journal_dir), "limit": config.limit}
    finally:
        stream_lock.close()  # OS releases the lock even after a launcher crash.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--mode", choices=("global", "standalone"), required=True)
    parser.add_argument("--reconcile-after-restart",action="store_true")
    args = parser.parse_args()
    try:
        redis_url = os.environ.get("DMB_AGENT_LIMITER_REDIS_URL", "redis://127.0.0.1:6379/0")
        print(json.dumps(prepare(args.state_dir, args.namespace, args.mode, redis_url,args.reconcile_after_restart)), flush=True)
    except (AgentError, OSError, ValueError, KeyError) as error:
        code = error.code if isinstance(error, AgentError) else "limiter_bootstrap_failed"
        print(json.dumps({"error": code}), flush=True)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
