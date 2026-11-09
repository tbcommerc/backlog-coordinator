"""Explicit degraded entry point: legacy document history, no worker/model startup."""
import hmac
from fastapi import Request
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.recovery import ReadOnlyStoreView,readonly_app,load_without_singleton,guard_engine
from .config import settings
if not getattr(settings,'UNIT_TEST_MODE',False) and not settings.SESSION_DATABASE_URL.startswith(('postgresql://','postgresql+psycopg://')):
    raise ValueError('recovery_requires_existing_postgresql')
from contextvars import ContextVar
import threading
from sqlalchemy import create_engine,MetaData,Table


def existing_store(module):
    store=module.SessionStore.__new__(module.SessionStore)
    store.database_url=settings.SESSION_DATABASE_URL
    store.path=settings.SESSION_DB
    store._lock=threading.RLock()
    store._session_locks={}
    options={'check_same_thread':False} if store.database_url.startswith('sqlite') else {'connect_timeout':3}
    store._engine=create_engine(store.database_url,pool_pre_ping=True,connect_args=options)
    guard_engine(store._engine)
    store._transaction_connection=ContextVar('recovery_store_transaction',default=None)
    store._metadata=MetaData()
    store._sessions=Table('sessions',store._metadata,autoload_with=store._engine)
    store._message_receipts=Table('message_receipts',store._metadata,autoload_with=store._engine)
    if (not {'session_id','user_id','state_json','updated_at','last_message_at','version'}<=set(store._sessions.c.keys()) or
            not {'session_id','message_id','response_json','created_at'}<=set(store._message_receipts.c.keys())):
        raise RuntimeError('recovery_schema_incompatible')
    return store


load_without_singleton('business_analyst_experimental.session','session_store',existing_store)
from .main import app as legacy_app
from .api import router as api


def create_recovery_app():
    original=api._orchestrator.store
    view=ReadOnlyStoreView(original)
    api._orchestrator.store=view
    prefix='/api/agent-v2'
    def authorize(request:Request):
        if not api.settings.AGENT_SECRET or not hmac.compare_digest(
                request.headers.get('x-agent-secret',''),api.settings.AGENT_SECRET):
            raise AgentError('service_auth_required',401)
        if not request.url.path.startswith(prefix+'/session'):return
        actor=request.headers.get('x-actor-ref','')
        if request.headers.get('x-agent-caller')!='dmb' or not actor.isascii() or not actor.isdigit() or len(actor)>18:
            raise AgentError('operation_forbidden',403)
        if request.url.path==prefix+'/sessions':
            if request.query_params.get('user_id')!=str(int(actor)):
                raise AgentError('operation_forbidden',403)
        else:
            identity=request.url.path[len(prefix+'/session/'):].split('/')[0]
            state=original.get(identity)
            if state is None or state.user_id!=int(actor):raise AgentError('run_not_found',404)
    return readonly_app(legacy_app,engines=[original.engine],before_read=authorize,
        service_id='business-analyst-experimental',store_views=[view],required_tables=('sessions','message_receipts'),
        health_paths=('/health/live','/health/ready','/api/agent-v2/health','/api/agent-v2/ready'))


app=create_recovery_app()
