"""Run only the new technical migration inside a rolled-back PG schema."""
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_pending_ack_is_backfilled_without_protected_tables():
    url = os.environ.get("MEETING_RECEIPT_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Explicit disposable PostgreSQL required")
    engine = create_engine(url, connect_args={"connect_timeout": 5})
    schema = "receipt_test_" + uuid4().hex
    path = Path(__file__).resolve().parents[1] / "alembic/versions/d251c98e30f7_meeting_application_receipts.py"
    spec = importlib.util.spec_from_file_location("receipt_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                conn.execute(text(f'CREATE SCHEMA "{schema}"'))
                conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
                conn.execute(text("""CREATE TABLE meeting_captures (
                    id varchar(36), owner_id integer, analysis_run_id varchar(36),
                    analysis_service_run_id varchar(36), analysis_status varchar(16),
                    analysis_backend varchar(32), analysis_ack_pending boolean)"""))
                conn.execute(text("""INSERT INTO meeting_captures VALUES
                    ('draft-one',1,'operation-one','service-one','completed','meeting-analyzer',true),
                    ('draft-two',1,'operation-two','service-two','failed','meeting-analyzer',true),
                    ('legacy',1,'legacy-op',NULL,'completed','legacy',false)"""))
                with Operations.context(MigrationContext.configure(conn)):
                    module.upgrade()
                rows = conn.execute(text("SELECT service_run_id,decision,ack_pending FROM meeting_application_receipts ORDER BY service_run_id")).all()
                assert rows == [("service-one", "applied", True), ("service-two", "discarded", True)]
                assert conn.execute(text("SELECT count(*) FROM meeting_captures")).scalar_one() == 3
                with pytest.raises(RuntimeError, match="receipts must be retained"):
                    module.downgrade()
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
