"""Replace terse meeting labels with task-specific narrative statuses."""

import argparse
from datetime import datetime, timezone

from database import SessionLocal
from models import Task, TaskReportingStatus, TaskReportingStatusRevision
from reporting_meetings import LEGACY_FIELDS, current_meeting


MEETING_TEXT = {
    "directorate_status": "На ближайшей директорской оперативке необходимо сверить результат, сроки и следующий управленческий шаг.",
    "did_status": "На оперативке ДИД необходимо подтвердить текущий результат и договориться о следующем действии команды.",
    "key_project_status": "На встрече по ключевым проектам необходимо сверить ближайшую контрольную точку и возможные отклонения от плана.",
}

PREVIOUS_FIELDS = {
    "directorate_status": "prev_directorate_status",
    "did_status": "prev_did_status",
    "key_project_status": "prev_key_project_status",
}

UPDATED_AT_FIELDS = {
    "directorate_status": "directorate_status_updated_at",
    "did_status": "did_status_updated_at",
    "key_project_status": "key_project_status_updated_at",
}


def narrative(task: Task, field: str, old_value: str) -> str:
    progress = task.progress or 0
    description = (task.description or "согласованного объёма работ").strip().rstrip(".")
    if len(description) > 420:
        description = f"{description[:417].rstrip()}…"
    return (
        f"По задаче «{task.title}» выполнено {progress}% запланированного объёма; "
        f"предыдущая краткая отметка — «{old_value.strip()}». "
        f"Текущий результат относится к направлению: {description}. "
        f"{MEETING_TEXT[field]}"
    )


def main(apply_changes: bool) -> None:
    db = SessionLocal()
    changed = {field: 0 for field in MEETING_TEXT}
    now = datetime.now(timezone.utc)
    try:
        for task in db.query(Task).filter(Task.is_deleted.is_(False)).all():
            for field in MEETING_TEXT:
                old_value = getattr(task, field)
                if not old_value:
                    continue
                if old_value.startswith("По задаче «") and MEETING_TEXT[field] in old_value:
                    continue
                new_value = narrative(task, field, old_value)
                if new_value == old_value:
                    continue
                setattr(task, PREVIOUS_FIELDS[field], old_value)
                setattr(task, field, new_value)
                setattr(task, UPDATED_AT_FIELDS[field], now)
                changed[field] += 1

        synced_rows = 0
        for kind, (current_field, _, _) in LEGACY_FIELDS.items():
            meeting = current_meeting(db, kind)
            if meeting is None:
                continue
            rows = db.query(TaskReportingStatus).filter(
                TaskReportingStatus.meeting_id == meeting.id
            ).all()
            for row in rows:
                task_text = getattr(row.task, current_field, None)
                if not task_text or row.status_text == task_text:
                    continue
                db.add(TaskReportingStatusRevision(
                    reporting_status_id=row.id,
                    old_text=row.status_text,
                    new_text=task_text,
                    old_did_demo=bool(row.did_demo),
                    new_did_demo=bool(row.did_demo),
                    changed_by=None,
                ))
                row.status_text = task_text
                row.source = "narrative_migration"
                row.updated_by = None
                row.version = (row.version or 0) + 1
                synced_rows += 1
        if apply_changes:
            db.commit()
        else:
            db.rollback()
    finally:
        db.close()

    mode = "updated" if apply_changes else "would update"
    print(", ".join(f"{field}: {mode} {count}" for field, count in changed.items()))
    print(f"current meeting rows: {mode} {synced_rows}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    main(args.apply)
