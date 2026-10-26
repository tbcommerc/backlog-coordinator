from datetime import datetime, timezone
from types import SimpleNamespace
from typing import get_args, get_origin

from routers.customer_router import _task_to_customer_response, router
from schemas import CustomerTaskListResponse, CustomerTaskResponse


CUSTOMER_TASK_FIELDS = {
    "id",
    "public_id",
    "title",
    "description",
    "progress",
    "created_at",
    "updated_at",
    "team_name",
    "status_name",
    "deadline_name",
}


def _task(**overrides):
    timestamp = datetime(2026, 9, 10, 8, 30, tzinfo=timezone.utc)
    values = {
        "id": 17,
        "public_id": "TASK-000-017",
        "title": "Customer-visible task",
        "description": "Visible description",
        "progress": 35,
        "created_at": timestamp,
        "updated_at": timestamp,
        "team": SimpleNamespace(name="Delivery team"),
        "status": SimpleNamespace(name="В работе"),
        "deadline": SimpleNamespace(name="30.09.2026"),
        # These internal values must never be copied to the customer projection.
        "financial_effect": 12_000_000,
        "priority_score": 97,
        "lock_owner_id": 9,
        "lock_owner_name": "Internal user",
        "lock_until": timestamp,
        "owner_name": "Internal owner",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_customer_task_projection_contains_only_allowlisted_fields():
    projected = _task_to_customer_response(_task())

    assert isinstance(projected, CustomerTaskResponse)
    assert set(projected.model_dump()) == CUSTOMER_TASK_FIELDS
    assert projected.team_name == "Delivery team"
    assert projected.status_name == "В работе"
    assert projected.deadline_name == "30.09.2026"


def test_customer_task_projection_normalizes_legacy_null_progress():
    projected = _task_to_customer_response(_task(progress=None))

    assert projected.progress == 0


def test_customer_task_list_schema_filters_internal_task_fields():
    unsafe_item = _task_to_customer_response(_task()).model_dump()
    unsafe_item.update(
        financial_effect=12_000_000,
        priority_score=97,
        lock_owner_id=9,
        lock_owner_name="Internal user",
    )

    response = CustomerTaskListResponse(
        items=[unsafe_item],
        total=1,
        page=1,
        per_page=50,
        pages=1,
    ).model_dump()

    assert set(response["items"][0]) == CUSTOMER_TASK_FIELDS


def test_customer_routes_publish_customer_safe_response_models():
    routes = {route.path: route for route in router.routes}

    assert routes["/tasks"].response_model is CustomerTaskListResponse
    assert routes["/tasks/{task_id}"].response_model is CustomerTaskResponse
    items_annotation = CustomerTaskListResponse.model_fields["items"].annotation
    assert get_origin(items_annotation) is list
    assert get_args(items_annotation) == (CustomerTaskResponse,)
