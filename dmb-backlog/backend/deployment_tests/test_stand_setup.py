from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

from auth import user_permissions
from database import get_db
from models import User, Role, DictionaryItem, Priority, Task, Team
from services.stand_setup import bootstrap_admin, ADMIN_PERMISSIONS
from services.reference_catalog import synchronize_references, reconcile_references, reference_options


PASSWORD = "Isolated demo passphrase 2026!"


@pytest.fixture
def client(db, monkeypatch):
    from main import app
    from config import settings
    from services import auth_limits
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "AUTH_ORIGINS", ["http://127.0.0.1:8000"])
    monkeypatch.setattr(auth_limits, "limit", AsyncMock())
    monkeypatch.setattr(auth_limits, "sensitive_limit", AsyncMock())
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[auth_limits.sensitive_limit] = lambda: None
    # No lifespan: never start real workers, seed, or open the application DB.
    try:
        yield TestClient(app, base_url="http://127.0.0.1:8000", headers={"Origin": "http://127.0.0.1:8000"})
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def activate_and_login(client, db, demo=True):
    user, challenge = bootstrap_admin(db, "demo.admin", "Demo administrator", "isolated-test", demo_data=demo)
    db.commit()
    response = client.post("/api/v1/auth/password/setup", json={"token": challenge["token"], "new_password": PASSWORD})
    assert response.status_code == 204, response.text
    response = client.post("/api/v1/auth/login", json={"login": "demo.admin", "password": PASSWORD})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    client.headers["Authorization"] = "Bearer " + token
    return user, response.json()


def test_empty_database_to_login_admin_and_task(client, db):
    user, login = activate_and_login(client, db)
    assert login["user"]["permissions"]["admin"] == "full"
    assert all(login["user"]["permissions"][key] != "none" for key in ("backlog_dmb", "backlog_team", "reports", "analytics", "customer", "settings"))
    for path in ("auth/me", "admin/roles", "admin/users", "admin/teams", "admin/projects", "admin/dict-locks"):
        response = client.get("/api/v1/" + path)
        assert response.status_code == 200, (path, response.text)
    ref = client.get("/api/v1/tasks/reference").json()
    assert all(ref[key] for key in ("priorities", "statuses", "task_types", "channels", "deadlines", "teams", "projects"))
    response = client.post("/api/v1/tasks/", json={"title": "Created through the real task API", "team_id": ref["teams"][0]["id"],
        "priority_id": ref["priorities"][0]["id"], "status_id": ref["statuses"][0]["id"],
        "date_received": "2026-11-23", "channel_id": ref["channels"][0]["id"], "task_type_id": ref["task_types"][0]["id"]})
    assert response.status_code == 201, response.text
    task = db.get(Task, response.json()["id"])
    assert task.priority_id == ref["priorities"][0]["id"]
    me = client.get("/api/v1/auth/me").json()
    assert me["permissions"] == login["user"]["permissions"]
    assert me["role_name"] == "Администратор стенда"
    response = client.post("/api/v1/auth/refresh")
    assert response.status_code == 200, response.text
    client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
    assert client.get("/api/v1/tasks/reference").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_bootstrap_refuses_existing_accounts_without_changing_them(db):
    user, _ = bootstrap_admin(db, "first.admin", "First", "test")
    db.commit()
    with pytest.raises(HTTPException, match="FIRST_ADMIN_REQUIRES_EMPTY_USERS"):
        bootstrap_admin(db, "second.admin", "Second", "test")
    assert db.query(User).count() == 1
    assert db.query(Role).count() == 1
    assert db.get(User, user.id).login_normalized == "first.admin"


def test_demo_bootstrap_refuses_populated_workspace(db):
    db.add(Team(name="Existing team"))
    db.commit()
    with pytest.raises(HTTPException, match="DEMO_DATA_REQUIRES_EMPTY"):
        bootstrap_admin(db, "first.admin", "First", "test", demo_data=True)
    assert db.query(User).count() == 0


def test_bootstrap_refuses_reusing_named_role(db):
    db.add(Role(name="Администратор стенда", admin_access="none"))
    db.commit()
    with pytest.raises(HTTPException, match="BOOTSTRAP_ROLE_ALREADY_EXISTS"):
        bootstrap_admin(db, "first.admin", "First", "test")
    assert db.query(Role).one().admin_access == "none"


def test_null_permissions_do_not_break_me_or_grant_admin(client, db):
    user, _ = activate_and_login(client, db, demo=False)
    db.execute(text("UPDATE roles SET admin_access=NULL, reports_access=NULL, analytics_access=NULL WHERE id=:id"), {"id": user.role_id})
    db.execute(text("UPDATE users SET can_edit=NULL, can_delete=NULL, can_export=NULL WHERE id=:id"), {"id": user.id})
    db.commit()
    db.expire_all()
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200, response.text
    assert response.json()["permissions"]["admin"] == "none"
    assert response.json()["permissions"]["reports"] == "none"
    assert response.json()["can_edit"] is False
    assert client.get("/api/v1/admin/roles").status_code == 403


def test_wrong_password_and_missing_bearer_remain_unauthorized(client, db):
    activate_and_login(client, db)
    assert client.post("/api/v1/auth/login", json={"login": "demo.admin", "password": "wrong"}).status_code == 401
    del client.headers["Authorization"]
    # A refresh cookie is intentionally insufficient for protected GETs.
    assert client.get("/api/v1/tasks/reference").status_code == 401


@pytest.mark.parametrize("kind", ["priority", "status", "task_type", "channel", "deadline", "team_type", "project_status"])
def test_new_dictionary_value_reaches_typed_reference_and_survives_rename(db, kind):
    db.add(DictionaryItem(dict_type=kind, name="Original", code="original", sort_order=2, is_active=True))
    synchronize_references(db, kind)
    db.commit()
    item = db.query(DictionaryItem).filter_by(dict_type=kind).one()
    reference_id = item.reference_id
    assert reference_options(db, kind)[0]["id"] == reference_id
    item.name = "Renamed"
    item.sort_order = 0
    synchronize_references(db, kind)
    db.commit()
    assert reference_options(db, kind)[0]["name"] == "Renamed"
    assert item.reference_id == reference_id
    item.is_active = False
    synchronize_references(db, kind)
    db.commit()
    assert reference_options(db, kind) == []
    item.is_active = True
    synchronize_references(db, kind)
    db.commit()
    assert reference_options(db, kind)[0]["id"] == reference_id


def test_reconciliation_preserves_existing_foreign_keys_and_is_repeatable(db):
    db.add(Priority(id=42, name="Existing"))
    db.add(DictionaryItem(id=700, dict_type="priority", name="Existing", is_active=True))
    db.commit()
    reconcile_references(db)
    db.commit()
    assert db.get(DictionaryItem, 700).reference_id == 42
    assert reference_options(db, "priority")[0]["id"] == 42
    reconcile_references(db)
    db.commit()
    assert db.query(Priority).count() == 1
    assert db.query(DictionaryItem).count() == 1


def test_ambiguous_legacy_data_requires_resolution_instead_of_guessing(db):
    db.add_all([Priority(name="Same"), Priority(name="Same"), DictionaryItem(dict_type="priority", name="Same", is_active=True)])
    db.commit()
    with pytest.raises(HTTPException, match="AMBIGUOUS"):
        reconcile_references(db)
    db.rollback()
    assert db.query(DictionaryItem).one().reference_id is None


def test_batch_priority_create_rename_archive_and_usage(client, db):
    user, _ = activate_and_login(client, db)
    workspace = client.get("/api/v1/admin/dictionaries/priority/workspace").json()
    lock = client.post("/api/v1/admin/priority/lock")
    assert lock.status_code == 200, lock.text
    values = [{key: item.get(key) for key in ("id", "name", "code", "color", "sort_order")} for item in workspace["items"]]
    values.append({"name": "Demo custom priority", "code": "demo_custom", "sort_order": 10})
    response = client.put("/api/v1/admin/dictionaries/priority/batch", json={"version": lock.json()["version"], "items": values})
    assert response.status_code == 200, response.text
    item = next(item for item in response.json()["items"] if item["name"] == "Demo custom priority")
    ref = client.get("/api/v1/tasks/reference").json()
    option = next(item for item in ref["priorities"] if item["name"] == "Demo custom priority")
    assert option["id"] == item["reference_id"]
    response = client.post("/api/v1/tasks/", json={"title": "Custom priority task", "team_id": user.team_id, "priority_id": option["id"],
        "date_received": "2026-11-23", "channel_id": ref["channels"][0]["id"], "task_type_id": ref["task_types"][0]["id"]})
    assert response.status_code == 201, response.text
    workspace = client.get("/api/v1/admin/dictionaries/priority/workspace").json()
    assert next(row for row in workspace["items"] if row["id"] == item["id"])["usage_count"] == 1
    assert client.put(f'/api/v1/admin/priorities/{item["id"]}', json={"name": "Renamed custom"}).status_code == 200
    assert db.get(Priority, option["id"]).name == "Renamed custom"
    assert client.delete(f'/api/v1/admin/priorities/{item["id"]}').status_code == 200
    assert all(row["id"] != option["id"] for row in client.get("/api/v1/tasks/reference").json()["priorities"])
    assert db.get(Task, response.json()["id"]).priority.name == "Renamed custom"


@pytest.mark.parametrize("kind,endpoint", [("priority", "priorities"), ("status", "statuses"),
    ("task_type", "task-types"), ("channel", "channels"), ("deadline", "deadlines"),
    ("team_type", "team-types"), ("project_status", "project-statuses")])
def test_individual_dictionary_crud_uses_stable_reference_ids(client, db, kind, endpoint):
    activate_and_login(client, db, demo=False)
    response = client.post("/api/v1/admin/" + endpoint, json={"dict_type": kind, "name": "Custom option", "code": "custom_option"})
    assert response.status_code == 201, response.text
    created = response.json()
    reference_id = created["reference_id"]
    assert reference_id is not None
    assert reference_options(db, kind)[0]["id"] == reference_id
    response = client.put(f'/api/v1/admin/{endpoint}/{created["id"]}', json={"name": "Updated option"})
    assert response.status_code == 200, response.text
    assert response.json()["reference_id"] == reference_id
    assert reference_options(db, kind)[0]["name"] == "Updated option"
    assert client.delete(f'/api/v1/admin/{endpoint}/{created["id"]}').status_code == 200
    assert reference_options(db, kind) == []


def test_shared_display_settings_have_read_only_defaults_and_read_saved_value(client, db):
    from models import DisplaySetting
    activate_and_login(client, db, demo=False)
    response = client.get('/api/v1/admin/display-settings/shared')
    assert response.status_code == 200
    assert response.json()['settings'] == {}
    assert db.query(DisplaySetting).count() == 0
    response = client.put('/api/v1/admin/display-settings/shared', json={'settings': {'title': True, 'id': False}})
    assert response.status_code == 200, response.text
    response = client.get('/api/v1/admin/display-settings/shared')
    assert response.status_code == 200
    assert response.json()['settings'] == {'title': True, 'id': False}
    assert response.json()['page'] == 'shared'


def test_operator_admin_repair_is_scoped_preserves_password_and_revokes_sessions(client, db):
    from models import AuthSession
    from services.stand_setup import configure_admin_access
    user, _ = activate_and_login(client, db, demo=False)
    original_role = user.role
    original_role.admin_access = 'partial'
    peer = User(name='Unaffected peer', login='peer.user', login_normalized='peer.user', role_id=original_role.id)
    db.add(peer)
    db.commit()
    password_hash, version, team_id = user.password_hash, user.auth_version, user.team_id
    repaired = configure_admin_access(db, user.id, 'approved-isolated-repair-test')
    db.commit()
    assert repaired.password_hash == password_hash
    assert repaired.team_id == team_id
    assert repaired.auth_version == version + 1
    assert repaired.role.admin_access == 'full'
    assert repaired.role.task_edit_scope == 'all'
    db.refresh(peer)
    assert peer.role_id == original_role.id
    assert original_role.admin_access == 'partial'
    assert all(row.revoked_at is not None for row in db.query(AuthSession).filter_by(user_id=user.id))
    assert client.get('/api/v1/auth/me').status_code == 401
    response = client.post('/api/v1/auth/login', json={'login': 'demo.admin', 'password': PASSWORD})
    assert response.status_code == 200
    assert response.json()['user']['permissions']['admin'] == 'full'


def test_operator_admin_repair_rejects_unknown_or_disabled_target(db):
    from services.stand_setup import configure_admin_access
    with pytest.raises(HTTPException, match='ACTIVE_EXISTING_USER_REQUIRED'):
        configure_admin_access(db, 99999, 'test')


def test_admin_lists_tolerate_null_legacy_rights_without_rewriting_records(client, db):
    activate_and_login(client, db, demo=False)
    role = Role(name='Legacy incomplete role')
    db.add(role)
    db.flush()
    peer = User(name='Legacy peer', login='legacy.peer', login_normalized='legacy.peer', role_id=role.id)
    db.add(peer)
    db.commit()
    db.execute(text('UPDATE roles SET reports_access=NULL, admin_access=NULL, can_edit_tasks=NULL, status=NULL WHERE id=:id'), {'id': role.id})
    db.execute(text('UPDATE users SET can_edit=NULL, can_export=NULL, is_active=NULL WHERE id=:id'), {'id': peer.id})
    db.commit()
    db.expire_all()
    response = client.get('/api/v1/admin/roles')
    assert response.status_code == 200, response.text
    legacy = next(row for row in response.json() if row['id'] == role.id)
    assert legacy['admin_access'] == 'none'
    assert legacy['can_edit_tasks'] is False
    assert legacy['status'] == 'in_dev'
    response = client.get('/api/v1/admin/users')
    assert response.status_code == 200, response.text
    legacy = next(row for row in response.json() if row['id'] == peer.id)
    assert legacy['can_edit'] is False
    assert legacy['is_active'] is False
    assert db.get(Role, role.id).admin_access is None
    assert db.get(User, peer.id).can_edit is None
