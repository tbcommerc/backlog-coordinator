from urllib.error import HTTPError

import pytest
from dmb_agent_contracts.model import AgentError
from business_analyst.meeting_task_extractor import extraction_failure_detail


@pytest.mark.parametrize("provider,expected", [
    ("provider_auth_failed", "meeting_ai_auth"),
    ("provider_quota_exhausted", "meeting_ai_quota"),
    ("operation_deadline_exceeded", "interrupted"),
    ("local_budget_exceeded", "operation_limit"),
    ("invalid_model_result", "invalid_result"),
])
def test_typed_failures_preserve_only_safe_categories(provider, expected):
    result = extraction_failure_detail(AgentError(provider))
    assert result["code"] == expected
    assert result["message"]


@pytest.mark.parametrize("status,expected", [(401, "meeting_ai_auth"), (403, "meeting_ai_auth"), (429, "meeting_ai_quota")])
def test_legacy_http_failures_keep_same_safe_categories(status, expected):
    error = HTTPError("https://private.invalid", status, "private provider detail", {}, None)
    result = extraction_failure_detail(error)
    assert result["code"] == expected
    assert "private" not in str(result)


def test_unknown_error_is_not_echoed():
    assert extraction_failure_detail(RuntimeError("private transcript")) is None
