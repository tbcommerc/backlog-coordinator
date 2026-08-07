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
            "priority_id": 1,
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

    task = Task(team_id=team.id, title="Task 1", status_id=1)
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

    task = Task(team_id=team.id, title="Task Detail", status_id=1)
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

    task = Task(team_id=team.id, title="Old Title", status_id=1)
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={"title": "New Title", "status_id": 2}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "New Title"


def test_delete_task(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeam5")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="To Delete", status_id=1)
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


def test_create_task_with_tags_and_metric_kr_unit(client, auth_headers, db):
    from models import Team, Tag
    team = Team(name="TestTeamTags")
    db.add(team)
    db.commit()
    db.refresh(team)

    response = client.post(
        "/api/v1/tasks/",
        headers=auth_headers,
        json={
            "team_id": team.id,
            "title": "Task with tags",
            "priority_id": 1,
            "metric_kr_plan": 100,
            "metric_kr_fact": 80,
            "metric_kr_unit": "%",
            "tags": ["Backend", "security", "Backend"],
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["metric_kr_unit"] == "%"
    assert data["metric_kr_plan"] == 100
    tag_names = {t["name"] for t in (data.get("tags") or [])}
    assert tag_names == {"Backend", "security"}

    from models import Tag as TagModel
    db_expunge = db
    created = db_expunge.query(TagModel).filter(TagModel.name.in_(["Backend", "security"])).count()
    assert created == 2


def test_update_task_tags_and_metric_kr_unit(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeamTags2")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Tag Update Task")
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={
            "metric_kr_unit": "шт",
            "tags": ["Новый тег"],
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["metric_kr_unit"] == "шт"
    assert [t["name"] for t in (data.get("tags") or [])] == ["Новый тег"]


def test_update_task_removes_all_tags(client, auth_headers, db):
    from models import Team, Task
    team = Team(name="TestTeamTags3")
    db.add(team)
    db.commit()
    db.refresh(team)

    task = Task(team_id=team.id, title="Tag Remove Task")
    db.add(task)
    db.commit()
    db.refresh(task)

    resp = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={"tags": ["temp"]}
    )
    assert resp.status_code == 200
    assert [t["name"] for t in (resp.json().get("tags") or [])] == ["temp"]

    resp2 = client.put(
        f"/api/v1/tasks/{task.id}",
        headers=auth_headers,
        json={"tags": []}
    )
    assert resp2.status_code == 200
    assert (resp2.json().get("tags") or []) == []
