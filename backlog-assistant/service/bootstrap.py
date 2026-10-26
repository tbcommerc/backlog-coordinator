"""Dedicated service configuration; migrations and pilot activation remain explicit."""
import os
import ssl
import uvicorn
from sqlalchemy import create_engine, inspect
from fixtures.data import FakeData
from runtime.fake import FakeRuntime
from runtime.local_probe import LocalProbeLauncher
from runtime.opencode import OpenCodeRuntime
from service.app import create_app
from service.store import Store, metadata


def build_app():
    url = os.environ["ASSISTANT_DATABASE_URL"]
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("assistant_database_requires_postgresql")
    engine = create_engine(url, pool_pre_ping=True)
    actual = set(inspect(engine).get_table_names())
    if actual - (set(metadata.tables) | {"backlog_assistant_migrations"}) or not set(metadata.tables) <= actual:
        raise ValueError("dedicated_database_migration_required")
    synthetic = os.environ.get("ASSISTANT_SYNTHETIC_ONLY") == "true"
    if synthetic:
        data = FakeData()
    else:
        from service.data_client import HTTPDataPort
        data = HTTPDataPort(os.environ["DMB_DATA_API_URL"], os.environ["ASSISTANT_SERVICE_TOKEN"],
            verify=os.environ["ASSISTANT_TLS_CA"], cert=(os.environ["ASSISTANT_TLS_CERT"], os.environ["ASSISTANT_TLS_KEY"]))
    runtime_kind = os.environ.get("ASSISTANT_RUNTIME", "opencode")
    if runtime_kind == "fake":
        if not synthetic:
            raise ValueError("fake_runtime_requires_synthetic_data")
        runtime = FakeRuntime()
    elif runtime_kind == "opencode":
        from runtime.docker import DockerLauncher
        launcher = DockerLauncher(os.environ.get("ASSISTANT_STATE_DIR", ".runtime/instances"),
            os.environ["ASSISTANT_MODEL_URL"], os.environ["ASSISTANT_MODEL_KEY"], os.environ["ASSISTANT_RUNTIME_IMAGE"])
        runtime = OpenCodeRuntime(launcher, model=os.environ["ASSISTANT_MODEL"])
    else:
        raise ValueError("unknown_runtime")
    app = create_app(Store(engine), data, runtime, os.environ["ASSISTANT_GATEWAY_SECRET"],
        fixture_registration=data.register if synthetic else None)
    return app


if __name__ == "__main__":
    # TLS is mandatory on the service listener, even for the standalone API.
    uvicorn.run(build_app(), host="127.0.0.1", port=9400, access_log=False,
        ssl_keyfile=os.environ["ASSISTANT_TLS_KEY"], ssl_certfile=os.environ["ASSISTANT_TLS_CERT"],
        ssl_ca_certs=os.environ["ASSISTANT_TLS_CA"], ssl_cert_reqs=ssl.CERT_REQUIRED)
