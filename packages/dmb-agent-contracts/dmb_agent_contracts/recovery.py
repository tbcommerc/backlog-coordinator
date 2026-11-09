"""Explicit read-only recovery shell; no product models or migration/worker startup."""
from contextvars import ContextVar
from copy import deepcopy
from contextlib import contextmanager
import inspect
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import event, text, inspect as inspect_database

from .model import AgentError
from .run_api import install_error_handlers

_snapshots=ContextVar('agent_recovery_request_snapshots',default=None)


def load_without_singleton(module_name,singleton_name,factory,*,source_path=None):
    """Disable exactly one old import-time constructor in a pinned module.

    The service supplies a reflection-only factory. All business functions and
    codecs retain their original source; no migration/seed can run implicitly.
    """
    import ast
    import importlib.util
    from pathlib import Path
    import sys
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec=(importlib.util.spec_from_file_location(module_name,source_path) if source_path is not None
          else importlib.util.find_spec(module_name))
    if spec is None or spec.origin is None:
        raise RuntimeError('recovery_legacy_module_missing')
    source=Path(spec.origin).read_text(encoding='utf-8-sig')
    tree=ast.parse(source,filename=spec.origin)
    assignments=[node for node in tree.body if isinstance(node,ast.Assign) and
        any(isinstance(target,ast.Name) and target.id==singleton_name for target in node.targets)]
    if len(assignments)!=1 or not isinstance(assignments[0].value,ast.Call):
        raise RuntimeError('recovery_legacy_bootstrap_unrecognized')
    assignments[0].value=ast.Constant(None)
    ast.fix_missing_locations(tree)
    module=importlib.util.module_from_spec(spec)
    sys.modules[module_name]=module
    try:
        exec(compile(tree,spec.origin,'exec'),module.__dict__)
        setattr(module,singleton_name,factory(module))
    except BaseException:
        sys.modules.pop(module_name,None)
        raise
    return module


class ReadOnlyStoreView:
    """Stage derived display changes in request memory, never in domain storage."""
    def __init__(self,store):
        self.original=store

    def get(self,identity):
        snapshots=_snapshots.get()
        key=(id(self),identity)
        if snapshots is not None and key in snapshots:return snapshots[key]
        value=deepcopy(self.original.get(identity))
        if snapshots is not None:snapshots[key]=value
        return value

    def save(self,value):
        snapshots=_snapshots.get()
        if snapshots is None:raise AgentError('recovery_read_only',503)
        snapshots[(id(self),value.session_id)]=deepcopy(value)

    @contextmanager
    def serialized(self,*args,**options):
        # A single persisted snapshot is read atomically; there is no write CAS.
        yield

    def __getattr__(self,name):
        return getattr(self.original,name)


def guard_engine(engine,*,auth_nonce_tables=()):
    """Only auth replay bookkeeping may write; never relax production metadata."""
    allowed=frozenset(auth_nonce_tables)
    if any(not re.fullmatch('[a-z_][a-z0-9_]*',name) for name in allowed):
        raise ValueError('invalid_recovery_auth_nonce_table')
    def before(connection,cursor,statement,parameters,context,many):
        if any(getattr(context,flag,False) for flag in ('isinsert','isupdate','isdelete','isddl')):
            compiled=getattr(context,'compiled',None)
            table=getattr(getattr(compiled,'statement',None),'table',None)
            if table is not None and table.name in allowed and not getattr(context,'isddl',False):return
            raise AgentError('recovery_read_only',503)
        # Raw SQL cannot disguise a write behind WITH, comments or a DDL call.
        keywords=re.sub(r"'(?:(?:'')|[^'])*'|\"(?:(?:\"\")|[^\"])*\"|--[^\n]*|/\*.*?\*/",' ',statement,flags=re.DOTALL)
        # Legacy history queries may lock their selected row; this is not DML.
        keywords=re.sub(r'\bFOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)(?:\s+OF\s+[a-z_][a-z0-9_., ]*)?(?:\s+NOWAIT|\s+SKIP\s+LOCKED)?\s*;?\s*$',' ',keywords,flags=re.IGNORECASE)
        if re.search(r'\b(insert|update|delete|create|alter|drop|truncate|copy|call|do|grant|revoke|vacuum|refresh|reindex)\b',
                     keywords,re.IGNORECASE):
            raise AgentError('recovery_read_only',503)
    event.listen(engine,'before_cursor_execute',before)
    return before


def readonly_app(legacy_app,*,engines,before_read=None,service_id,auth_nonce_tables=(),
                 store_views=(),required_tables=(),health_paths=('/health','/health/live','/health/ready')):
    """Reuse legacy GET contracts while excluding its startup and all mutations.

    Each service supplies its original authorization and ownership checks.
    Auth nonce writes are explicit technical exceptions for attested GETs.
    """
    engines=tuple(engines)
    for engine in engines:guard_engine(engine,auth_nonce_tables=auth_nonce_tables)
    app=FastAPI(title=service_id+' — read-only recovery',version='1.0',docs_url=None,redoc_url=None)
    app.router.routes.extend(route for route in legacy_app.routes
        if getattr(route,'methods',set()) & {'GET','HEAD'} and
        route.path not in {'/openapi.json','/docs','/docs/oauth2-redirect','/redoc'})
    app.exception_handlers.update(legacy_app.exception_handlers)
    app.state._state.update(legacy_app.state._state)
    install_error_handlers(app)

    @app.middleware('http')
    async def recover(request:Request,call_next):
        if request.method not in {'GET','HEAD'}:
            return JSONResponse({'error':{'code':'recovery_read_only',
                'message':'Сервис временно доступен только для просмотра истории.',
                'retryable':False,'details':{}}},status_code=503)
        if request.url.path in health_paths:
            try:
                for engine in engines:
                    with engine.connect() as connection:
                        connection.execute(text('SELECT 1'))
                        if not set(required_tables)<=set(inspect_database(connection).get_table_names()):
                            raise ValueError('recovery_schema_incompatible')
            except Exception:
                return JSONResponse({'status':'not_ready','mode':'recovery_read_only'},status_code=503)
            return JSONResponse({'status':'ready','mode':'recovery_read_only','service_id':service_id})
        token=_snapshots.set({})
        try:
            if before_read is not None:
                value=before_read(request)
                if inspect.isawaitable(value):await value
            response=await call_next(request)
            response.headers['X-Agent-Recovery-Mode']='read-only'
            return response
        except AgentError as error:
            return JSONResponse({'error':{'code':error.code,'message':error.code,
                'retryable':False,'details':{}}},status_code=error.status)
        finally:
            _snapshots.reset(token)
    app.state.recovery_store_views=tuple(store_views)
    return app
