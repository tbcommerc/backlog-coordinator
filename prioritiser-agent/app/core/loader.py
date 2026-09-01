"""Загрузка Единого бэклога из JSON-слепка в БД.

Слепок — экспорт собранной страницы Confluence: список объектов, по одному на
задачу, ключи — заголовки колонок как есть. Загрузчик обязан сохранить все 29
полей (в `raw`), а нужные расчёту — разложить по типизированным колонкам.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import DATA_DIR
from app.core import normalise as nz
from app.core.models import Task
from app.core.references import ReferenceBundle

DEFAULT_SEED = DATA_DIR / "backlog_seed.json"

# Соответствие колонок бэклога полям модели.
FIELD_TEAM = "Ответственная команда / кластер"
FIELD_KEY = "ID задачи"
FIELD_CREATED = "Дата поступления задачи"
FIELD_CHANNEL = "Канал поступления задачи"
FIELD_CUSTOMER = "Бизнес-заказчик"
FIELD_CUSTOMER_DIV = "Подразделение Бизнес-заказчика"
FIELD_PROJECT = "Проект"
FIELD_TYPE = "Тип задачи"
FIELD_TITLE = "Наименование задачи / краткая постановка"
FIELD_PRIORITY = "Приоритет задачи в бэклоге команды"
FIELD_DEADLINE = "Срок выполнения"
FIELD_STATUS = "Статус"
FIELD_ASSIGNEE = "Исполнитель"
FIELD_INVOLVED = "Другие вовлечённые команды / кластеры"
FIELD_EFFORT = "Оценка трудозатрат (ч/д)"
FIELD_VALUE = "Фин. эффект (value в млн руб.)"
FIELD_COMMENT = "Комментарий"


def read_seed(path: Path | str | None = None) -> list[dict[str, Any]]:
    seed_path = Path(path) if path else DEFAULT_SEED
    with seed_path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError(f"ожидался список задач, получено {type(payload).__name__}")
    return payload


def build_task(row: dict[str, Any], refs: ReferenceBundle) -> Task:
    """Собирает Task из одной строки бэклога, ничего не досочиняя."""
    title = nz.clean_text(row.get(FIELD_TITLE))
    team = nz.clean_text(row.get(FIELD_TEAM))
    involved = nz.split_teams(row.get(FIELD_INVOLVED))

    detection = refs.detection
    # Регуляторность и RnD ищем и в названии, и в проекте, и в типе задачи:
    # в бэклоге эти признаки нигде не заведены отдельным полем.
    haystack = " ".join(
        filter(
            None,
            [
                title,
                nz.clean_text(row.get(FIELD_PROJECT)),
                nz.clean_text(row.get(FIELD_TYPE)),
                nz.clean_text(row.get(FIELD_COMMENT)),
            ],
        )
    )

    task_type = nz.clean_text(row.get(FIELD_TYPE))
    is_rnd = nz.contains_any(haystack, detection.get("rnd_keywords", []))
    if task_type and task_type.upper() == "ИССЛЕДОВАНИЕ":
        is_rnd = True

    return Task(
        task_key=nz.clean_text(row.get(FIELD_KEY)) or "",
        team=team,
        title=title,
        task_type=task_type,
        channel=nz.clean_text(row.get(FIELD_CHANNEL)),
        customer=nz.clean_text(row.get(FIELD_CUSTOMER)),
        customer_division=nz.clean_text(row.get(FIELD_CUSTOMER_DIV)),
        project=nz.clean_text(row.get(FIELD_PROJECT)),
        status=nz.clean_text(row.get(FIELD_STATUS)),
        assignee=nz.clean_text(row.get(FIELD_ASSIGNEE)),
        backlog_priority_original=nz.clean_text(row.get(FIELD_PRIORITY)),
        deadline_raw=nz.clean_text(row.get(FIELD_DEADLINE)),
        involved_teams_raw=nz.clean_text(row.get(FIELD_INVOLVED)),
        comment=nz.clean_text(row.get(FIELD_COMMENT)),
        raw=row,
        created_date=nz.parse_date(row.get(FIELD_CREATED)),
        deadline=nz.parse_deadline(row.get(FIELD_DEADLINE)),
        involved_teams_count=len(involved),
        effort_man_days=nz.parse_number(row.get(FIELD_EFFORT)),
        team_class=refs.team_class(team),
        value_manual_mln=nz.parse_number(row.get(FIELD_VALUE)),
        is_regulatory=nz.contains_any(haystack, detection.get("regulatory_keywords", [])),
        is_rnd=is_rnd,
        is_blocking=nz.contains_any(haystack, detection.get("blocking_keywords", [])),
    )


def load_backlog(
    session: Session,
    path: Path | str | None = None,
    replace: bool = False,
) -> dict[str, int]:
    """Загружает слепок в БД. Существующие задачи обновляются по `ID задачи`."""
    rows = read_seed(path)
    refs = ReferenceBundle(session)

    if replace:
        for task in session.scalars(select(Task)).all():
            session.delete(task)
        session.flush()

    existing = {t.task_key: t for t in session.scalars(select(Task)).all()}
    stats = {"total": len(rows), "created": 0, "updated": 0, "skipped_no_key": 0}

    for row in rows:
        candidate = build_task(row, refs)
        if not candidate.task_key:
            stats["skipped_no_key"] += 1
            continue
        current = existing.get(candidate.task_key)
        if current is None:
            session.add(candidate)
            existing[candidate.task_key] = candidate
            stats["created"] += 1
        else:
            # Пересобираем только исходные и производные поля; результат работы
            # агента (priority, value_internal) остаётся до следующего пересчёта.
            for field in (
                "team", "title", "task_type", "channel", "customer", "customer_division",
                "project", "status", "assignee", "backlog_priority_original", "deadline_raw",
                "involved_teams_raw", "comment", "raw", "created_date", "deadline",
                "involved_teams_count", "effort_man_days", "team_class", "value_manual_mln",
                "is_regulatory", "is_rnd", "is_blocking",
            ):
                setattr(current, field, getattr(candidate, field))
            stats["updated"] += 1

    return stats
