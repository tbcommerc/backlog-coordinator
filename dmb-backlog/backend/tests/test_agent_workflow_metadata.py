"""Read-only/mocked workflow checks; no users, teams or dictionaries are written."""
from types import SimpleNamespace
from unittest.mock import MagicMock

from routers.agent_router import _agent_request_context, _commit_resubmitted_request, _render_request


def test_restored_request_includes_actual_route_and_review_comment():
    request = SimpleNamespace(id=12, status="returned", version=3, team_id=7,
                              team=SimpleNamespace(name="Расчёты"), reject_reason="Уточните критерии")
    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.first.return_value = request
    context = _agent_request_context(db, 101, "session")
    assert context == {
        "request_id": 12, "request_status": "returned", "request_version": 3,
        "request_team_id": 7, "request_team_name": "Расчёты", "review_comment": "Уточните критерии",
        "request_url": "#/customer/request/12",
    }
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_resubmission_response_exposes_the_new_version():
    db = MagicMock()
    request = SimpleNamespace(id=12, status="submitted", version=4, draft={"title": "Уточнение"}, agent_session_id="session")
    result = _commit_resubmitted_request(db, request, {"action": "sent"}, 101)
    assert result["request_id"] == 12
    assert result["request_version"] == 4
    assert result["request_status"] == "submitted"
    assert result["resubmitted"] is True
    db.commit.assert_called_once()


def test_request_description_keeps_process_and_priority():
    description = _render_request({"process": "Сверка расчётов", "priority": "Высокий"})
    assert "**Бизнес-процесс:** Сверка расчётов" in description
    assert "**Приоритет:** Высокий" in description
