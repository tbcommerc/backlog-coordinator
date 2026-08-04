"""
Миграция: удаление атрибутов задач, убранных из продукта (2026-08-04).

Удаляемые колонки таблицы `tasks`:
    ice_score, ice_impact, ice_confidence, ice_ease,
    what_if, dod, status_comment,
    responsible_po_id, business_analyst_id, it_product_lead_id,
    key_project, is_from_leadership, is_regular

Также удаляются:
  - строки field_labels для этих ключей;
  - стандартный отчёт "Статус по ключевым проектам" (key='projects'),
    фильтрующийся по key_project.

SQLite не позволяет DROP COLUMN для колонок с FK/индексами,
поэтому таблица tasks пересоздаётся. Скрипт идемпотентен.
"""
import os
import sqlite3
import sys
from pathlib import Path

DROP_TASK_COLUMNS = {
    "ice_score", "ice_impact", "ice_confidence", "ice_ease",
    "what_if", "dod", "status_comment",
    "responsible_po_id", "business_analyst_id", "it_product_lead_id",
    "key_project", "is_from_leadership", "is_regular",
}

FIELD_LABEL_KEYS = sorted(DROP_TASK_COLUMNS)

DB_PATH = Path(__file__).resolve().parent.parent / "dmb_backlog.db"

INDEX_COLUMNS = {
    "ix_tasks_team_id": "team_id",
    "ix_tasks_is_deleted": "is_deleted",
    "ix_tasks_id": "id",
}


def main():
    db_path = os.environ.get("DMB_DB_PATH", str(DB_PATH))
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = OFF")
    cur = con.cursor()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(tasks)").fetchall()]
    to_drop = [c for c in cols if c in DROP_TASK_COLUMNS]

    if to_drop:
        keep = [c for c in cols if c not in DROP_TASK_COLUMNS]
        quoted = ",".join(f'"{c}"' for c in keep)
        new_cols = ",\n  ".join(f'"{c}"' for c in keep)
        cur.execute("DROP TABLE IF EXISTS tasks_new")
        cur.execute(f"CREATE TABLE tasks_new (\n  {new_cols}\n)")
        cur.execute(f"INSERT INTO tasks_new ({quoted}) SELECT {quoted} FROM tasks")
        cur.execute("DROP TABLE tasks")
        cur.execute("ALTER TABLE tasks_new RENAME TO tasks")
        for index_name, column in INDEX_COLUMNS.items():
            if column in keep:
                cur.execute(f"CREATE INDEX {index_name} ON tasks ({column})")

    placeholders = ",".join("?" for _ in FIELD_LABEL_KEYS)
    cur.execute(
        f"DELETE FROM field_labels WHERE key IN ({placeholders})",
        FIELD_LABEL_KEYS,
    )
    fl_deleted = cur.rowcount
    cur.execute("DELETE FROM reports WHERE key = 'projects'")
    rep_deleted = cur.rowcount

    con.commit()
    con.close()
    print(f"Dropped task columns ({len(to_drop)}): {to_drop or []}")
    print(f"Deleted field_labels rows: {fl_deleted}")
    print(f"Deleted report rows: {rep_deleted}")


if __name__ == "__main__":
    sys.exit(main())
