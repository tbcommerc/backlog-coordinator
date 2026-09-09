from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from models import EventOutbox, RequirementRequest, Task, TaskViewer
from auth import task_read_scope_clause
from routers.task_collaboration_router import _release_task_lock, _try_acquire_task_lock
from routers.agent_router import AgentRequestStatusUpdate, REQUEST_STATUS_TRANSITIONS
from routers.tasks_router import _bulk_version_issues
from schemas import BulkActionRequest, TaskUpdate


def test_task_update_requires_expected_version():
    with pytest.raises(ValidationError):
        TaskUpdate(title="Изменённая задача")

    update = TaskUpdate(title="Изменённая задача", version=7)
    assert update.version == 7


def test_request_status_update_requires_expected_version():
    with pytest.raises(ValidationError):
        AgentRequestStatusUpdate(status="in_review")

    update = AgentRequestStatusUpdate(status="in_review", version=4)
    assert update.version == 4
    assert REQUEST_STATUS_TRANSITIONS["submitted"] == {"in_review"}
    assert "submitted" not in REQUEST_STATUS_TRANSITIONS["in_review"]


def test_bulk_versions_are_normalized_and_conflicts_are_reported():
    request = BulkActionRequest.model_validate({
        "action": "update",
        "task_ids": [10, 20],
        "versions": {"10": 3, "20": 4},
        "fields": {"progress": 50},
    })
    assert request.versions == {10: 3, 20: 4}

    tasks = [
        type("TaskVersion", (), {"id": 10, "version": 3})(),
        type("TaskVersion", (), {"id": 20, "version": 5})(),
        type("TaskVersion", (), {"id": 30, "version": 1})(),
    ]
    missing, conflicts = _bulk_version_issues(tasks, request.versions)
    assert missing == [30]
    assert conflicts == [{"task_id": 20, "submitted_version": 4, "current_version": 5}]


def test_task_query_scope_filters_team_user_and_allows_global_reader():
    engine = create_engine("sqlite:///:memory:")
    EventOutbox.__table__.create(engine)
    Task.__table__.create(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add_all([
        Task(team_id=1, title="Team 1", version=0),
        Task(team_id=2, title="Team 2", version=0),
    ])
    session.commit()

    role_defaults = {
        "customer_portal_only": False,
        "backlog_team_access": "read_own",
        "reports_access": "none",
        "analytics_access": "none",
        "customer_access": "none",
        "settings_access": "none",
        "admin_access": "none",
    }
    team_role = SimpleNamespace(**role_defaults, backlog_dmb_access="none")
    team_user = SimpleNamespace(team_id=1, role=team_role, role_name="")
    team_ids = [
        row.id
        for row in session.query(Task).filter(task_read_scope_clause(team_user, Task)).order_by(Task.id).all()
    ]
    assert team_ids == [1]

    global_role = SimpleNamespace(**role_defaults, backlog_dmb_access="read_write")
    global_user = SimpleNamespace(team_id=None, role=global_role, role_name="")
    global_ids = [
        row.id
        for row in session.query(Task).filter(task_read_scope_clause(global_user, Task)).order_by(Task.id).all()
    ]
    assert global_ids == [1, 2]

    no_team_user = SimpleNamespace(team_id=None, role=team_role, role_name="")
    assert session.query(Task).filter(task_read_scope_clause(no_team_user, Task)).count() == 0
    engine.dispose()


def test_task_mapper_rejects_second_commit_from_same_version():
    """The test only creates ordinary task rows in an isolated in-memory DB."""
    engine = create_engine("sqlite:///:memory:")
    EventOutbox.__table__.create(engine)
    Task.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    seed = Session()
    seed.add(Task(team_id=1, title="Base", version=0))
    seed.commit()
    task_id = seed.query(Task.id).scalar()

    first = Session()
    second = Session()
    first_task = first.get(Task, task_id)
    second_task = second.get(Task, task_id)

    first_task.title = "First"
    first_task.version += 1
    second_task.title = "Second"
    second_task.version += 1

    first.commit()
    with pytest.raises(StaleDataError):
        second.commit()

    second.rollback()
    verifier = Session()
    stored = verifier.get(Task, task_id)
    assert stored.title == "First"
    assert stored.version == 1

    verifier.close()
    second.close()
    first.close()
    seed.close()
    engine.dispose()


def test_requirement_request_mapper_rejects_second_review_decision():
    """No user, role, team or credential rows are created by this isolated test."""
    engine = create_engine("sqlite:///:memory:")
    RequirementRequest.__table__.create(engine)
    EventOutbox.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    seed = Session()
    seed.add(RequirementRequest(
        title="Concurrent review",
        status="in_review",
        user_id=1,
        version=0,
    ))
    seed.commit()
    request_id = seed.query(RequirementRequest.id).scalar()

    first = Session()
    second = Session()
    first_request = first.get(RequirementRequest, request_id)
    second_request = second.get(RequirementRequest, request_id)

    first_request.status = "returned"
    first_request.version += 1
    second_request.status = "rejected"
    second_request.version += 1

    first.commit()
    with pytest.raises(StaleDataError):
        second.commit()

    second.rollback()
    stored = Session().get(RequirementRequest, request_id)
    assert stored.status == "returned"
    assert stored.version == 1
    engine.dispose()


def test_task_lock_claim_is_atomic_and_renewable_by_owner():
    engine = create_engine("sqlite:///:memory:")
    EventOutbox.__table__.create(engine)
    Task.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    seed = Session()
    seed.add(Task(team_id=1, title="Lock target", version=0))
    seed.commit()
    task_id = seed.query(Task.id).scalar()

    now = datetime.now(timezone.utc)
    first = Session()
    assert _try_acquire_task_lock(first, task_id, 101, now, now + timedelta(minutes=15))
    first.commit()

    second = Session()
    assert not _try_acquire_task_lock(second, task_id, 202, now, now + timedelta(minutes=15))
    second.rollback()

    renewal = Session()
    assert _try_acquire_task_lock(renewal, task_id, 101, now, now + timedelta(minutes=20))
    renewal.commit()

    foreign_release = Session()
    assert not _release_task_lock(foreign_release, task_id, 202, now)
    foreign_release.rollback()

    owner_release = Session()
    assert _release_task_lock(owner_release, task_id, 101, now)
    owner_release.commit()

    stored = Session().get(Task, task_id)
    assert stored.lock_owner_id is None
    assert stored.lock_until is None
    assert stored.version == 0
    engine.dispose()


def test_viewer_table_enforces_one_row_per_task_and_user():
    engine = create_engine("sqlite:///:memory:")
    TaskViewer.__table__.create(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(TaskViewer(task_id=11, user_id=22))
    session.commit()
    session.add(TaskViewer(task_id=11, user_id=22))

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()
    engine.dispose()
