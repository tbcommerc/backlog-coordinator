"""Opting out of an optional dependency must not hide failures in full mode."""
import asyncio
import json
from unittest.mock import MagicMock

import pytest


@pytest.mark.parametrize("required,available,expected", [(False, False, 200), (True, True, 200), (True, False, 503)])
def test_optional_ba_dependency_is_explicit_and_default_still_checks_it(monkeypatch, tmp_path, required, available, expected):
    import database
    from config import settings, Settings
    from main import readiness_check
    import urllib.request
    assert Settings.model_fields["AGENT_READINESS_REQUIRED"].default is True
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(settings, "AGENT_READINESS_REQUIRED", required)
    monkeypatch.setattr(settings, "PRIORITISER_ENABLED", False)
    monkeypatch.setattr(settings, "AGENT_V2_ENABLED", False)
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", tmp_path)
    db = MagicMock()
    db.query.return_value.filter.return_value.count.return_value = 0
    db.query.return_value.filter.return_value.scalar.return_value = None
    monkeypatch.setattr(database, "SessionLocal", lambda: db)
    calls = []
    def open_url(url, timeout):
        calls.append(url)
        if not available:
            raise OSError("isolated dependency unavailable")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":"ready"}'
        return response
    monkeypatch.setattr(urllib.request, "urlopen", open_url)
    response = asyncio.run(readiness_check())
    assert response.status_code == expected
    assert len(calls) == int(required)
    if not required:
        assert json.loads(response.body)["checks"]["agent"] == "not_required"
