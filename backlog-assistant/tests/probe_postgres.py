"""Ephemeral PostgreSQL probe. Creates only the assistant's own tables."""
import concurrent.futures
import json
import secrets
import subprocess
import time
import uuid
from sqlalchemy import create_engine, select, update
from contracts.models import Context
from service.migrate import migrate
from service.store import Store, runs


def main():
    name = "backlog-assistant-test-" + str(uuid.uuid4())
    password = secrets.token_urlsafe(24)
    def docker(*args):
        return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.DEVNULL).strip()
    report = {}
    try:
        docker("run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1::5432",
               "--env", "POSTGRES_PASSWORD="+password, "--env", "POSTGRES_DB=assistant_test", "postgres:16-alpine")
        port = json.loads(docker("inspect", name))[0]["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
        url = f"postgresql+psycopg://postgres:{password}@127.0.0.1:{port}/assistant_test"
        for _ in range(100):
            if subprocess.call(["docker", "exec", name, "pg_isready", "-U", "postgres"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
                break
            time.sleep(.1)
        migrate(url)
        migrate(url)
        engine = create_engine(url, pool_size=12)
        store = Store(engine)
        context = Context().model_dump(mode="json")
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            sessions = list(pool.map(lambda _: store.create("synthetic-one", "same", {"context": context}), range(8)))
        assert len({s["id"] for s in sessions}) == 1
        body = {"context": context, "context_revision": 1, "text": "synthetic", "execution_ref": str(uuid.uuid4())}
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            rows = list(pool.map(lambda _: store.enqueue("synthetic-one", sessions[0]["id"], "same", body), range(8)))
        assert len({r["id"] for r in rows}) == 1
        for i in range(7):
            owner = f"synthetic-{i}"
            session = store.create(owner, "create", {"context": context})
            store.enqueue(owner, session["id"], "q", dict(body, execution_ref=str(uuid.uuid4())))
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            claims = list(pool.map(lambda _: store.claim(str(uuid.uuid4())), range(8)))
        active = [r for r in claims if r]
        assert len(active) == 4 and len({r["id"] for r in active}) == 4
        with engine.begin() as c:
            c.execute(update(runs).where(runs.c.id == active[0]["id"]).values(lease_until=time.time()-1))
        assert store.claim("after-crash") is None  # dirty runtime still occupies capacity
        crashed = store.get_run(active[0]["owner"], active[0]["id"])
        assert crashed["status"] == "interrupted" and crashed["cleanup_pending"]
        engine.dispose()
        report = {"migrations_idempotent": True, "concurrent_create": 8, "concurrent_enqueue": 8,
            "claimed_once": 4, "global_limit": 4, "crash_not_redispatched": True}
    finally:
        docker("rm", "--force", name)
    print(json.dumps(dict(report, isolated_database_removed=True)))


if __name__ == "__main__":
    main()
