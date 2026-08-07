"""
Миграция: удаление флагов обязательности DoD и финансового эффекта
из справочника типов задач (2026-08-05).

Удаляемые колонки таблицы `task_types`:
    dod_required, financial_value_required

Колонки не используются в индексах, UNIQUE, внешних ключах и CHECK,
поэтому допустим DROP COLUMN (SQLite >= 3.35). Скрипт идемпотентен.
"""
import os
import sqlite3
import sys
from pathlib import Path

DROP_COLUMNS = ["dod_required", "financial_value_required"]

DB_PATH = Path(__file__).resolve().parent.parent / "dmb_backlog.db"


def main():
    db_path = os.environ.get("DMB_DB_PATH", str(DB_PATH))
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(task_types)").fetchall()]
    dropped = [c for c in cols if c in DROP_COLUMNS]

    for col in dropped:
        cur.execute(f"ALTER TABLE task_types DROP COLUMN {col}")

    con.commit()
    con.close()
    print(f"Dropped task_types columns ({len(dropped)}): {dropped or []}")


if __name__ == "__main__":
    sys.exit(main())
