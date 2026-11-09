"""Durable internal run facade; additive technical DDL, no product seed."""
from alembic import op
from sqlalchemy import MetaData, Table, Column, String, Integer, Text, DateTime, JSON, UniqueConstraint
revision = "20261104_01"
down_revision = "20261102_01"
branch_labels = None
depends_on = None

metadata = MetaData()
runs = Table("agent_runs", metadata,
    Column("id", String(36), primary_key=True), Column("caller", String(128), nullable=False),
    Column("actor", String(128), nullable=False), Column("key", String(128), nullable=False),
    Column("request_hash", String(64), nullable=False), Column("input", JSON),
    Column("profile", JSON, nullable=False), Column("source", JSON, nullable=False),
    Column("operation", String(80), nullable=False), Column("conversation_ref", String(128)),
    Column("trusted_context", JSON, nullable=False),
    Column("status", String(24), nullable=False), Column("version", Integer, nullable=False),
    Column("delivery", String(24), nullable=False), Column("dispatch_ref", String(36)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("deadline_at", DateTime(timezone=True), nullable=False),
    Column("lease_until", DateTime(timezone=True)), Column("finished_at", DateTime(timezone=True)),
    Column("cancel_requested_at", DateTime(timezone=True)), Column("result", JSON),
    Column("payload_hash", String(64)), Column("error", String(64)), Column("ack_at", DateTime(timezone=True)),
    Column("result_expired", Integer, nullable=False, default=0),
    UniqueConstraint("caller", "actor", "key", name="uq_agent_run_idempotency"))
events = Table("agent_run_events", metadata,
    Column("run_id", String(36), primary_key=True), Column("sequence", Integer, primary_key=True),
    Column("type", String(32), nullable=False), Column("occurred_at", DateTime(timezone=True), nullable=False))

def upgrade():
    metadata.create_all(op.get_bind(), checkfirst=False)


def downgrade():
    raise RuntimeError("Restore a verified compatible backup; durable run history is not dropped automatically")
