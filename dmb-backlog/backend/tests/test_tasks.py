def test_create_task(client, auth_headers, db):
    from models import Team
    team = Team(name="TestTeam")
    db.add(team)
    db.commit()
    db.refresh(team)

    response = client.post(
        "/api/v1/tasks/",
        headers=auth_headers,
        json={
            "team_id": team.id,
            "title": "Test Task",
            "description": "Test description",
            "priority": "Высокий",
            "status": "Сбор требований",
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Task"
    assert data["team_id"] == team.id


def test_get_tasks(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam2")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Task 1", status="В работе")
    db.add(task)
    db.commit()

    response = client.get("/api/v1/tasks/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert data["total"] >= 1


def test_get_task_by_id(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam3")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Task Detail", status="В работе")
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.get(f"/api/v1/tasks/{task.id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Task Detail"


def test_update_task(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam4")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Old Title", status="Сбор требований")
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={"title": "New Title", "status": "В работе"}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "New Title"


def test_delete_task(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam5")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="To Delete", status="Сбор требований")
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.delete(f"/api/v1/tasks/{task.id}", headers=auth_headers)
    assert response.status_code == 200

    response = client.get(f"/api/v1/tasks/{task.id}", headers=auth_headers)
    assert response.status_code == 404


def test_task_validation_title_too_long(client, auth_headers, db):
    from models import Team
    team = Team(name="TestTeam6")
    db.add(team)
    db.commit()
    db.refresh(team)

    response = client.post(
        "/api/v1/tasks/",
        headers=auth_headers,
        json={
            "team_id": team.id,
            "title": "x" * 300,
            "status": "Сбор требований",
        }
    )
    assert response.status_code == 422


def test_task_validation_progress_range(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam7")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Progress Test")
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={"progress": 150}
    )
    assert response.status_code == 422
