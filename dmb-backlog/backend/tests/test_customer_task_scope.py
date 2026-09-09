from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from auth import create_access_token
from models import BusinessCustomer, RequirementRequest, Role, Task, Team, User
from routers.agent_router import (
    ASSIGNABLE_REQUEST_ANALYST_ROLES,
    AgentRequestStatusUpdate,
    _deadline_is_overdue,
    _request_available_actions,
    agent_request_status,
    agent_team_ba,
    can_review_request,
)
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


def test_request_owner_without_review_capability_cannot_claim_review():
    request = SimpleNamespace(id=17, user_id=5, team_id=10, is_deleted=False)

    class QueryStub:
        def filter(self, *args):
            return self

        def first(self):
            return request

    db = SimpleNamespace(query=lambda _model: QueryStub())
    role = SimpleNamespace(review_access="none", customer_portal_only=False)
    owner = SimpleNamespace(
        id=5,
        role=role,
        role_name="Владелец запроса",
        team_id=10,
    )

    with pytest.raises(HTTPException) as exc_info:
        agent_request_status(
            request.id,
            AgentRequestStatusUpdate(status="in_review", version=0),
            db=db,
            current_user=owner,
        )

    assert exc_info.value.status_code == 403


def test_review_deadline_and_available_actions_are_server_decisions():
    reviewer = SimpleNamespace(
        id=5,
        role_name="BA/Участник команды",
        role=SimpleNamespace(review_access="team", customer_portal_only=False),
        team_id=10,
    )
    own_request = SimpleNamespace(status="in_review", reviewer_id=5, team_id=10)
    colleague_request = SimpleNamespace(status="in_review", reviewer_id=6, team_id=10)
    unowned_request = SimpleNamespace(status="in_review", reviewer_id=None, team_id=10)

    assert _deadline_is_overdue("2020-01-01", "in_review") is True
    assert _deadline_is_overdue("2020-01-01", "in_progress") is False
    assert _request_available_actions(own_request, reviewer) == ["approve", "return", "reject", "release"]
    assert _request_available_actions(colleague_request, reviewer) == []
    assert _request_available_actions(unowned_request, reviewer) == []


def test_in_progress_rejects_non_ba_assignee_before_mutating_request():
    request = SimpleNamespace(
        id=17,
        user_id=8,
        team_id=10,
        is_deleted=False,
        status="in_review",
        version=0,
        reviewer_id=5,
    )

    class QueryStub:
        def __init__(self, model):
            self.model = model

        def join(self, *args):
            return self

        def filter(self, *args):
            return self

        def first(self):
            return request if self.model is RequirementRequest else None

    db = SimpleNamespace(query=lambda model: QueryStub(model))
    reviewer = SimpleNamespace(
        id=5,
        role_name="BA/Участник команды",
        role=SimpleNamespace(review_access="team", customer_portal_only=False),
        team_id=10,
    )

    with pytest.raises(HTTPException) as exc_info:
        agent_request_status(
            request.id,
            AgentRequestStatusUpdate(status="in_progress", version=0, assignee_id=99),
            db=db,
            current_user=reviewer,
        )

    assert exc_info.value.status_code == 422
    assert "бизнес-аналитика" in exc_info.value.detail
    assert request.status == "in_review"
    assert ASSIGNABLE_REQUEST_ANALYST_ROLES == {"ba/участник команды", "ba/бизнес-аналитик"}


def test_ba_directory_rejects_user_outside_review_scope_before_query():
    class DbMustNotBeQueried:
        def query(self, *_args):
            raise AssertionError("BA directory must not be queried without review access")

    outsider = SimpleNamespace(
        id=8,
        role_name="Бизнес-заказчик",
        role=SimpleNamespace(review_access="none", customer_portal_only=True),
        team_id=11,
    )

    with pytest.raises(HTTPException) as exc_info:
        agent_team_ba(team_id=10, db=DbMustNotBeQueried(), current_user=outsider)

    assert exc_info.value.status_code == 403
