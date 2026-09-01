from models import Task, Team, format_task_public_id


def test_format_task_public_id_uses_two_three_digit_groups():
    assert format_task_public_id(1) == "TASK-000-001"
    assert format_task_public_id(123456) == "TASK-123-456"


def test_new_task_gets_stored_public_id(db):
    team = Team(name="Public ID Team")
    db.add(team)
    db.flush()

    task = Task(team_id=team.id, title="Public ID task")
    db.add(task)
    db.commit()
    db.refresh(task)

    assert task.public_id == format_task_public_id(task.id)
