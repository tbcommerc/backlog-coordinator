"""Transactional legacy Task -> RequirementRequest result projection.

Only ORM task writes are supported (the application uses these for status changes).
Never derive completion from a percentage; never overwrite a human review decision.
"""
from datetime import datetime, timezone
from sqlalchemy import inspect, select

OUTCOMES = {"ВЫПОЛНЕНА": "completed", "НЕ АКТУАЛЬНА": "not_relevant", "ОТКЛОНЕНА": "task_rejected"}
LABELS = {"completed": "Задача по запросу выполнена", "not_relevant": "Задача по запросу не актуальна",
          "task_rejected": "Задача по запросу отклонена", "task_deleted": "Связанная задача удалена",
          "in_progress": "Задача по запросу возвращена в работу"}
MANAGED = set(LABELS)


def task_status_name(session, task):
    from models import TaskStatus
    return session.scalar(select(TaskStatus.name).where(TaskStatus.id == task.status_id)) if task.status_id else None


def synchronize(session, flush_context, instances):
    from models import Task, RequirementRequest, Notification
    candidates = {}
    for task in list(session.dirty):
        if isinstance(task, Task) and any(inspect(task).attrs[key].history.has_changes()
                                         for key in ("status_id", "is_deleted")):
            candidates[task.id] = task
    # Also reconcile a new link to an already terminal task.
    links = [r for r in list(session.dirty)
             if isinstance(r, RequirementRequest) and r.task_id and
             inspect(r).attrs.task_id.history.has_changes()]
    for req in links:
        task = session.get(Task, req.task_id)
        if task is not None:
            candidates[task.id] = task
    for task_id, task in sorted(candidates.items()):
        requests = list(session.scalars(select(RequirementRequest).where(
            RequirementRequest.task_id == task_id, RequirementRequest.is_deleted.is_(False))))
        requests += [r for r in links if r.task_id == task_id and r not in requests]
        if not requests:
            continue
        outcome = "task_deleted" if task.is_deleted else OUTCOMES.get(task_status_name(session, task), "in_progress")
        for req in requests:
            if req.task_id != task_id or req.is_deleted or req.status not in MANAGED or req.status == outcome:
                continue
            previous = req.status
            req.status = outcome
            req.version = (req.version or 0) + 1
            now = datetime.now(timezone.utc)
            req.updated_at = now
            # Append, do not mutate JSON in place. Request optimistic version guards
            # concurrent writers; any conflict rolls back task, history and notification.
            req.status_history = list(req.status_history or []) + [{
                "status": outcome, "title": LABELS[outcome], "comment": "",
                "actor_id": None, "actor_name": "Система", "created_at": now.isoformat(),
                "revision": len(req.revision_history or []), "legacy_event": False,
                "metadata": {"source": "task_result", "task_id": task_id,
                             "previous_status": previous, "request_version": req.version},
            }]
            # The transition is the deduplication gate, independent of notification
            # read/dismissed state. No upsert that resets unread state or increments count.
            session.add(Notification(user_id=req.user_id, task_id=None,
                type=f"request.task.{outcome}", category="request", title=LABELS[outcome],
                message=LABELS[outcome], body="Откройте запрос, чтобы посмотреть результат и историю.",
                importance="medium", action_url=f"#/customer/request/{req.id}",
                group_key=f"request-task:{req.id}:{req.version}:{outcome}", group_count=1))
