from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from auth import create_access_token
from models import BusinessCustomer, Role, Task, Team, User
from routers.agent_router import AgentRequestStatusUpdate, agent_request_status, can_review_request
from routers.customer_router import get_customer_tasks
from main import app


def test_customer_tasks_are_filtered_by_linked_business_customer(db):
    team = Team(name="Customer scope team")
    customer = BusinessCustomer(name="Customer A")
    other_customer = BusinessCustomer(name="Customer B")
    db.add_all([team, customer, other_customer])
    db.flush()

    user = User(
        email="customer-scope@example.test",
        password_hash="not-used",
        name="Customer User",
        business_customer_id=customer.id,
    )
    db.add_all([
        user,
        Task(team_id=team.id, title="Visible", business_customer_id=customer.id),
        Task(team_id=team.id, title="Hidden", business_customer_id=other_customer.id),
    ])
    db.commit()

    result = get_customer_tasks(page=1, per_page=50, db=db, current_user=user)

    assert result.total == 1
    assert [task.title for task in result.items] == ["Visible"]


def test_customer_without_mapping_sees_no_tasks(db):
    user = User(
        email="unmapped-customer@example.test",
        password_hash="not-used",
        name="Unmapped Customer",
    )
    db.add(user)
    db.commit()

    result = get_customer_tasks(page=1, per_page=50, db=db, current_user=user)

    assert result.total == 0
    assert result.items == []


def test_business_customer_token_is_limited_to_customer_and_agent_apis(client, db):
    role = Role(name="Бизнес-заказчик")
    customer = BusinessCustomer(name="API Customer")
    db.add_all([role, customer])
    db.flush()
    user = User(
        email="api-customer@example.test",
        password_hash="not-used",
        name="API Customer User",
        role_id=role.id,
        business_customer_id=customer.id,
    )
    db.add(user)
    db.commit()
    token = create_access_token({"sub": str(user.id), "email": user.email})
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/v1/customer/tasks", headers=headers).status_code == 200
    assert client.get("/api/v1/teams", headers=headers).status_code == 403


@pytest.mark.parametrize(
    "target_status",
    ["draft", "submitted", "in_review", "in_progress", "approved", "rejected", "returned"],
)
def test_business_customer_cannot_change_agent_request_status(target_status):
    user = SimpleNamespace(role_name="Бизнес-заказчик")
    body = AgentRequestStatusUpdate(
        status=target_status,
        version=0,
        reject_reason="Причина" if target_status == "rejected" else "",
    )

    with pytest.raises(HTTPException) as exc_info:
        agent_request_status(1, body, db=None, current_user=user)

    assert exc_info.value.status_code == 403


def test_legacy_customer_chat_route_is_removed():
    assert not any(
        route.path == "/api/v1/customer/chat" and "POST" in (route.methods or set())
        for route in app.routes
    )


@pytest.mark.parametrize("role_name", ["BA/Участник команды", "BA/Бизнес-аналитик", "PO/PL/CL", "Лидер трайба"])
def test_team_request_reviewers_can_review_own_team(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=10)
    assert can_review_request(user, request_team_id=10)
    assert not can_review_request(user, request_team_id=11)


@pytest.mark.parametrize("role_name", ["Проектный офис (админ)", "Администратор"])
def test_project_office_can_review_all_requests(role_name):
    user = SimpleNamespace(role_name=role_name, team_id=None)
    assert can_review_request(user, request_team_id=10)
    assert can_review_request(user, request_team_id=11)


def test_explicit_review_access_survives_role_rename():
    role = SimpleNamespace(review_access="all", customer_portal_only=False)
    user = SimpleNamespace(role_name="Переименованная роль", role=role, team_id=None)
    assert can_review_request(user, request_team_id=10)
    assert can_review_request(user, request_team_id=11)
