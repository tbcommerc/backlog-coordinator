from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from models import AuditLog, DictionaryItem, NotificationTemplate, RefreshSession, Role, User
from routers.admin_router import (
    get_dictionary_workspace,
    get_deletion_impact,
    _protect_admin_identity_change,
    _validate_role_policy,
    _validate_notification_template_policy,
    admin_delete_user,
    save_dictionary_batch,
)
from schemas import DictionaryBatchUpdate


@pytest.mark.parametrize("values, field", [
    ({"customer_portal_only": True, "customer_access": "none"}, "customer_access"),
    ({"customer_portal_only": True, "customer_access": "read", "admin_access": "full"}, "admin_access"),
    ({"task_edit_scope": "team", "task_delete_scope": "all"}, "task_delete_scope"),
    ({"pip_decision_access": True, "reports_access": "none"}, "pip_decision_access"),
])
def test_role_policy_rejects_conflicting_permissions(values, field):
    with pytest.raises(HTTPException) as exc_info:
        _validate_role_policy(values)
    assert exc_info.value.status_code == 422
    assert any(item["loc"][-1] == field for item in exc_info.value.detail)


def _admin(db, email, name, role):
    user = User(
        email=email,
        name=name,
        password_hash="not-used",
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_admin_cannot_deactivate_self_or_last_full_admin(db):
    role = Role(name="Full admin", admin_access="full")
    db.add(role)
    db.commit()
    actor = _admin(db, "admin@example.test", "Admin", role)

    with pytest.raises(HTTPException) as self_error:
        _protect_admin_identity_change(db, actor, actor, next_active=False)
    assert self_error.value.status_code == 400

    operator_role = Role(name="Operator", admin_access="partial")
    db.add(operator_role)
    db.commit()
    operator = _admin(db, "operator@example.test", "Operator", operator_role)
    with pytest.raises(HTTPException) as last_error:
        _protect_admin_identity_change(db, operator, actor, next_role_id=None, next_active=False)
    assert last_error.value.status_code == 400


def test_user_delete_is_deactivation_and_revokes_refresh_sessions(db):
    role = Role(name="Full admin", admin_access="full")
    ordinary = Role(name="User", admin_access="none")
    db.add_all([role, ordinary])
    db.commit()
    actor = _admin(db, "admin@example.test", "Admin", role)
    target = _admin(db, "user@example.test", "User", ordinary)
    session = RefreshSession(
        user_id=target.id, jti="jti", family_id="family", token_hash="hash",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(session)
    db.commit()

    result = admin_delete_user(target.id, db, actor)

    db.refresh(target)
    db.refresh(session)
    assert result["is_active"] is False
    assert target.is_active is False
    assert session.revoked_at is not None


def test_deletion_impact_is_read_only_and_blocks_role_with_users(db):
    admin_role = Role(name="Impact admin", admin_access="full")
    target_role = Role(name="Impact target", admin_access="none")
    db.add_all([admin_role, target_role])
    db.commit()
    actor = _admin(db, "impact-admin@example.test", "Impact Admin", admin_role)
    target = _admin(db, "impact-user@example.test", "Impact User", target_role)
    users_before = db.query(User).count()

    result = get_deletion_impact("role", target_role.id, db, actor)

    assert result["can_proceed"] is False
    assert result["name"] == "Impact target"
    assert result["dependencies"] == [{
        "key": "users", "label": "Пользователи с этой ролью", "count": 1, "blocking": True,
    }]
    assert db.query(User).count() == users_before
    assert db.query(User).filter(User.id == target.id).one().is_active is True


def test_notification_template_policy_rejects_unknown_variables_and_invalid_weekday():
    with pytest.raises(HTTPException) as variable_error:
        _validate_notification_template_policy({"text": "Задача {title}: {secret}", "repeat_frequency": None, "repeat_day": None})
    assert variable_error.value.status_code == 422
    assert variable_error.value.detail[0]["loc"][-1] == "text"

    with pytest.raises(HTTPException) as weekday_error:
        _validate_notification_template_policy({"text": "Задача {title}", "repeat_frequency": "weekly", "repeat_day": 8})
    assert weekday_error.value.status_code == 422
    assert weekday_error.value.detail[0]["loc"][-1] == "repeat_day"

    _validate_notification_template_policy({"text": "{owner}, до срока {days_left} дн.", "repeat_frequency": "weekly", "repeat_day": 5})


def test_dictionary_batch_is_validated_before_mutation_and_archives_missing_rows(db):
    role = Role(name="Full admin", admin_access="full")
    db.add(role)
    db.commit()
    actor = _admin(db, "admin@example.test", "Admin", role)
    lock_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    first = DictionaryItem(
        dict_type="priority", name="Высокий", code="HIGH", color="#ff0000",
        sort_order=0, is_active=True, version=3, lock_owner_id=actor.id, lock_until=lock_until,
    )
    second = DictionaryItem(
        dict_type="priority", name="Низкий", code="LOW", color="#00ff00",
        sort_order=1, is_active=True, version=3, lock_owner_id=actor.id, lock_until=lock_until,
    )
    db.add_all([first, second])
    db.commit()

    duplicate = DictionaryBatchUpdate(version=3, items=[
        {"id": first.id, "name": "Один", "code": "ONE", "color": "#111111", "sort_order": 0},
        {"id": second.id, "name": "один", "code": "TWO", "color": "#222222", "sort_order": 1},
    ])
    with pytest.raises(HTTPException) as error:
        save_dictionary_batch("priority", duplicate, db, actor)
    assert error.value.status_code == 422
    db.refresh(first)
    assert first.name == "Высокий"

    result = save_dictionary_batch("priority", DictionaryBatchUpdate(version=3, items=[
        {"id": first.id, "name": "Критический", "code": "CRITICAL", "color": "#111111", "sort_order": 0},
    ]), db, actor)
    db.refresh(first)
    db.refresh(second)
    assert result["version"] == 4
    assert first.name == "Критический"
    assert second.is_active is False

    workspace = get_dictionary_workspace('priority', db, actor)
    archived = next(item for item in workspace['items'] if item['id'] == second.id)
    assert archived['is_active'] is False
    assert archived['usage_count'] == 0

    restored = save_dictionary_batch('priority', DictionaryBatchUpdate(version=4, items=[
        {"id": first.id, "name": "Критический", "code": "CRITICAL", "color": "#111111", "sort_order": 0},
        {"id": second.id, "name": "Низкий", "code": "LOW", "color": "#00ff00", "sort_order": 1},
    ]), db, actor)
    db.refresh(second)
    assert restored['version'] == 5
    assert second.is_active is True


def test_full_admin_can_read_audit_log_without_mutation(client, auth_headers, db):
    before = db.query(AuditLog).count()
    response = client.get('/api/v1/admin/audit-log', headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert {'items', 'total', 'page', 'per_page', 'pages'} <= payload.keys()
    assert db.query(AuditLog).count() == before


def test_full_admin_can_read_notification_templates_without_mutation(client, auth_headers, db):
    before = db.query(NotificationTemplate).count()
    response = client.get('/api/v1/admin/notification-templates', headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert db.query(NotificationTemplate).count() == before
