"""Existing methodologist may read history; no references/init/worker startup."""
import hmac
from fastapi import Request
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.recovery import readonly_app
from .config import get_settings
settings=get_settings()
database=settings.db_url
database=database.get_secret_value() if hasattr(database,'get_secret_value') else database
if not getattr(settings,'unit_test_mode',False) and not database.startswith(('postgresql://','postgresql+psycopg://')):
    raise ValueError('recovery_requires_existing_postgresql')
from .api.main import app as legacy_app
from .core.db import get_engine
from .core.models import Base


def create_recovery_app():
    settings=get_settings()
    # Recovery never turns an empty/debug admin secret into an authorization.
    settings.debug=False
    def authorize(request:Request):
        expected=settings.methodologist_secret
        if not expected or not hmac.compare_digest(request.headers.get('x-methodologist-secret',''),expected):
            raise AgentError('operation_forbidden',403)
    return readonly_app(legacy_app,engines=[get_engine()],before_read=authorize,
        service_id='value-priority-assessor',required_tables=tuple(Base.metadata.tables))


app=create_recovery_app()
