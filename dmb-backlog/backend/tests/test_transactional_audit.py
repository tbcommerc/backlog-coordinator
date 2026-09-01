from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from audit_context import begin_audit_request, end_audit_request
from models import AuditLog, EventOutbox, Report


def test_audit_record_commits_with_business_transaction_and_rolls_back_with_it():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Report.__table__.create(engine)
    EventOutbox.__table__.create(engine)
    AuditLog.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    token = begin_audit_request(
        request_id="request-atomic-audit",
        trace_id="2" * 32,
        user_id=None,
        method="POST",
        path="/api/v1/reports/",
        ip_address="127.0.0.1",
    )
    try:
        rolled_back = Session()
        rolled_back.add(Report(name="Rollback", type="custom", version=0))
        rolled_back.flush()
        assert rolled_back.query(AuditLog).count() == 1
        rolled_back.rollback()
        assert rolled_back.query(Report).count() == 0
        assert rolled_back.query(AuditLog).count() == 0

        committed = Session()
        committed.add(Report(name="Committed", type="custom", version=0))
        committed.commit()
        audit = committed.query(AuditLog).one()
        assert audit.action == "create"
        assert audit.entity_type == "reports"
        assert audit.request_id == "request-atomic-audit"
        assert audit.trace_id == "2" * 32
    finally:
        end_audit_request(token)
        engine.dispose()
