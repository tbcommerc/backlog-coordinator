"""Read-only dependency signals; links never change another task's workflow."""
from sqlalchemy import or_
from auth import task_read_scope_clause, can_access_task
from models import WorkDependency, WorkTask, Task, TaskStatus
from services.work_tasks import read_scope


def blocked_clause(db, user):
    """Only readable targets contribute to filters/counts, avoiding hidden-work leaks."""
    work_ids = db.query(WorkDependency.source_work_id).join(
        WorkTask, WorkDependency.target_work_id == WorkTask.id
    ).filter(WorkDependency.is_active.is_(True), WorkTask.is_deleted.is_(False),
             WorkTask.status != 'done', read_scope(user)).correlate(None)
    major_ids = db.query(WorkDependency.source_work_id).join(
        Task, WorkDependency.target_major_id == Task.id
    ).outerjoin(TaskStatus, Task.status_id == TaskStatus.id).filter(
        WorkDependency.is_active.is_(True), Task.is_deleted.is_(False),
        or_(TaskStatus.name.is_(None), TaskStatus.name != 'ВЫПОЛНЕНА'),
        task_read_scope_clause(user, Task)).correlate(None)
    return or_(WorkTask.id.in_(work_ids), WorkTask.id.in_(major_ids))


def blockers(db, work_ids, user=None):
    """Batch unresolved targets for live DTOs or a private immutable snapshot."""
    result = {id: [] for id in work_ids}
    if not result:
        return result
    links = db.query(WorkDependency).filter(
        WorkDependency.source_work_id.in_(result), WorkDependency.is_active.is_(True)).all()
    target_ids = {x.target_work_id for x in links if x.target_work_id}
    major_ids = {x.target_major_id for x in links if x.target_major_id}
    query = db.query(WorkTask).filter(WorkTask.id.in_(target_ids), WorkTask.is_deleted.is_(False))
    if user is not None:
        query = query.filter(read_scope(user))
    targets = {x.id: x for x in query.all()} if target_ids else {}
    query = db.query(Task).filter(Task.id.in_(major_ids), Task.is_deleted.is_(False))
    if user is not None:
        query = query.filter(task_read_scope_clause(user, Task))
    majors = {x.id: x for x in query.all()} if major_ids else {}
    statuses = {x.id: x.name for x in db.query(TaskStatus).filter(
        TaskStatus.id.in_({x.status_id for x in majors.values()})).all()} if majors else {}
    for link in links:
        target = targets.get(link.target_work_id) if link.target_work_id else majors.get(link.target_major_id)
        if not target:
            continue
        status = target.status if link.target_work_id else statuses.get(target.status_id)
        if status == ('done' if link.target_work_id else 'ВЫПОЛНЕНА'):
            continue
        result[link.source_work_id].append({
            'kind': 'work' if link.target_work_id else 'major', 'target_id': target.id,
            'public_id': target.public_id, 'title': target.title, 'status': status,
            'assignee_id': target.assignee_id if link.target_work_id else None,
        })
    return result


def visible_snapshot_blockers(db, items, user):
    """Intersect historical signals with today's target access without recomputing status."""
    work_ids = {x['target_id'] for x in items if x['kind'] == 'work'}
    major_ids = {x['target_id'] for x in items if x['kind'] == 'major'}
    readable_work = {id for (id,) in db.query(WorkTask.id).filter(
        WorkTask.id.in_(work_ids), WorkTask.is_deleted.is_(False), read_scope(user)).all()} if work_ids else set()
    readable_major = {id for (id,) in db.query(Task.id).filter(
        Task.id.in_(major_ids), Task.is_deleted.is_(False), task_read_scope_clause(user, Task)).all()} if major_ids else set()
    return [x for x in items if x['target_id'] in (readable_work if x['kind'] == 'work' else readable_major)]
