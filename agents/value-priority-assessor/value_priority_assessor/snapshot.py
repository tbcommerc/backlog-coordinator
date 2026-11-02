"""Зашитый слепок исторических Value.

Агент, встроенный в Координатор бэклога, работает без доступа к базе: атрибуты
одной задачи приходят в запросе, остального бэклога он не видит. Но две вещи
расчёта опираются именно на остальной бэклог:

* **аналогии** — основной метод оценки Value: на 192 задачах с известным ответом
  он попадает в двукратную окрестность в 67% случаев против 14% у формулы;
* **шкала фактора F1** — Value нормализуется логарифмом относительно максимума
  по бэклогу, иначе задача получила бы балл в другой шкале, чем соседи.

Поэтому обе величины поставляются вместе с агентом как версионируемый артефакт:
задачи с человеческим Value и максимум для шкалы. Координатор обновляет его с
согласованной периодичностью — тем же путём, что и закрытый пакет знаний.

**Что это стоит.** Между обновлениями слепок стареет: Value, заполненные людьми
после последней выгрузки, агент не увидит. Версия слепка возвращается в каждом
ответе (`audit.snapshot_version`), поэтому по любой выданной цифре видно, на
какой базе она получена.

**Почему максимум фиксируется, а не пересчитывается.** Если `max_value_mln`
менялся бы от запроса к запросу, приоритет задачи менялся бы без изменения самой
задачи — требование «те же данные, та же цифра» нарушилось бы незаметно.
Максимум привязан к версии слепка и входит в ключ кэша.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from value_priority_assessor.config import DATA_DIR

SNAPSHOT_DIR = DATA_DIR / "value-snapshot"
SNAPSHOT_PATH = SNAPSHOT_DIR / "snapshot.json"


class SnapshotError(RuntimeError):
    """Слепок отсутствует или испорчен."""


@dataclass
class ValueSnapshot:
    """Слепок исторических Value, поставляемый вместе с агентом."""

    version: str
    built_at: str
    source_rows: int
    max_value_mln: float
    entries: list[dict[str, Any]] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.entries)

    @property
    def available(self) -> bool:
        return bool(self.entries)

    def describe(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "built_at": self.built_at,
            "entries": self.size,
            "source_rows": self.source_rows,
            "max_value_mln": self.max_value_mln,
        }

    @classmethod
    def empty(cls) -> "ValueSnapshot":
        """Пустой слепок: расчёт откатится на формулу и скажет об этом.

        Отсутствие слепка — рабочее состояние, а не авария: на новой установке
        его ещё нет. Но оценка тогда заметно хуже, поэтому в ответ уходит
        предупреждение, а не тишина.
        """
        return cls(version="none", built_at="", source_rows=0, max_value_mln=0.0, entries=[])


def load_snapshot(path: Path | None = None) -> ValueSnapshot:
    """Читает слепок с диска. Отсутствие файла — не ошибка, а пустой слепок."""
    path = path or SNAPSHOT_PATH
    if not path.exists():
        return ValueSnapshot.empty()

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SnapshotError(f"Слепок {path} испорчен: {exc}") from exc

    entries = payload.get("entries") or []
    for entry in entries:
        if "title" not in entry or "value_mln" not in entry:
            raise SnapshotError(
                f"Слепок {path}: запись без обязательных полей title/value_mln — {entry!r}"
            )

    return ValueSnapshot(
        version=str(payload.get("version") or "none"),
        built_at=str(payload.get("built_at") or ""),
        source_rows=int(payload.get("source_rows") or 0),
        max_value_mln=float(payload.get("max_value_mln") or 0.0),
        entries=entries,
    )


@lru_cache(maxsize=1)
def get_snapshot() -> ValueSnapshot:
    """Слепок, разделяемый между запросами. Читается с диска один раз."""
    return load_snapshot()


def reset_snapshot_cache() -> None:
    get_snapshot.cache_clear()


def write_snapshot(
    entries: list[dict[str, Any]],
    max_value_mln: float,
    source_rows: int,
    path: Path | None = None,
    version: str | None = None,
) -> ValueSnapshot:
    """Записывает артефакт. Версия по умолчанию — дата сборки."""
    path = path or SNAPSHOT_PATH
    snapshot = ValueSnapshot(
        version=version or dt.date.today().isoformat(),
        built_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        source_rows=source_rows,
        max_value_mln=round(float(max_value_mln), 4),
        entries=entries,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "version": snapshot.version,
                "built_at": snapshot.built_at,
                "source_rows": snapshot.source_rows,
                "max_value_mln": snapshot.max_value_mln,
                "entries": snapshot.entries,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    reset_snapshot_cache()
    return snapshot
