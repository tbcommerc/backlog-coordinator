"""Read saved extraction results without model/limiter/worker startup."""
from sqlalchemy import create_engine
from dmb_agent_contracts.recovery import readonly_app
from .api import create_app
from .config import Settings
from .store import Store


def create_recovery_app(settings=None,engine=None):
    settings=settings or Settings()
    if engine is None:
        database=settings.database_url.get_secret_value()
        if not database.startswith(('postgresql://','postgresql+psycopg://')):
            raise ValueError('recovery_requires_existing_postgresql')
        engine=create_engine(database,pool_pre_ping=True)
    legacy=create_app(settings,engine)
    legacy.state.engine=engine
    legacy.state.store=Store(engine,retention=settings.retention_policy())
    return readonly_app(legacy,engines=[engine],service_id='meeting-analyzer',required_tables=('meeting_runs','meeting_events'))


app=create_recovery_app()
