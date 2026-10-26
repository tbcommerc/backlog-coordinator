from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.application.service import AssistantV2Service
from app.models import Base
from app.security import ActorContext


class FakeAdapter:
    def __init__(self):
        self.snapshot_value = {
            "object_type": "task",
            "object_id": "248",
            "version": 7,
            "digest": "sha256:task-v7",
            "captured_at": "2026-09-18T09:00:00Z",
            "projection": {"title": "Task", "description": "Before"},
            "policy": {"allowed_diff_paths": ["/title", "/description"]},
        }

    def snapshot(self, object_type, object_id, actor_envelope):
        return {**self.snapshot_value, "object_type": object_type, "object_id": str(object_id)}

    def validate_diff(self, body, actor_envelope):
        return {
            "valid": body["base_version"] == self.snapshot_value["version"] and body["base_digest"] == self.snapshot_value["digest"],
            "version": self.snapshot_value["version"],
            "digest": self.snapshot_value["digest"],
        }

    def prepare_apply_intent(self, body, actor_envelope):
        valid = body["base_version"] == self.snapshot_value["version"] and body["base_digest"] == self.snapshot_value["digest"]
        return {
            "valid": valid,
            "version": self.snapshot_value["version"],
            "digest": self.snapshot_value["digest"],
            "current_version": self.snapshot_value["version"],
            "current_digest": self.snapshot_value["digest"],
            "form_url": f"#/backlog?task={body['target_id']}&assistantV2Diff={body['diff_id']}",
            "prefill": {item["path"].lstrip("/"): item.get("proposed_value") for item in body["operations"]},
        }


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(
        engine,
        "connect",
        lambda dbapi_connection, _connection_record: dbapi_connection.execute("PRAGMA foreign_keys=ON"),
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture
def actor():
    return ActorContext(
        issuer="dmb-backlog",
        user_id="42",
        team_id="7",
        roles=["Бизнес-аналитик"],
        permissions={"assistant_v2.pilot": True},
        pilot_allowed=True,
        purpose="test",
        request_id="req-test",
        trace_id="trace-test",
        jti="jti-test",
        raw_envelope="signed-test-envelope",
    )


@pytest.fixture
def fake_adapter():
    return FakeAdapter()


@pytest.fixture
def service(db, actor, fake_adapter):
    return AssistantV2Service(db, actor, adapter=fake_adapter)
