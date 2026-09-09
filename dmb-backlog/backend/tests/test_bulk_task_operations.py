from types import SimpleNamespace

from models import AuditLog, Notification, Tag, Task, TaskComment, TaskHistory, Team, User
from routers.tasks_router import _apply_tags, bulk_action, preview_bulk_action
from schemas import BulkActionRequest


def test_bulk_tags_preserve_history_version_and_operation_result(db):
    team = Team(name="Bulk tags team")
    db.add(team)
    db.flush()
    task = Task(team_id=team.id, title="Bulk tags task", version=2)
    db.add(task)
    db.flush()
    _apply_tags(db, task, ["existing", "remove-me"])
    db.commit()

    user = SimpleNamespace(id=777, role_name="Администратор", team_id=None)
    result = bulk_action(
        BulkActionRequest(
            action="update",
            task_ids=[task.id],
            versions={task.id: task.version},
            fields={"tags_add": ["new-tag"], "tags_remove": ["remove-me"]},
        ),
        db=db,
        current_user=user,
    )

    db.refresh(task)
    assert {tag.name for tag in task.tags} == {"existing", "new-tag"}
    assert task.version == 3
    assert result.changed_tasks == 1
    assert result.applied_changes == 1
    assert result.changed_task_ids == [task.id]
    assert result.unchanged_task_ids == []
    assert result.operation_id
    history = db.query(TaskHistory).filter(TaskHistory.task_id == task.id, TaskHistory.field_name == "tags").one()
    assert history.old_value == "existing, remove-me"
    assert history.new_value == "existing, new-tag"
    audit = db.query(AuditLog).filter(AuditLog.entity_type == "tasks_bulk").one()
    assert result.operation_id in audit.details


def test_bulk_update_counts_unchanged_fields_without_bumping_version(db):
    team = Team(name="Bulk unchanged team")
    db.add(team)
    db.flush()
    task = Task(team_id=team.id, title="Bulk unchanged task", progress=25, version=4)
    db.add(task)
    db.commit()

    user = SimpleNamespace(id=778, role_name="Администратор", team_id=None)
    result = bulk_action(
        BulkActionRequest(action="update", task_ids=[task.id], versions={task.id: task.version}, fields={"progress": 25}),
        db=db,
        current_user=user,
    )

    db.refresh(task)
    assert task.version == 4
    assert result.changed_tasks == 0
    assert result.unchanged_tasks == 1
    assert result.skipped_changes == 1
    assert result.changed_task_ids == []
    assert result.unchanged_task_ids == [task.id]


def test_bulk_update_accepts_more_than_500_tasks_in_one_operation(db):
    team = Team(name="Large bulk team")
    db.add(team)
    db.flush()
    tasks = [Task(team_id=team.id, title=f"Large bulk {index}", progress=0, version=0) for index in range(501)]
    db.add_all(tasks)
    db.commit()

    user = SimpleNamespace(id=779, role_name="Администратор", team_id=None)
    result = bulk_action(
        BulkActionRequest(
            action="update",
            task_ids=[task.id for task in tasks],
            versions={task.id: task.version for task in tasks},
            fields={"progress": 10},
        ),
        db=db,
        current_user=user,
    )

    assert result.requested_tasks == 501
    assert result.changed_tasks == 501
    assert result.applied_changes == 501
    assert db.query(Task).filter(Task.team_id == team.id, Task.progress == 10, Task.version == 1).count() == 501


def test_bulk_preview_calculates_result_without_writes(db):
    team = Team(name="Bulk preview team")
    db.add(team)
    db.flush()
    task = Task(team_id=team.id, title="Bulk preview task", progress=0, version=3)
    db.add(task)
    db.commit()

    user = SimpleNamespace(id=780, role_name="Администратор", team_id=None)
    result = preview_bulk_action(
        BulkActionRequest(action="update", task_ids=[task.id], versions={task.id: task.version}, fields={"progress": 10}),
        db=db,
        current_user=user,
    )

    db.refresh(task)
    assert result.can_apply is True
    assert result.changed_tasks == 1
    assert result.applied_changes == 1
    assert task.progress == 0
    assert task.version == 3
    assert db.query(TaskHistory).filter(TaskHistory.task_id == task.id).count() == 0
    assert db.query(AuditLog).filter(AuditLog.entity_type == "tasks_bulk").count() == 0


def test_bulk_comment_adds_to_feed_without_overwriting_task_field_or_version(db):
    team = Team(name="Bulk comments team")
    db.add(team)
    db.flush()
    mentioned = User(
        email="mentioned@example.test",
        password_hash="x",
        name="Mentioned",
        team_id=team.id,
        is_active=True,
    )
    db.add(mentioned)
    db.flush()
    task = Task(team_id=team.id, title="Bulk comment task", comment="Старое поле", version=6)
    db.add(task)
    db.commit()

    user = SimpleNamespace(id=781, name="Admin", role_name="Администратор", team_id=None)
    result = bulk_action(
        BulkActionRequest(
            action="comment",
            task_ids=[task.id],
            fields={"comment_text": "Новый комментарий", "mentioned_user_ids": [mentioned.id]},
        ),
        db=db,
        current_user=user,
    )

    db.refresh(task)
    comment = db.query(TaskComment).filter(TaskComment.task_id == task.id).one()
    assert comment.text == "Новый комментарий"
    assert str(mentioned.id) in comment.mentioned_user_ids
    assert task.comment == "Старое поле"
    assert task.version == 6
    assert result.changed_tasks == 1
    assert result.applied_changes == 1
    assert db.query(TaskHistory).filter(TaskHistory.task_id == task.id, TaskHistory.field_name == "comment").count() == 1
    assert db.query(Notification).filter(Notification.task_id == task.id, Notification.user_id == mentioned.id, Notification.category == "mention").count() == 1
