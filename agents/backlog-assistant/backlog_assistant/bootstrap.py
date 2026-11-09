"""Dedicated service configuration; migrations and pilot activation remain explicit."""
from backlog_assistant.config import environment,service_port
import os
import ssl
from dmb_agent_contracts.serve import serve
from sqlalchemy import create_engine, inspect
from fixtures.data import FakeData
from runtime.fake import FakeRuntime
from runtime.local_probe import LocalProbeLauncher
from runtime.opencode import OpenCodeRuntime
from backlog_assistant.app import create_app
from backlog_assistant.store import Store, metadata


def build_app():
    os.environ.update(environment())
    from dmb_agent_contracts.limiter import require_runtime_limiter
    require_runtime_limiter()
    url = os.environ["ASSISTANT_DATABASE_URL"]
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("assistant_database_requires_postgresql")
    engine = create_engine(url, pool_pre_ping=True)
    actual = set(inspect(engine).get_table_names())
    if actual - (set(metadata.tables) | {"backlog_assistant_migrations", "agent_runtime_bindings", "agent_runtime_migrations"}) or not set(metadata.tables) <= actual:
        raise ValueError("dedicated_database_migration_required")
    from backlog_assistant.migrate import validate as validate_run_schema
    validate_run_schema(engine)
    synthetic = os.environ.get("ASSISTANT_SYNTHETIC_ONLY") == "true"
    if synthetic:
        data = FakeData()
    else:
        from backlog_assistant.data_client import HTTPDataPort
        data = HTTPDataPort(os.environ["DMB_DATA_API_URL"], os.environ["ASSISTANT_SERVICE_TOKEN"],
            verify=os.environ["ASSISTANT_TLS_CA"], cert=(os.environ["ASSISTANT_TLS_CERT"], os.environ["ASSISTANT_TLS_KEY"]))
    runtime_kind = os.environ.get("ASSISTANT_RUNTIME", "opencode")
    if runtime_kind == "opencode":
        for name, expected in (("MODEL_PROVIDER","opencode_go"),("MODEL_PROTOCOL","chat_completions"),
                               ("RUNTIME_LOCATION",os.environ.get("ASSISTANT_RUNTIME_LOCATION","local_isolated")),("RUNTIME_CONTRACT_VERSION","1.17.13")):
            if os.environ.get("ASSISTANT_"+name, expected) != expected:
                raise ValueError("unsupported_BACKLOG_ASSISTANT_"+name)
    if runtime_kind == "fake":
        if not synthetic:
            raise ValueError("fake_runtime_requires_synthetic_data")
        runtime = FakeRuntime()
    elif runtime_kind == "opencode" and os.environ.get("ASSISTANT_RUNTIME_LOCATION","local_isolated") == "remote":
        from runtime.prepared import PreparedRuntime, load_deployment
        runtime = PreparedRuntime(load_deployment())
    elif runtime_kind == "opencode":
        if os.environ.get("ASSISTANT_RUNTIME_LOCATION","local_isolated") != "local_isolated":
            raise ValueError("unsupported_BACKLOG_ASSISTANT_RUNTIME_LOCATION")
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
    os.environ.update(environment())
    # TLS is mandatory on the service listener, even for the standalone API.
    serve(build_app(), host="127.0.0.1", port=service_port("ASSISTANT_PORT",9400), access_log=False,
        ssl_keyfile=os.environ["ASSISTANT_TLS_KEY"], ssl_certfile=os.environ["ASSISTANT_TLS_CERT"],
        ssl_ca_certs=os.environ["ASSISTANT_TLS_CA"], ssl_cert_reqs=ssl.CERT_REQUIRED)
