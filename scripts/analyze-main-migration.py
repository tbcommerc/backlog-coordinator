"""Read-only dependency audit for migrating the legacy main SQLite database."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, inspect


PROTECTED_TABLES = {
    "business_customers",
    "channels",
    "competency_cost_history",
    "deadlines",
    "departments",
    "dictionary_items",
    "field_labels",
    "priorities",
    "project_statuses",
    "refresh_sessions",
    "roles",
    "statuses",
    "task_types",
    "team_competency_resources",
    "team_types",
    "teams",
    "user_notification_preferences",
    "users",
}


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("postgresql_url")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    resolved = args.database.resolve(strict=True)
    uri = f"file:{resolved.as_posix()}?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        counts = {
            table: connection.execute(
                f"SELECT count(*) FROM {quote_identifier(table)}"
            ).fetchone()[0]
            for table in tables
        }
    inspector = inspect(create_engine(args.postgresql_url, future=True))
    target_tables = set(inspector.get_table_names())
    dependencies = {
        table: sorted(
            {
                foreign_key["referred_table"]
                for foreign_key in inspector.get_foreign_keys(table)
                if foreign_key.get("referred_table")
            }
        )
        if table in target_tables
        else []
        for table in tables
    }

    blocked_by: dict[str, set[str]] = {
        table: ({table} if table in PROTECTED_TABLES else set()) for table in tables
    }
    changed = True
    while changed:
        changed = False
        for table in tables:
            before = set(blocked_by[table])
            for dependency in dependencies[table]:
                blocked_by[table].update(blocked_by.get(dependency, set()))
            changed = changed or before != blocked_by[table]

    records: list[dict[str, Any]] = []
    for table in tables:
        if not counts[table]:
            status = "empty"
        elif table in PROTECTED_TABLES:
            status = "protected"
        elif blocked_by[table]:
            status = "blocked_by_protected_fk"
        else:
            status = "independent_candidate"
        records.append(
            {
                "table": table,
                "rows": counts[table],
                "status": status,
                "dependencies": dependencies[table],
                "blocked_by": sorted(blocked_by[table]),
            }
        )

    report = {
        "database": str(resolved),
        "total_rows": sum(counts.values()),
        "protected_tables": sorted(PROTECTED_TABLES),
        "tables": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    summary: dict[str, int] = {}
    for record in records:
        summary[record["status"]] = summary.get(record["status"], 0) + record["rows"]
    print(json.dumps({"status": "ok", "rows_by_status": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
