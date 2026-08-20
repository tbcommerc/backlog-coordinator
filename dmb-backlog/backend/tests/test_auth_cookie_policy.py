from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from config import settings
from routers.auth_router import REFRESH_COOKIE_NAME, _require_trusted_origin, _set_refresh_cookie


def _request(origin=None, base_url="https://dmb.example/"):
    headers = {"origin": origin} if origin else {}
    return SimpleNamespace(headers=headers, base_url=base_url)


def test_production_rejects_missing_or_untrusted_origin(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["https://dmb.example"])
    with pytest.raises(HTTPException):
        _require_trusted_origin(_request())
    with pytest.raises(HTTPException):
        _require_trusted_origin(_request("https://evil.example"))


def test_production_accepts_configured_origin(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["https://dmb.example"])
    _require_trusted_origin(_request("https://dmb.example"))


def test_production_rejects_http_origin(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["http://dmb.example"])
    with pytest.raises(HTTPException, match="HTTPS"):
        _require_trusted_origin(_request("http://dmb.example", base_url="http://dmb.example/"))


def test_refresh_cookie_is_httponly_strict_and_secure_in_production(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    response = Response()
    _set_refresh_cookie(response, "secret-token")
    cookie = response.headers["set-cookie"]
    assert f"{REFRESH_COOKIE_NAME}=secret-token" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Secure" in cookie
