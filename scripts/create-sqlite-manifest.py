"""Create a deterministic, read-only integrity manifest for a SQLite database."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def encode_value(value: Any) -> bytes:
    if value is None:
        return b"null:"
    if isinstance(value, bytes):
        return b"bytes:" + value.hex().encode("ascii")
    return f"{type(value).__name__}:".encode("utf-8") + str(value).encode("utf-8")


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def table_manifest(connection: sqlite3.Connection, table: str) -> dict[str, Any]:
    quoted_table = quote_identifier(table)
    columns = connection.execute(f"PRAGMA table_info({quoted_table})").fetchall()
    column_names = [column[1] for column in columns]
    primary_key = [column[1] for column in sorted(columns, key=lambda item: item[5]) if column[5]]
    order_columns = primary_key or column_names
    order_clause = ", ".join(quote_identifier(column) for column in order_columns)
    query = f"SELECT * FROM {quoted_table}"
    if order_clause:
        query += f" ORDER BY {order_clause}"

    digest = hashlib.sha256()
    digest.update(json.dumps(column_names, ensure_ascii=False).encode("utf-8"))
    row_count = 0
    for row in connection.execute(query):
        row_count += 1
        for value in row:
            encoded = encode_value(value)
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)

    return {
        "columns": column_names,
        "primary_key": primary_key,
        "row_count": row_count,
        "sha256": digest.hexdigest(),
    }


def build_manifest(database_path: Path) -> dict[str, Any]:
    resolved = database_path.resolve(strict=True)
    uri = f"file:{resolved.as_posix()}?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        tables = {name: table_manifest(connection, name) for name in table_names}

    file_digest = hashlib.sha256()
    with resolved.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            file_digest.update(chunk)

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "database": str(resolved),
        "file_size": resolved.stat().st_size,
        "file_sha256": file_digest.hexdigest(),
        "integrity_check": integrity,
        "table_count": len(tables),
        "total_rows": sum(table["row_count"] for table in tables.values()),
        "tables": tables,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    manifest = build_manifest(args.database)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "database": manifest["database"],
                "integrity_check": manifest["integrity_check"],
                "table_count": manifest["table_count"],
                "total_rows": manifest["total_rows"],
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
