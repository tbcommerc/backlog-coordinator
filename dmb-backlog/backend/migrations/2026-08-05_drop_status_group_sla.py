"""
Миграция: удаление группы и SLA из справочника статусов задач (2026-08-05).

Удаляемые колонки таблицы `statuses`:
    group, sla_hours

Колонки не используются в индексах, UNIQUE, внешних ключах и CHECK,
поэтому допустим DROP COLUMN (SQLite >= 3.35). Скрипт идемпотентен.
"""
import os
import sqlite3
import sys
from pathlib import Path

DROP_COLUMNS = ["group", "sla_hours"]

DB_PATH = Path(__file__).resolve().parent.parent / "dmb_backlog.db"


def main():
    db_path = os.environ.get("DMB_DB_PATH", str(DB_PATH))
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(statuses)").fetchall()]
    dropped = [c for c in cols if c in DROP_COLUMNS]

    for col in dropped:
        cur.execute(f'ALTER TABLE statuses DROP COLUMN "{col}"')

    con.commit()
    con.close()
    print(f"Dropped statuses columns ({len(dropped)}): {dropped or []}")


if __name__ == "__main__":
    sys.exit(main())
