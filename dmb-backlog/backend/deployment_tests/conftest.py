"""Isolated deployment contracts. Never connect to the configured application DB."""
import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["RUN_STARTUP_SEED"] = "false"
os.environ["RUN_STARTUP_MAINTENANCE"] = "false"
os.environ["RUN_NOTIFICATION_SCHEDULER"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from database import Base
import models  # noqa: F401


@pytest.fixture(scope="session")
def isolated_engine():
    url = os.environ.get("DMB_DEPLOY_TEST_DATABASE_URL", "sqlite://")
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite" and not (parsed.get_backend_name() == "postgresql"
            and parsed.host in {"localhost", "127.0.0.1"} and (parsed.database or "").startswith("codex_deploytest_")):
        pytest.fail("Deployment tests require an isolated loopback codex_deploytest_* database")
    kwargs = {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}} if parsed.get_backend_name() == "sqlite" else {}
    engine = create_engine(url, **kwargs)
    if parsed.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def explicit_transactions(connection, _):
            connection.isolation_level = None
        @event.listens_for(engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(isolated_engine):
    with isolated_engine.connect() as conn:
        transaction = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()
