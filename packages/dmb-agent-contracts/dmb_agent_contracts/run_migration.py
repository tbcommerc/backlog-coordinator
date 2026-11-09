"""Explicit additive migration for the technical facade, never import-time DDL."""
from sqlalchemy import inspect, text

from .run_store import metadata


def _validate_existing(engine, allowed_existing, *, allow_legacy_retry=False, allow_legacy_scope=False):
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    expected = set(metadata.tables)
    if existing - expected - set(allowed_existing):
        raise RuntimeError("unexpected_agent_schema")
    for name in existing & expected:
        table = metadata.tables[name]
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        expected_columns = set(table.columns.keys())
        legacy = allow_legacy_retry and name == "agent_runs" and set(columns) == expected_columns - {"retry_of"}
        if set(columns) != expected_columns and not legacy:
            raise RuntimeError("unexpected_run_schema")
        for column in table.columns:
            if legacy and column.name == "retry_of":
                continue
            if (columns[column.name]["type"]._type_affinity != column.type._type_affinity
                or columns[column.name]["nullable"] != column.nullable):
                raise RuntimeError("unexpected_run_column_type")
        if inspector.get_pk_constraint(name).get("constrained_columns") != [column.name for column in table.primary_key]:
            raise RuntimeError("unexpected_run_primary_key")
        from sqlalchemy import UniqueConstraint
        actual_unique = inspector.get_unique_constraints(name)
        for constraint in table.constraints:
            if isinstance(constraint, UniqueConstraint) and not any(
                value["column_names"] == list(constraint.columns.keys()) or
                allow_legacy_scope and name == 'agent_runs' and value["column_names"] == ['caller','actor','key']
                for value in actual_unique):
                raise RuntimeError("run_idempotency_constraint_missing")
    return existing, expected


def migrate_operation_scope(connection):
    """Expand only the known technical uniqueness constraint, preserving all rows."""
    inspector = inspect(connection)
    constraints = inspector.get_unique_constraints('agent_runs')
    columns = ['caller','actor','operation','key']
    if any(value['column_names'] == columns for value in constraints):
        return
    if not any(value['column_names'] == ['caller','actor','key'] and
        value['name'] == 'uq_agent_run_idempotency' for value in constraints):
        raise RuntimeError('unexpected_run_idempotency_scope')
    if connection.dialect.name == 'postgresql':
        connection.execute(text('ALTER TABLE agent_runs DROP CONSTRAINT uq_agent_run_idempotency'))
        connection.execute(text('ALTER TABLE agent_runs ADD CONSTRAINT uq_agent_run_idempotency UNIQUE (caller,actor,operation,key)'))
    elif connection.dialect.name == 'sqlite':
        # SQLite cannot drop a table constraint. Explicit migration runs offline,
        # after a verified backup; the event table has no foreign-key dependency.
        from sqlalchemy import MetaData, select
        temporary = metadata.tables['agent_runs'].to_metadata(MetaData(),name='agent_runs_scope_migration')
        temporary.create(connection)
        names = list(temporary.columns.keys())
        connection.execute(temporary.insert().from_select(names, select(*(metadata.tables['agent_runs'].c[name] for name in names))))
        connection.execute(text('DROP TABLE agent_runs'))
        connection.execute(text('ALTER TABLE agent_runs_scope_migration RENAME TO agent_runs'))
    else:
        raise RuntimeError('unsupported_run_migration_dialect')


def validate(engine, *, allowed_existing=()):
    existing, expected = _validate_existing(engine, allowed_existing)
    if not expected <= existing:
        raise RuntimeError("run_schema_not_migrated")


def migrate(engine, *, backup_verified=False, allowed_existing=()):
    existing, expected = _validate_existing(engine, allowed_existing, allow_legacy_retry=True, allow_legacy_scope=True)
    missing_scope = 'agent_runs' in existing and not any(value['column_names'] == ['caller','actor','operation','key']
        for value in inspect(engine).get_unique_constraints('agent_runs'))
    missing_retry = "agent_runs" in existing and "retry_of" not in {
        column["name"] for column in inspect(engine).get_columns("agent_runs")}
    if expected <= existing and not missing_retry and not missing_scope:
        return
    if existing and not backup_verified:
        raise RuntimeError("run_schema_expansion_requires_verified_backup")
    with engine.begin() as connection:
        if missing_retry:
            connection.execute(text("ALTER TABLE agent_runs ADD COLUMN retry_of VARCHAR(36)"))
        if missing_scope:
            migrate_operation_scope(connection)
        metadata.create_all(connection)
    validate(engine, allowed_existing=allowed_existing)
