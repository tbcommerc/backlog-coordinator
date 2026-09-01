"""Atomically replace the PostgreSQL main database with the legacy SQLite data.

The source is always opened read-only.  The target transaction is committed only
after row counts, common-column hashes and every PostgreSQL foreign key pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    MetaData,
    Numeric,
    Table,
    create_engine,
    inspect,
    text,
)


SKIPPED_TARGET_TABLES = {"alembic_version"}
SOURCE_COLUMN_MAPPINGS = {"timeline_events": {"created_by": "creator_id"}}
NULL_BACKFILLS = {
    "notifications": {
        "category": lambda values: values.get("type") or "system",
        "title": lambda values: values.get("message") or "Уведомление",
    }
}
TARGET_ONLY_BACKFILLS = {
    "requirement_requests": {"version": lambda values: 0},
}
LEGACY_FOREIGN_KEYS = {
    "audit_log": {"user_id": ("users", "id")},
    "task_comments": {"user_id": ("users", "id")},
    "task_history": {"changed_by": ("users", "id")},
    "tasks": {
        "channel_id": ("channels", "id"),
        "created_by": ("users", "id"),
        "deadline_id": ("deadlines", "id"),
        "status_id": ("statuses", "id"),
        "task_type_id": ("task_types", "id"),
    },
}


def quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def normalized(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.isoformat(sep=" ", timespec="microseconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        return {"bytes_sha256": hashlib.sha256(value).hexdigest(), "length": len(value)}
    return value


def canonical_row(row: tuple[Any, ...]) -> str:
    return json.dumps(
        [normalized(value) for value in row],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def rows_hash(columns: list[str], rows: list[tuple[Any, ...]]) -> str:
    digest = hashlib.sha256(
        json.dumps(columns, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    for encoded in sorted(canonical_row(row) for row in rows):
        digest.update(encoded.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def convert_value(column: Any, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(column.type, Boolean):
        return bool(value)
    if isinstance(column.type, DateTime):
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if isinstance(column.type, Date):
        if isinstance(value, date):
            return value
        return date.fromisoformat(str(value))
    if isinstance(column.type, JSON) and isinstance(value, str):
        return json.loads(value)
    if isinstance(column.type, Numeric) and not isinstance(column.type, Float):
        converted = Decimal(str(value))
        if column.type.scale is not None:
            converted = converted.quantize(Decimal(1).scaleb(-column.type.scale))
        return converted
    return value


def sqlite_tables(source: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in source.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def source_columns(source: sqlite3.Connection, table_name: str) -> list[str]:
    return [
        row[1]
        for row in source.execute(f"PRAGMA table_info({quoted(table_name)})")
    ]


def verify_foreign_keys(connection: Any, inspector: Any, tables: list[str]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for table_name in tables:
        for foreign_key in inspector.get_foreign_keys(table_name):
            local = foreign_key.get("constrained_columns") or []
            remote = foreign_key.get("referred_columns") or []
            remote_table = foreign_key.get("referred_table")
            if not local or not remote or not remote_table:
                continue
            join = " AND ".join(
                f"child.{quoted(left)} = parent.{quoted(right)}"
                for left, right in zip(local, remote, strict=True)
            )
            populated = " AND ".join(f"child.{quoted(column)} IS NOT NULL" for column in local)
            missing = f"parent.{quoted(remote[0])} IS NULL"
            statement = text(
                f"SELECT count(*) FROM {quoted(table_name)} AS child "
                f"LEFT JOIN {quoted(remote_table)} AS parent ON {join} "
                f"WHERE {populated} AND {missing}"
            )
            orphan_count = int(connection.scalar(statement) or 0)
            check = {
                "table": table_name,
                "constraint": foreign_key.get("name"),
                "references": remote_table,
                "orphans": orphan_count,
            }
            checks.append(check)
            if orphan_count:
                raise RuntimeError(f"Foreign-key verification failed: {check}")
    return checks


def inspect_source_foreign_keys(
    source: sqlite3.Connection, inspector: Any, source_table_names: list[str]
) -> list[dict[str, Any]]:
    available = set(source_table_names)
    checks: list[dict[str, Any]] = []
    for table_name in source_table_names:
        table_columns = set(source_columns(source, table_name))
        for foreign_key in inspector.get_foreign_keys(table_name):
            local = foreign_key.get("constrained_columns") or []
            remote = foreign_key.get("referred_columns") or []
            remote_table = foreign_key.get("referred_table")
            if (
                not local
                or not remote
                or remote_table not in available
                or not set(local).issubset(table_columns)
            ):
                continue
            join = " AND ".join(
                f"child.{quoted(left)} = parent.{quoted(right)}"
                for left, right in zip(local, remote, strict=True)
            )
            populated = " AND ".join(f"child.{quoted(column)} IS NOT NULL" for column in local)
            missing = f"parent.{quoted(remote[0])} IS NULL"
            count = source.execute(
                f"SELECT count(*) FROM {quoted(table_name)} AS child "
                f"LEFT JOIN {quoted(remote_table)} AS parent ON {join} "
                f"WHERE {populated} AND {missing}"
            ).fetchone()[0]
            if count:
                checks.append(
                    {
                        "table": table_name,
                        "columns": local,
                        "references": remote_table,
                        "orphans": count,
                    }
                )
    return checks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite_database", type=Path)
    parser.add_argument("postgresql_url")
    parser.add_argument("output", type=Path)
    parser.add_argument("--replace-target", action="store_true")
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args()

    source_path = args.sqlite_database.resolve(strict=True)
    source_uri = f"file:{source_path.as_posix()}?mode=ro&immutable=1"
    engine = create_engine(args.postgresql_url, future=True)
    metadata = MetaData()
    metadata.reflect(bind=engine)
    target_tables = sorted(set(metadata.tables) - SKIPPED_TARGET_TABLES)

    with sqlite3.connect(source_uri, uri=True) as source:
        source.execute("PRAGMA query_only = ON")
        if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity_check failed")
        source_table_names = sqlite_tables(source)
        missing_tables = sorted(set(source_table_names) - set(target_tables))
        if missing_tables:
            raise RuntimeError(f"Source tables absent from PostgreSQL: {missing_tables}")

        schema_report: dict[str, Any] = {}
        for table_name in source_table_names:
            src_columns = source_columns(source, table_name)
            target_table = metadata.tables[table_name]
            dst_columns = [column.name for column in target_table.columns]
            mappings = SOURCE_COLUMN_MAPPINGS.get(table_name, {})
            absent = sorted(set(src_columns) - set(dst_columns) - set(mappings))
            if absent and not args.inspect_only:
                raise RuntimeError(f"Source columns absent from {table_name}: {absent}")
            schema_report[table_name] = {
                "source_columns": src_columns,
                "source_only_columns": absent,
                "mapped_columns": mappings,
                "target_only_columns": [name for name in dst_columns if name not in src_columns],
                "source_rows": source.execute(
                    f"SELECT count(*) FROM {quoted(table_name)}"
                ).fetchone()[0],
                "nulls_in_nonnullable": {
                    column.name: source.execute(
                        f"SELECT count(*) FROM {quoted(table_name)} "
                        f"WHERE {quoted(column.name)} IS NULL"
                    ).fetchone()[0]
                    for column in target_table.columns
                    if not column.nullable
                    and column.name in src_columns
                    and source.execute(
                        f"SELECT count(*) FROM {quoted(table_name)} "
                        f"WHERE {quoted(column.name)} IS NULL"
                    ).fetchone()[0]
                },
            }

        if args.inspect_only:
            print(json.dumps({
                "status": "ok",
                "schema": schema_report,
                "source_foreign_key_orphans": inspect_source_foreign_keys(
                    source, inspect(engine), source_table_names
                ),
            }, ensure_ascii=False, indent=2))
            return
        if not args.replace_target:
            raise RuntimeError("Refusing to replace PostgreSQL without --replace-target")

        results: dict[str, Any] = {}
        inspector = inspect(engine)
        referenced_values = {
            (remote_table, remote_column): {
                row[0]
                for row in source.execute(
                    f"SELECT {quoted(remote_column)} FROM {quoted(remote_table)}"
                )
            }
            for mappings in LEGACY_FOREIGN_KEYS.values()
            for remote_table, remote_column in mappings.values()
        }
        with engine.begin() as target:
            target.execute(text("SET LOCAL session_replication_role = replica"))
            truncate_list = ", ".join(quoted(name) for name in target_tables)
            if truncate_list:
                target.execute(text(f"TRUNCATE TABLE {truncate_list} RESTART IDENTITY CASCADE"))

            for table_name in source_table_names:
                table = metadata.tables[table_name]
                raw_columns = source_columns(source, table_name)
                mappings = SOURCE_COLUMN_MAPPINGS.get(table_name, {})
                target_only_backfills = TARGET_ONLY_BACKFILLS.get(table_name, {})
                columns = [name for name in raw_columns if name not in mappings]
                insert_columns = columns + list(target_only_backfills)
                if table_name in LEGACY_FOREIGN_KEYS:
                    insert_columns.append("legacy_references")
                verification_columns = columns + (
                    ["legacy_references"] if table_name in LEGACY_FOREIGN_KEYS else []
                )
                selected_raw = ", ".join(quoted(name) for name in raw_columns)
                selected = ", ".join(quoted(name) for name in columns)
                raw_rows = source.execute(
                    f"SELECT {selected_raw} FROM {quoted(table_name)}"
                ).fetchall()
                converted_rows = []
                for raw_row in raw_rows:
                    values = dict(zip(raw_columns, raw_row, strict=True))
                    for old_name, new_name in mappings.items():
                        old_value = values.pop(old_name)
                        new_value = values.get(new_name)
                        if old_value is not None and new_value is not None and old_value != new_value:
                            raise RuntimeError(
                                f"Conflicting legacy values in {table_name}: "
                                f"{old_name}={old_value}, {new_name}={new_value}"
                            )
                        if new_value is None:
                            values[new_name] = old_value
                    for column_name, factory in NULL_BACKFILLS.get(table_name, {}).items():
                        if values.get(column_name) is None:
                            values[column_name] = factory(values)
                    for column_name, factory in target_only_backfills.items():
                        values[column_name] = factory(values)
                    legacy_references = {}
                    for column_name, remote in LEGACY_FOREIGN_KEYS.get(table_name, {}).items():
                        value = values.get(column_name)
                        if value is not None and value not in referenced_values[remote]:
                            legacy_references[column_name] = value
                            values[column_name] = None
                    if table_name in LEGACY_FOREIGN_KEYS:
                        values["legacy_references"] = legacy_references or None
                    converted_rows.append(
                        tuple(convert_value(table.c[name], values[name]) for name in insert_columns)
                    )
                if converted_rows:
                    target.execute(
                        table.insert(),
                        [dict(zip(insert_columns, row, strict=True)) for row in converted_rows],
                    )

                verification_rows = [
                    tuple(row[insert_columns.index(name)] for name in verification_columns)
                    for row in converted_rows
                ]
                selected_verification = ", ".join(quoted(name) for name in verification_columns)
                target_rows = [
                    tuple(row)
                    for row in target.execute(
                        text(f"SELECT {selected_verification} FROM {quoted(table_name)}")
                    ).all()
                ]
                source_hash = rows_hash(verification_columns, verification_rows)
                target_hash = rows_hash(verification_columns, target_rows)
                if len(converted_rows) != len(target_rows) or source_hash != target_hash:
                    mismatched_columns = []
                    for index, column_name in enumerate(verification_columns):
                        source_column_hash = rows_hash(
                            [column_name], [(row[index],) for row in verification_rows]
                        )
                        target_column_hash = rows_hash(
                            [column_name], [(row[index],) for row in target_rows]
                        )
                        if source_column_hash != target_column_hash:
                            mismatched_columns.append(column_name)
                    raise RuntimeError(
                        f"Verification failed for {table_name}: "
                        f"source={len(converted_rows)}/{source_hash}, "
                        f"target={len(target_rows)}/{target_hash}, "
                        f"columns={mismatched_columns}"
                    )
                results[table_name] = {
                    "rows": len(target_rows),
                    "sha256": target_hash,
                    "verified_columns": verification_columns,
                    "target_only_columns": schema_report[table_name]["target_only_columns"],
                    "mapped_columns": mappings,
                    "null_backfills": sorted(NULL_BACKFILLS.get(table_name, {})),
                    "target_only_backfills": sorted(target_only_backfills),
                    "legacy_references_preserved": sum(
                        1 for row in converted_rows
                        if table_name in LEGACY_FOREIGN_KEYS
                        and row[insert_columns.index("legacy_references")] is not None
                    ),
                }

            for table_name in source_table_names:
                table = metadata.tables[table_name]
                for column in table.primary_key.columns:
                    sequence = target.scalar(
                        text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                        {"table_name": table_name, "column_name": column.name},
                    )
                    if sequence:
                        maximum = target.scalar(
                            text(f"SELECT max({quoted(column.name)}) FROM {quoted(table_name)}")
                        )
                        if maximum is None:
                            target.execute(text("SELECT setval(:sequence, 1, false)"), {"sequence": sequence})
                        else:
                            target.execute(
                                text("SELECT setval(:sequence, :maximum, true)"),
                                {"sequence": sequence, "maximum": maximum},
                            )

            target.execute(text("SET LOCAL session_replication_role = origin"))
            foreign_keys = verify_foreign_keys(target, inspector, source_table_names)

            for table_name in sorted(set(target_tables) - set(source_table_names)):
                count = int(target.scalar(text(f"SELECT count(*) FROM {quoted(table_name)}")) or 0)
                if count:
                    raise RuntimeError(f"Target-only table is unexpectedly non-empty: {table_name}")

        report = {
            "status": "ok",
            "source": str(source_path),
            "source_integrity": "ok",
            "tables": results,
            "source_tables": len(source_table_names),
            "source_rows": sum(item["rows"] for item in results.values()),
            "foreign_keys_checked": len(foreign_keys),
            "foreign_key_orphans": sum(item["orphans"] for item in foreign_keys),
            "target_only_tables": sorted(set(target_tables) - set(source_table_names)),
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
