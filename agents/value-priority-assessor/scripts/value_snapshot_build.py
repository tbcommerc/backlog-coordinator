"""Собирает зашитый слепок исторических Value.

Запускается не агентом, а эксплуатацией — с той периодичностью, с какой
Координатор бэклога отдаёт свежую выгрузку. Результат кладётся в
`data/value-snapshot/snapshot.json` и едет вместе с агентом.

    python scripts/value_snapshot_build.py --from-db
    python scripts/value_snapshot_build.py --from-json data/backlog_seed.json
    python scripts/value_snapshot_build.py --from-db --version 2026-09-01

Что попадает в слепок:

* задачи, где Value заполнил **человек** — они и есть обучающая выборка;
* `max_value_mln` для шкалы фактора F1 — максимум по **всем** задачам с
  посчитанным Value, а не только по заполненным вручную: шкала должна
  соответствовать всему бэклогу, иначе баллы поедут.

Чего в слепке нет: приоритетов, трудозатрат, заказчиков, комментариев. Слепок —
не копия бэклога, а ровно то, без чего не работают аналогии и шкала.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from value_priority_assessor.core.loader import DEFAULT_SEED  # noqa: E402
from value_priority_assessor.core.normalise import clean_text, parse_number  # noqa: E402
from value_priority_assessor.snapshot import SNAPSHOT_PATH, write_snapshot  # noqa: E402

COLUMN_KEY = "ID задачи"
COLUMN_TITLE = "Наименование задачи / краткая постановка"
COLUMN_TEAM = "Ответственная команда / кластер"
COLUMN_PROJECT = "Проект"
COLUMN_VALUE = "Фин. эффект (value в млн руб.)"
COLUMN_TYPE = "Тип задачи"


def from_db() -> tuple[list[dict], float, int]:
    from sqlalchemy import select

    from value_priority_assessor.core.db import session_scope
    from value_priority_assessor.core.models import Task

    with session_scope() as session:
        rows = session.scalars(select(Task).order_by(Task.task_key)).all()
        entries = [
            {
                "task_key": t.task_key,
                "title": t.title,
                "team": t.team,
                "project": t.project,
                "task_type": t.task_type,
                "description": t.comment,
                "value_mln": float(t.value_manual_mln),
            }
            for t in rows
            if t.value_manual_mln is not None and t.title
        ]
        # Шкала F1 строится по всем посчитанным значениям, а не только ручным.
        computed = [t.value_internal_mln or 0.0 for t in rows]
        return entries, max(computed, default=0.0), len(rows)


def from_json(path: Path) -> tuple[list[dict], float, int]:
    """Сборка прямо из выгрузки, без поднятия базы.

    Максимум для шкалы в этом режиме берётся по ручным значениям: расчётных
    ещё нет. Это занижает шкалу, поэтому режим — запасной, для случая, когда
    базу поднять негде.
    """
    rows = json.loads(path.read_text(encoding="utf-8"))
    entries = []
    for row in rows:
        value = parse_number(row.get(COLUMN_VALUE))
        title = clean_text(row.get(COLUMN_TITLE))
        if value is None or not title:
            continue
        entries.append(
            {
                "task_key": clean_text(row.get(COLUMN_KEY)) or "",
                "title": title,
                "team": clean_text(row.get(COLUMN_TEAM)),
                "project": clean_text(row.get(COLUMN_PROJECT)),
                "task_type": clean_text(row.get(COLUMN_TYPE)),
                "value_mln": float(value),
            }
        )
    # Задвоенные ID в выгрузке встречаются; в слепке нужен один экземпляр.
    unique = {e["task_key"] or e["title"]: e for e in entries}
    entries = sorted(unique.values(), key=lambda e: e["task_key"])
    return entries, max((e["value_mln"] for e in entries), default=0.0), len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--from-db", action="store_true", help="из базы (рекомендуется)")
    source.add_argument("--from-json", type=Path, nargs="?", const=DEFAULT_SEED,
                        help="из выгрузки JSON, без базы")
    parser.add_argument("--version", help="версия слепка; по умолчанию дата сборки")
    parser.add_argument("--out", type=Path, default=SNAPSHOT_PATH)
    args = parser.parse_args()

    entries, max_value, source_rows = (
        from_db() if args.from_db else from_json(args.from_json)
    )

    if not entries:
        print("В источнике нет ни одного человеческого Value — слепок не собран.")
        return 1

    snapshot = write_snapshot(
        entries=entries,
        max_value_mln=max_value,
        source_rows=source_rows,
        path=args.out,
        version=args.version,
    )
    print(json.dumps({"ok": True, "path": str(args.out), **snapshot.describe()},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
