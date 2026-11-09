"""Expand/copy/verify owned history. Never copy or mutate reference records.

Target schema is migrated separately. URLs are passed in process environment,
not argv. Existing matching history is replayed; mismatching targets are refused.
"""
import argparse
import hashlib
import json
import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, inspect, select, text, func
from .core.models import Base

ALLOWED = ("task", "llm_call", "agent_request", "attribution_run", "factor_assessment", "priority_history")


def normalize(value):
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    return value


def digest(rows):
    return hashlib.sha256(json.dumps(normalize(rows), sort_keys=True, ensure_ascii=False,
        allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def rows_for(connection, name):
    table = Base.metadata.tables[name]
    return [dict(row) for row in connection.execute(select(table).order_by(*table.primary_key.columns)).mappings()]


def references(connection, present):
    return rows_for(connection, "reference") if "reference" in present else []


def require_matching_references(source, target):
    if digest(source) != digest(target):
        raise RuntimeError("protected_reference_mismatch: no reference records are copied or changed")


def migrate(source_engine, target_engine, *, apply=False, max_rows=100000):
    with source_engine.connect() as source, target_engine.begin() as target:
        if source_engine.dialect.name == "sqlite":
            source.exec_driver_sql("BEGIN")
        source_tables = set(inspect(source).get_table_names())
        target_tables = set(inspect(target).get_table_names())
        if not {"task", "llm_call"} <= source_tables:
            raise RuntimeError("unexpected_assessor_source_schema")
        if source_tables - (set(ALLOWED) | {"reference", "alembic_version", "sqlite_sequence"}):
            raise RuntimeError("unexpected_assessor_source_tables")
        if target_tables - (set(ALLOWED) | {"reference", "alembic_version", "agent_tool_grants", "agent_tool_receipts"}):
            raise RuntimeError("unexpected_assessor_target_tables")
        names = [table.name for table in Base.metadata.sorted_tables if table.name in ALLOWED and table.name in source_tables]
        if not set(names) <= target_tables:
            raise RuntimeError("target_requires_explicit_schema_migration")
        for name in names:
            actual = {col["name"] for col in inspect(source).get_columns(name)}
            if actual != set(Base.metadata.tables[name].columns.keys()):
                raise RuntimeError("unexpected_assessor_source_columns")
        require_matching_references(references(source, source_tables), references(target, target_tables))
        if target_engine.dialect.name == "postgresql":
            target.execute(text("SELECT pg_advisory_xact_lock(91002026)"))
        if max_rows <= 0 or sum(source.scalar(select(func.count()).select_from(Base.metadata.tables[name])) for name in names) > max_rows:
            raise RuntimeError("migration_row_budget_exceeded")
        if sum(target.scalar(select(func.count()).select_from(Base.metadata.tables[name])) for name in names) > max_rows:
            raise RuntimeError("target_row_budget_exceeded")
        data = {name: rows_for(source, name) for name in names}
        expected = {name: {"rows": len(rows), "sha256": digest(rows)} for name, rows in data.items()}
        old = {name: rows_for(target, name) for name in names}
        if any(old.values()):
            if any(digest(old[name]) != expected[name]["sha256"] for name in names):
                raise RuntimeError("nonempty_target_history_conflict")
            return {"tables": expected, "applied": False, "replayed": True, "protected_reference_writes": 0}
        if not apply:
            return {"tables": expected, "applied": False, "replayed": False, "protected_reference_writes": 0}
        for name in names:
            if data[name]:
                target.execute(Base.metadata.tables[name].insert(), data[name])
        for name in names:
            actual = rows_for(target, name)
            if len(actual) != expected[name]["rows"] or digest(actual) != expected[name]["sha256"]:
                raise RuntimeError("history_verification_failed")
            table = Base.metadata.tables[name]
            if target_engine.dialect.name == "postgresql" and data[name] and "id" in table.c:
                sequence = target.scalar(text("SELECT pg_get_serial_sequence(:name, 'id')"), {"name": name})
                if sequence:
                    target.execute(text("SELECT setval(CAST(:sequence AS regclass), :last_id, true)"),
                                   {"sequence": sequence, "last_id": max(row["id"] for row in data[name])})
        return {"tables": expected, "applied": True, "replayed": False, "protected_reference_writes": 0}


def readonly_sqlite(path):
    path = Path(path).resolve(strict=True)
    return create_engine("sqlite://", creator=lambda: sqlite3.connect(path.as_uri()+"?mode=ro", uri=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--verified-backup-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    url = os.environ.get("PRIORITISER_MIGRATION_TARGET_URL", "")
    if not url.startswith("postgresql+psycopg://"):
        parser.error("PRIORITISER_MIGRATION_TARGET_URL must use PostgreSQL/psycopg")
    source, target = readonly_sqlite(args.source), create_engine(url)
    try:
        if args.apply:
            if not args.verified_backup_file or not args.verified_backup_file.is_file():
                raise RuntimeError("verified_backup_required")
            backup = readonly_sqlite(args.verified_backup_file)
            try:
                # Content check, not just a filename/size assertion.
                original = migrate(source, target)
                saved = migrate(backup, target)
                if original["tables"] != saved["tables"]:
                    raise RuntimeError("backup_content_mismatch")
            finally:
                backup.dispose()
        report = migrate(source, target, apply=args.apply)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
        print(json.dumps({"applied": report["applied"], "replayed": report["replayed"],
                          "row_counts": {name: entry["rows"] for name, entry in report["tables"].items()}}))
    except Exception as error:
        # Database exceptions can contain full SQL parameters: never emit them.
        safe = str(error).split(":", 1)[0] if type(error) is RuntimeError else type(error).__name__
        print(json.dumps({"status": "failed", "code": safe}))
        raise SystemExit(1) from None
    finally:
        source.dispose()
        target.dispose()


if __name__ == "__main__":
    main()
