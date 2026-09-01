"""Atomically migrate the legacy AI-agent SQLite session store to PostgreSQL."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import MetaData, Table, create_engine, func, select


TABLES = ("sessions", "message_receipts")


def canonical_hash(columns: list[str], rows: Iterable[Iterable[Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(json.dumps(columns, ensure_ascii=False).encode("utf-8"))
    for row in rows:
        encoded = json.dumps(list(row), ensure_ascii=False, separators=(",", ":"), default=str)
        digest.update(encoded.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def sqlite_rows(database: Path, table: str) -> tuple[list[str], list[tuple[Any, ...]]]:
    uri = f"file:{database.resolve(strict=True).as_posix()}?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        if not columns:
            raise RuntimeError(f"Source table is missing: {table}")
        order = ", ".join(f'"{column}"' for column in columns)
        rows = connection.execute(f'SELECT * FROM "{table}" ORDER BY {order}').fetchall()
    return columns, rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite_database", type=Path)
    parser.add_argument("postgresql_url")
    args = parser.parse_args()

    source: dict[str, tuple[list[str], list[tuple[Any, ...]]]] = {
        table: sqlite_rows(args.sqlite_database, table) for table in TABLES
    }
    engine = create_engine(args.postgresql_url, future=True)
    metadata = MetaData()
    targets = {table: Table(table, metadata, autoload_with=engine) for table in TABLES}

    with engine.begin() as connection:
        existing = {
            table: connection.scalar(select(func.count()).select_from(targets[table]))
            for table in TABLES
        }
        if any(existing.values()):
            raise RuntimeError(f"Target is not empty; migration refused: {existing}")

        for table in TABLES:
            columns, rows = source[table]
            target_columns = [column.name for column in targets[table].columns]
            if columns != target_columns:
                raise RuntimeError(
                    f"Column mismatch for {table}: source={columns}, target={target_columns}"
                )
            if rows:
                connection.execute(
                    targets[table].insert(),
                    [dict(zip(columns, row, strict=True)) for row in rows],
                )

        verification: dict[str, dict[str, Any]] = {}
        for table in TABLES:
            columns, source_rows = source[table]
            target_rows = connection.execute(
                select(targets[table]).order_by(*targets[table].columns)
            ).all()
            source_hash = canonical_hash(columns, source_rows)
            target_hash = canonical_hash(columns, target_rows)
            if len(source_rows) != len(target_rows) or source_hash != target_hash:
                raise RuntimeError(f"Verification failed for {table}")
            verification[table] = {
                "rows": len(source_rows),
                "sha256": source_hash,
            }

    print(json.dumps({"status": "ok", "tables": verification}, ensure_ascii=False))


if __name__ == "__main__":
    main()
