"""Login-only profiles must not require an email address."""
from agent.api.router import _to_ctx


def test_explicit_null_optional_context_strings():
    context = _to_ctx({"user_id": 25, "email": None, "name": None, "team_name": None,
                       "department": None, "role_name": None, "customer_access": None})
    assert context.user_id == 25
    assert context.email == context.name == context.team_name == ""


def test_missing_context_is_optional():
    assert _to_ctx(None) is None
    assert _to_ctx({"user_id": 25}).email == ""
