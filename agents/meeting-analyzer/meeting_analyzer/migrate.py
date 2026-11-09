"""Explicit additive own-schema migrations; startup only validates read-only."""
from sqlalchemy import create_engine, inspect, text, UniqueConstraint
from .config import Settings
from .store import metadata


def inspect_schema(engine, *, allow_legacy_retry=False):
    inspector = inspect(engine)
    all_present = set(inspector.get_table_names())
    from dmb_agent_contracts.runtime_records import metadata as runtime_metadata, validate as validate_runtime_schema
    if all_present & set(runtime_metadata.tables):
        validate_runtime_schema(engine)
    present = all_present - set(runtime_metadata.tables)
    expected = set(metadata.tables)
    if present and present != expected:
        raise RuntimeError("Unexpected meeting schema; migration refused")
    missing_retry = False
    for name in present:
        table = metadata.tables[name]
        actual = {column["name"]:column for column in inspector.get_columns(name)}
        legacy = allow_legacy_retry and name == "meeting_runs" and set(actual) == set(table.columns.keys()) - {"retry_of"}
        if set(actual) != set(table.columns.keys()) and not legacy:
            raise RuntimeError("Unexpected meeting schema columns; migration refused")
        missing_retry = missing_retry or legacy
        for column in table.columns:
            if legacy and column.name == "retry_of":
                continue
            if (actual[column.name]["type"]._type_affinity != column.type._type_affinity or
                    actual[column.name]["nullable"] != column.nullable):
                raise RuntimeError("Unexpected meeting column type; migration refused")
        if inspector.get_pk_constraint(name).get("constrained_columns") != list(table.primary_key.columns.keys()):
            raise RuntimeError("Unexpected meeting primary key; migration refused")
        actual_unique = inspector.get_unique_constraints(name)
        for constraint in table.constraints:
            if isinstance(constraint,UniqueConstraint) and not any(
                    item["column_names"] == list(constraint.columns.keys()) for item in actual_unique):
                raise RuntimeError("Meeting idempotency constraint missing")
    return all_present, present, missing_retry


def validate(engine):
    _, present, _ = inspect_schema(engine)
    if present != set(metadata.tables):
        raise RuntimeError("Meeting schema not migrated")


def migrate(engine, *, backup_verified=False):
    all_present, present, missing_retry = inspect_schema(engine, allow_legacy_retry=True)
    if present and not missing_retry:
        return
    if all_present and not backup_verified:
        raise RuntimeError("Meeting schema expansion requires verified backup")
    with engine.begin() as connection:
        if missing_retry:
            connection.execute(text("ALTER TABLE meeting_runs ADD COLUMN retry_of VARCHAR(36)"))
        metadata.create_all(connection)
    validate(engine)


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument("--verified-backup-file",type=Path)
    args = parser.parse_args()
    verified = bool(args.verified_backup_file and args.verified_backup_file.is_file() and args.verified_backup_file.stat().st_size)
    if args.verified_backup_file and not verified:
        parser.error("Verified backup file is missing or empty")
    settings = Settings()
    settings.validate_runtime()
    engine = create_engine(settings.database_url.get_secret_value())
    try:
        migrate(engine,backup_verified=verified)
    finally:
        engine.dispose()
