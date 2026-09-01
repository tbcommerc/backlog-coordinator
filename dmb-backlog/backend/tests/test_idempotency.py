import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from idempotency import reserve_idempotency
from models import IdempotencyRecord


def test_database_idempotency_record_survives_worker_retry():
    engine = create_engine("sqlite:///:memory:")
    IdempotencyRecord.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    first = Session()
    record, created = reserve_idempotency(
        first,
        operation="task.create",
        user_id=5,
        request_key="request-123",
        request_data={"title": "One"},
    )
    assert created is True
    record.resource_type = "task"
    record.resource_id = 17
    first.commit()

    retry = Session()
    same, created = reserve_idempotency(
        retry,
        operation="task.create",
        user_id=5,
        request_key="request-123",
        request_data={"title": "One"},
    )
    assert created is False
    assert same.resource_id == 17

    with pytest.raises(HTTPException) as conflict:
        reserve_idempotency(
            retry,
            operation="task.create",
            user_id=5,
            request_key="request-123",
            request_data={"title": "Different"},
        )
    assert conflict.value.status_code == 409
    assert conflict.value.detail["code"] == "idempotency_key_reused"
    engine.dispose()
