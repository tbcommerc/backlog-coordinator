"""
Миграция: поддержка импорта задач из CSV (2026-08-07).

Что делает (идемпотентно):
  1. Добавляет колонку `external_id` в таблицу `tasks` (если отсутствует).
     Колонку также автоматически добавляет database.ensure_schema() при старте;
     здесь она добавляется для автономного запуска скрипта.
  2. Создаёт уникальный индекс `uq_tasks_external_id` по tasks(external_id)
     (ensure_schema индексы НЕ создаёт).
  3. Создаёт таблицу `task_jira_links` (множественные ссылки на Jira),
     если она ещё не существует (иначе — создаст create_all).
  4. Backfill: переносит ссылки из JSON-колонки tasks.link_jira в
     task_jira_links (двойная запись для обратной совместимости).
  5. Проставляет флаг is_required ('Обязательность') для title/team_id
     в таблице field_labels (если колонка уже существует).

Скрипт не удаляет и не перезаписывает существующие данные.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "dmb_backlog.db"

REQUIRED_IMPORT_FIELDS = {
    "title": "Название задачи",
    "team_id": "Ответственная команда",
}


def main():
    db_path = os.environ.get("DMB_DB_PATH", str(DB_PATH))
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = OFF")
    cur = con.cursor()

    # --- 1. Колонка external_id в tasks ---
    task_cols = [r[1] for r in cur.execute("PRAGMA table_info(tasks)").fetchall()]
    if "external_id" not in task_cols:
        cur.execute("ALTER TABLE tasks ADD COLUMN external_id VARCHAR(100)")
        print("[migrate] Added column tasks.external_id")

    # --- 2. Уникальный индекс по external_id ---
    indexes = [r[1] for r in cur.execute("PRAGMA index_list(tasks)").fetchall()]
    if "uq_tasks_external_id" not in indexes:
        dup = cur.execute(
            "SELECT external_id FROM tasks WHERE external_id IS NOT NULL "
            "GROUP BY external_id HAVING COUNT(*) > 1"
        ).fetchall()
        if not dup:
            cur.execute(
                "CREATE UNIQUE INDEX uq_tasks_external_id ON tasks (external_id)"
            )
            print("[migrate] Created unique index uq_tasks_external_id")
        else:
            print("[migrate] SKIP unique index: duplicates in tasks.external_id: "
                  f"{[d[0] for d in dup]}")

    # --- 3. Таблица task_jira_links ---
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if "task_jira_links" not in tables:
        cur.execute("""
            CREATE TABLE task_jira_links (
                id INTEGER PRIMARY KEY,
                task_id INTEGER NOT NULL,
                url VARCHAR(500) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_task_jira_links_task FOREIGN KEY (task_id)
                    REFERENCES tasks (id)
            )
        """)
        cur.execute("CREATE INDEX ix_task_jira_links_task_id "
                    "ON task_jira_links (task_id)")
        cur.execute("CREATE UNIQUE INDEX uq_task_jira_links_task_url "
                    "ON task_jira_links (task_id, url)")
        print("[migrate] Created table task_jira_links")

    # --- 4. Backfill из tasks.link_jira ---
    rows = cur.execute(
        "SELECT id, link_jira FROM tasks WHERE link_jira IS NOT NULL AND link_jira != 'null'"
    ).fetchall()
    backfilled = 0
    for task_id, raw in rows:
        try:
            urls = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if not isinstance(urls, list):
            continue
        for url in urls:
            if not url or not str(url).strip():
                continue
            cur.execute(
                "INSERT OR IGNORE INTO task_jira_links (task_id, url) VALUES (?, ?)",
                (task_id, str(url).strip()),
            )
            backfilled += cur.rowcount
    if backfilled:
        print(f"[migrate] Backfilled task_jira_links rows: {backfilled}")

    # --- 5. is_required в field_labels ---
    fl_cols = [r[1] for r in cur.execute("PRAGMA table_info(field_labels)").fetchall()]
    if "is_required" in fl_cols and "field_labels" in tables:
        for key, label in REQUIRED_IMPORT_FIELDS.items():
            cur.execute(
                "UPDATE field_labels SET is_required = 1 WHERE key = ?",
                (key,),
            )
            if cur.rowcount:
                print(f"[migrate] Set field_labels.is_required=1 for '{key}' ({label})")

    con.commit()
    con.close()
    print("[migrate] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
