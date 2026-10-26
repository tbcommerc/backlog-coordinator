"""Synthetic hashes only; never writes accounts or connects to a database."""
from passlib.hash import bcrypt
from config import settings
from services.credentials import verify_password, needs_rehash, hash_password


def test_legacy_requires_explicit_opt_in(monkeypatch):
    encoded = bcrypt.using(rounds=4).hash('  old password  ')
    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', False)
    assert not verify_password('  old password  ', encoded)
    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', True)
    assert verify_password('  old password  ', encoded)
    assert not verify_password('old password', encoded)
    assert not verify_password('incorrect', encoded)
    assert not needs_rehash(encoded)


def test_legacy_preserves_original_unicode(monkeypatch):
    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', True)
    encoded = bcrypt.using(rounds=4).hash('е\u0308 old password')
    assert verify_password('е\u0308 old password', encoded)
    assert not verify_password('ё old password', encoded)
    assert not verify_password('anything', '$2b$12$broken')
    assert not verify_password('anything', None)


def test_new_passwords_remain_argon2(monkeypatch):
    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', True)
    encoded = hash_password('new synthetic password')
    assert encoded.startswith('$argon2id$')
    assert verify_password('new synthetic password', encoded)
    assert not verify_password('wrong', encoded)


def test_login_issues_session_with_legacy_password_without_rehash(monkeypatch):
    import asyncio
    import uuid
    from types import SimpleNamespace
    from unittest.mock import MagicMock, AsyncMock
    from starlette.requests import Request
    from starlette.responses import Response
    from importlib import import_module
    auth_router = import_module('routers.auth_router')
    from services import auth_limits, auth_sessions
    from schemas import LoginRequest
    from auth import decode_token

    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', True)
    encoded = bcrypt.using(rounds=4).hash('synthetic old password')
    user = SimpleNamespace(id=123, email='synthetic@example.com', login='synthetic',
        login_normalized='synthetic@example.com', password_hash=encoded, auth_version=1, is_active=True, credential_state='ready',
        role=None, role_id=None, role_name=None, team_id=None, team_rel=None, name='Synthetic',
        can_edit=False, can_delete=False, can_export=False)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    from datetime import timedelta
    timestamp = auth_sessions.now()
    session = SimpleNamespace(id=str(uuid.uuid4()), last_activity_at=timestamp,
        absolute_expires_at=timestamp + timedelta(hours=8))
    monkeypatch.setattr(auth_limits, 'limit', AsyncMock())
    monkeypatch.setattr(auth_sessions, 'lock_user', lambda *args: user)
    monkeypatch.setattr(auth_sessions, 'new_session', lambda *args: session)
    monkeypatch.setattr(auth_sessions, 'event', lambda *args, **kwargs: None)
    monkeypatch.setattr(auth_router, 'issue_refresh_session', lambda *args: ('synthetic-refresh', None))
    request = Request({'type':'http', 'method':'POST', 'path':'/api/v1/auth/login',
        'headers':[(b'origin', b'http://127.0.0.1:8000')], 'client':('127.0.0.1', 1234)})
    response = Response()
    result = asyncio.run(auth_router.login(request, response,
        LoginRequest(login=user.email, password='synthetic old password'), db))
    assert decode_token(result.access_token)['sid'] == session.id
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert user.password_hash == encoded
    db.commit.assert_called_once()


def test_legacy_never_accepts_input_after_72_bytes(monkeypatch):
    monkeypatch.setattr(settings, 'AUTH_ALLOW_LEGACY_PASSWORDS', True)
    encoded = bcrypt.using(rounds=4).hash('x' * 72)
    assert verify_password('x' * 72, encoded)
    assert not verify_password('x' * 72 + 'different suffix', encoded)
