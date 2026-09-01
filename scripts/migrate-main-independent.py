"""Migrate the explicitly allowed independent main-database tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime, MetaData, Table, create_engine, func, select


ALLOWED_TABLES = ("display_settings",)


def normalized(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.isoformat(sep=" ")
    return value


def rows_hash(columns: list[str], rows: list[tuple[Any, ...]]) -> str:
    digest = hashlib.sha256()
    digest.update(json.dumps(columns, ensure_ascii=False).encode("utf-8"))
    for row in rows:
        digest.update(
            json.dumps(
                [normalized(value) for value in row],
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def column_diagnostics(
    columns: list[str], source_rows: list[tuple[Any, ...]], target_rows: list[tuple[Any, ...]]
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for index, column in enumerate(columns):
        source_values = [(normalized(row[index]),) for row in source_rows]
        target_values = [(normalized(row[index]),) for row in target_rows]
        result[column] = {
            "source_hash": rows_hash([column], source_values),
            "target_hash": rows_hash([column], target_values),
            "source_types": sorted({type(row[index]).__name__ for row in source_rows}),
            "target_types": sorted({type(row[index]).__name__ for row in target_rows}),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite_database", type=Path)
    parser.add_argument("postgresql_url")
    args = parser.parse_args()

    source_uri = (
        f"file:{args.sqlite_database.resolve(strict=True).as_posix()}?mode=ro&immutable=1"
    )
    engine = create_engine(args.postgresql_url, future=True)
    metadata = MetaData()
    results: dict[str, dict[str, Any]] = {}

    with sqlite3.connect(source_uri, uri=True) as source, engine.begin() as target:
        source.execute("PRAGMA query_only = ON")
        for table_name in ALLOWED_TABLES:
            table = Table(table_name, metadata, autoload_with=engine)
            columns = [column.name for column in table.columns]
            source_columns = [
                row[1] for row in source.execute(f'PRAGMA table_info("{table_name}")')
            ]
            if source_columns != columns:
                raise RuntimeError(
                    f"Column mismatch for {table_name}: {source_columns} != {columns}"
                )
            if target.scalar(select(func.count()).select_from(table)):
                raise RuntimeError(f"Target table is not empty: {table_name}")

            order = ", ".join(f'"{column}"' for column in columns)
            raw_rows = source.execute(
                f'SELECT * FROM "{table_name}" ORDER BY {order}'
            ).fetchall()
            converted_rows: list[tuple[Any, ...]] = []
            for raw_row in raw_rows:
                converted = []
                for column, value in zip(table.columns, raw_row, strict=True):
                    if value is not None and isinstance(column.type, DateTime):
                        value = datetime.fromisoformat(value)
                    converted.append(value)
                converted_rows.append(tuple(converted))

            if converted_rows:
                target.execute(
                    table.insert(),
                    [dict(zip(columns, row, strict=True)) for row in converted_rows],
                )
            target_rows = target.execute(select(table).order_by(*table.columns)).all()
            source_hash = rows_hash(columns, converted_rows)
            target_hash = rows_hash(columns, [tuple(row) for row in target_rows])
            if len(converted_rows) != len(target_rows) or source_hash != target_hash:
                diagnostics = column_diagnostics(
                    columns, converted_rows, [tuple(row) for row in target_rows]
                )
                raise RuntimeError(
                    f"Verification failed for {table_name}: "
                    + json.dumps(diagnostics, ensure_ascii=False)
                )
            results[table_name] = {"rows": len(target_rows), "sha256": target_hash}

    print(json.dumps({"status": "ok", "tables": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
