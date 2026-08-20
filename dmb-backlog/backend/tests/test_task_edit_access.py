from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from auth import (
    can_comment_task,
    can_edit_task,
    require_backlog_page_access,
    require_bulk_task_edit_access,
    require_non_business_customer_access,
    require_task_comment_access,
    require_task_edit_access,
)


@pytest.mark.parametrize("role_name", ["PO/PL/CL", "BA/Участник команды", "IT PL"])
def test_team_editor_can_edit_own_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    assert can_edit_task(user, task_team_id=10)


@pytest.mark.parametrize("role_name", ["PO/PL/CL", "BA/Участник команды", "IT PL"])
def test_team_editor_cannot_edit_other_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    assert not can_edit_task(user, task_team_id=11)


@pytest.mark.parametrize("role_name", ["PO/PL/CL", "BA/Участник команды", "IT PL"])
def test_team_editor_cannot_move_task_to_other_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    assert not can_edit_task(user, task_team_id=10, target_team_id=11)


@pytest.mark.parametrize("role_name", ["Проектный офис (админ)", "Администратор"])
def test_project_office_admin_can_edit_any_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=None)
    assert can_edit_task(user, task_team_id=11, target_team_id=12)


@pytest.mark.parametrize("role_name", ["Лидер трайба", "Бизнес-заказчик", "", None])
def test_other_roles_cannot_edit_tasks(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_task_edit_access(user, task_team_id=10)
    assert exc_info.value.status_code == 403


def test_bulk_team_editor_can_edit_only_own_team():
    user = SimpleNamespace(role_name="PO/PL/CL", team_id=10)
    require_bulk_task_edit_access(user, [10, 10])


def test_bulk_request_is_rejected_if_one_task_is_from_other_team():
    user = SimpleNamespace(role_name="IT PL", team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_bulk_task_edit_access(user, [10, 11])
    assert exc_info.value.status_code == 403


def test_bulk_team_editor_cannot_move_tasks_to_other_team():
    user = SimpleNamespace(role_name="BA/Участник команды", team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_bulk_task_edit_access(user, [10], target_team_id=11)
    assert exc_info.value.status_code == 403


def test_bulk_delete_is_forbidden_for_team_editor():
    user = SimpleNamespace(role_name="PO/PL/CL", team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_bulk_task_edit_access(user, [10], is_delete=True)
    assert exc_info.value.status_code == 403


def test_bulk_admin_can_edit_and_delete_any_team():
    user = SimpleNamespace(role_name="Проектный офис (админ)", team_id=None)
    require_bulk_task_edit_access(user, [10, 11], target_team_id=12)
    require_bulk_task_edit_access(user, [10, 11], is_delete=True)


@pytest.mark.parametrize("operation", ["update_links", "upload_attachment", "delete_attachment"])
def test_task_subresource_write_uses_same_team_policy(operation):
    user = SimpleNamespace(role_name="PO/PL/CL", team_id=10)
    require_task_edit_access(user, task_team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_task_edit_access(user, task_team_id=11)
    assert exc_info.value.status_code == 403, operation


@pytest.mark.parametrize("entity", ["task effort", "epic", "story", "express import"])
def test_quick_estimate_write_uses_same_team_policy(entity):
    editor = SimpleNamespace(role_name="IT PL", team_id=10)
    require_task_edit_access(editor, task_team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_task_edit_access(editor, task_team_id=11)
    assert exc_info.value.status_code == 403, entity


@pytest.mark.parametrize(
    "role_name",
    [
        "PO/PL/CL",
        "BA/Участник команды",
        "IT PL",
        "Проектный офис (админ)",
        "Администратор",
        "Лидер трайба",
    ],
)
def test_comment_roles_can_comment_tasks_from_any_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    assert can_comment_task(user)
    require_task_comment_access(user)


@pytest.mark.parametrize("role_name", ["Бизнес-заказчик", "Наблюдатель", "", None])
def test_other_roles_cannot_comment_tasks(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    with pytest.raises(HTTPException) as exc_info:
        require_task_comment_access(user)
    assert exc_info.value.status_code == 403


def test_business_customer_cannot_access_backlog_api():
    user = SimpleNamespace(role_name="Бизнес-заказчик")
    with pytest.raises(HTTPException) as exc_info:
        require_backlog_page_access(user)
    assert exc_info.value.status_code == 403


def test_non_customer_can_access_backlog_api():
    user = SimpleNamespace(role_name="Лидер трайба")
    assert require_backlog_page_access(user) is user


def test_business_customer_cannot_access_other_domain_apis():
    user = SimpleNamespace(role_name="Бизнес-заказчик")
    with pytest.raises(HTTPException) as exc_info:
        require_non_business_customer_access(user)
    assert exc_info.value.status_code == 403
