"""Durable scoped remote tools. Frozen DDL, no product seed or imports."""
from alembic import op
from sqlalchemy import MetaData, Table, Column, String, JSON, DateTime, ForeignKey, inspect

revision = "20261102_01"
down_revision = "20260907_01"
branch_labels = None
depends_on = None

metadata = MetaData()
grants = Table("agent_tool_grants", metadata,
    Column("id", String(36), primary_key=True), Column("token_hash", String(64), nullable=False, unique=True),
    Column("run_id", String(36), nullable=False, index=True), Column("subject", String(128), nullable=False),
    Column("issuer", String(64), nullable=False), Column("audience", String(64), nullable=False),
    Column("role", String(32), nullable=False), Column("task_key", String(64), nullable=False),
    Column("source_hash", String(64), nullable=False), Column("rubric_hash", String(64), nullable=False),
    Column("allowed_evidence", JSON, nullable=False), Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)))
receipts = Table("agent_tool_receipts", metadata,
    Column("grant_id", String(36), ForeignKey("agent_tool_grants.id"), primary_key=True),
    Column("call_id", String(128), primary_key=True), Column("request_hash", String(64), nullable=False),
    Column("response", JSON, nullable=False), Column("created_at", DateTime(timezone=True), nullable=False))


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    present = set(inspector.get_table_names()) & {grants.name, receipts.name}
    if present and present != {grants.name, receipts.name}:
        raise RuntimeError("Incomplete remote tool schema; migration refused")
    if present:
        for table in (grants, receipts):
            actual = {column["name"]: column for column in inspector.get_columns(table.name)}
            if set(actual) != set(table.columns.keys()):
                raise RuntimeError("Unexpected remote tool columns; migration refused")
            for column in table.columns:
                found = actual[column.name]
                if found["type"]._type_affinity != column.type._type_affinity or found["nullable"] != column.nullable:
                    raise RuntimeError("Unexpected remote tool column definition; migration refused")
            if inspector.get_pk_constraint(table.name).get("constrained_columns") != list(table.primary_key.columns.keys()):
                raise RuntimeError("Unexpected remote tool primary key; migration refused")
        unique = inspector.get_unique_constraints(grants.name)
        if not any(item["column_names"] == ["token_hash"] for item in unique):
            raise RuntimeError("Remote tool token uniqueness missing; migration refused")
        return
    for table in (grants, receipts):
        table.create(bind, checkfirst=False)


def downgrade():
    raise RuntimeError("Use compatible application rollback; tool receipts must be retained")
