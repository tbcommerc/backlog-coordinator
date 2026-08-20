from types import SimpleNamespace

from auth import create_refresh_token, decode_token
from refresh_sessions import hash_refresh_token


def test_refresh_token_contains_rotation_identifiers():
    token = create_refresh_token(
        {"sub": "42", "email": "user@example.com"},
        jti="token-id",
        family_id="family-id",
    )
    payload = decode_token(token)
    assert payload["type"] == "refresh"
    assert payload["jti"] == "token-id"
    assert payload["family_id"] == "family-id"


def test_refresh_token_hash_does_not_contain_token():
    token = "signed-refresh-token"
    token_hash = hash_refresh_token(token)
    assert token not in token_hash
    assert len(token_hash) == 64
