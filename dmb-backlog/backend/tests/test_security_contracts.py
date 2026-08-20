"""Единые security-контракты ролей и объектной авторизации.

Тесты намеренно не обращаются к рабочей базе данных: матрица проверяется на чистых
policy-функциях, а наличие guards — по зарегистрированным маршрутам и исходному коду
обработчиков.
"""
import inspect
import importlib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from auth import (
    authorize_task,
    can_access_task,
    can_comment_task,
    can_edit_task,
    require_non_business_customer_access,
)
admin_router = importlib.import_module("routers.admin_router")
express_router = importlib.import_module("routers.express_router")
tasks_router = importlib.import_module("routers.tasks_router")
task_collaboration_router = importlib.import_module("routers.task_collaboration_router")
task_analytics_router = importlib.import_module("routers.task_analytics_router")
task_analytics_service = importlib.import_module("services.task_analytics")
timeline_router = importlib.import_module("routers.timeline_router")


ROLE_MATRIX = [
    # role, own team edit, other team edit, comment any task, domain API
    ("PO/PL/CL", True, False, True, True),
    ("BA/Участник команды", True, False, True, True),
    ("IT PL", True, False, True, True),
    ("Проектный офис (админ)", True, True, True, True),
    ("Администратор", True, True, True, True),
    ("Лидер трайба", False, False, True, True),
    ("Бизнес-заказчик", False, False, False, False),
    ("Наблюдатель", False, False, False, True),
]


@pytest.mark.parametrize(
    "role,can_edit_own,can_edit_other,can_comment_any,can_use_domain_api",
    ROLE_MATRIX,
)
def test_role_security_matrix(
    role,
    can_edit_own,
    can_edit_other,
    can_comment_any,
    can_use_domain_api,
):
    user = SimpleNamespace(role_name=role, team_id=10)

    assert can_edit_task(user, task_team_id=10) is can_edit_own
    assert can_edit_task(user, task_team_id=11) is can_edit_other
    assert can_comment_task(user) is can_comment_any

    if can_use_domain_api:
        assert require_non_business_customer_access(user) is user
    else:
        with pytest.raises(HTTPException) as exc_info:
            require_non_business_customer_access(user)
        assert exc_info.value.status_code == 403


@pytest.mark.parametrize("role", ["PO/PL/CL", "BA/Участник команды", "IT PL"])
def test_team_editor_cannot_bypass_scope_by_moving_task(role):
    user = SimpleNamespace(role_name=role, team_id=10)
    assert not can_edit_task(user, task_team_id=10, target_team_id=11)


TASK_OBJECT_GUARDS = [
    (tasks_router.get_task, "authorize_task"),
    (tasks_router.get_task_history, "authorize_task"),
    (tasks_router.get_task_documents, "authorize_task"),
    (task_collaboration_router.get_task_comments, "authorize_task"),
    (task_collaboration_router.get_task_attachments, "authorize_task"),
    (task_collaboration_router.download_task_attachment, "authorize_task"),
    (tasks_router.update_task, "authorize_task"),
    (task_collaboration_router.create_task_comment, "authorize_task"),
    (task_collaboration_router.upload_task_attachment, "authorize_task"),
    (task_collaboration_router.delete_task_attachment, "authorize_task"),
    (tasks_router.update_task_links, "authorize_task"),
    (tasks_router.delete_task, "authorize_task"),
    (tasks_router.bulk_action, "require_bulk_task_edit_access"),
]


@pytest.mark.parametrize("handler,guard", TASK_OBJECT_GUARDS)
def test_task_write_handler_keeps_object_guard(handler, guard):
    source = inspect.getsource(handler)
    assert guard in source, f"{handler.__name__} должен вызывать {guard}"


@pytest.mark.parametrize(
    "handler",
    [
        express_router.create_epic,
        express_router.update_epic,
        express_router.delete_epic,
        express_router.create_story,
        express_router.update_story,
        express_router.delete_story,
        express_router.update_task_effort,
        express_router.update_sort_order,
        express_router.import_task_to_estimate,
        express_router.remove_task_from_estimate,
    ],
)
def test_express_write_handler_keeps_parent_task_guard(handler):
    assert "authorize_task" in inspect.getsource(handler)


def _policy_user(role_name, team_id, backlog_dmb_access="none"):
    role = SimpleNamespace(
        backlog_dmb_access=backlog_dmb_access,
        backlog_team_access="none",
        reports_access="none",
        analytics_access="none",
        customer_access="none",
        settings_access="none",
        admin_access="none",
    )
    return SimpleNamespace(role_name=role_name, team_id=team_id, role=role)


def test_task_policy_denies_business_customer_all_backlog_actions():
    task = SimpleNamespace(team_id=10)
    user = _policy_user("Бизнес-заказчик", 10, "read_write")
    for action in ("read", "edit", "comment", "delete"):
        assert not can_access_task(action, task, user)
        with pytest.raises(HTTPException) as exc_info:
            authorize_task(action, task, user)
        assert exc_info.value.status_code == 403


def test_task_policy_read_scope_and_delete_are_explicit():
    task = SimpleNamespace(team_id=10)
    own_team_observer = _policy_user("Наблюдатель", 10)
    other_team_observer = _policy_user("Наблюдатель", 11)
    leader = _policy_user("Лидер трайба", None, "read_write")
    team_editor = _policy_user("PO/PL/CL", 10, "read")
    admin = _policy_user("Проектный офис (админ)", None, "read_write")

    assert can_access_task("read", task, own_team_observer)
    assert not can_access_task("read", task, other_team_observer)
    assert can_access_task("read", task, leader)
    assert can_access_task("comment", task, leader)
    assert not can_access_task("delete", task, team_editor)
    assert can_access_task("delete", task, admin)


def _dependency_names(route):
    return {
        dependency.call.__name__
        for dependency in route.dependant.dependencies
        if getattr(dependency, "call", None)
    }


def test_all_admin_mutations_require_permission_dependency():
    unguarded = []
    for route in admin_router.router.routes:
        if not ({"POST", "PUT", "PATCH", "DELETE"} & (route.methods or set())):
            continue
        if "permission_checker" not in _dependency_names(route):
            unguarded.append(f"{','.join(sorted(route.methods))} {route.path}")
    assert not unguarded, f"Admin write routes без permission guard: {unguarded}"


def test_timeline_mutations_are_admin_only_and_guarded():
    mutations = [
        route
        for route in timeline_router.router.routes
        if {"POST", "PUT", "PATCH", "DELETE"} & (route.methods or set())
    ]
    assert mutations
    for route in mutations:
        assert route.path.startswith("/admin")
        assert "permission_checker" in _dependency_names(route)


def test_tasks_router_has_business_customer_page_guard():
    dependency_names = {
        dependency.dependency.__name__
        for dependency in tasks_router.router.dependencies
    }
    assert "require_backlog_page_access" in dependency_names


@pytest.mark.parametrize(
    "handler,action",
    [
        (task_collaboration_router.get_task_lock, '"read"'),
        (task_collaboration_router.acquire_task_lock, '"edit"'),
        (task_collaboration_router.release_task_lock, '"edit"'),
        (task_collaboration_router.register_viewer, '"read"'),
        (task_collaboration_router.list_viewers, '"read"'),
        (task_collaboration_router.unregister_viewer, '"read"'),
    ],
)
def test_collaboration_routes_use_central_task_policy(handler, action):
    source = inspect.getsource(handler)
    assert "authorize_task" in source
    assert action in source


def test_collaboration_handlers_are_not_duplicated_in_tasks_router():
    names = {
        "get_task_lock", "acquire_task_lock", "release_task_lock",
        "register_viewer", "list_viewers", "unregister_viewer",
        "get_task_comments", "create_task_comment",
        "get_task_attachments", "upload_task_attachment",
        "download_task_attachment", "delete_task_attachment",
    }
    assert names.isdisjoint(vars(tasks_router))
    assert names <= set(vars(task_collaboration_router))


def test_task_analytics_routes_are_registered_in_dedicated_router():
    paths = {route.path for route in task_analytics_router.router.routes}
    assert paths == {
        "/analytics",
        "/analytics/effort-by-type",
        "/analytics/tribe-dashboard",
        "/analytics/lt-reports",
    }
    assert not any(route.path.startswith("/analytics") for route in tasks_router.router.routes)


def test_task_analytics_calculations_live_outside_tasks_router():
    service_functions = {
        "get_analytics",
        "get_effort_by_type",
        "get_tribe_dashboard",
        "get_lt_reports",
    }
    assert service_functions <= set(vars(task_analytics_service))
    assert service_functions.isdisjoint(vars(tasks_router))
