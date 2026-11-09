"""DMB AI Business Analyst Assistant - FastAPI service entry point."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .api.router import router as agent_router
from .config import settings, validate_runtime_settings
from .kb.ontology import stem as stem_word
from .session import session_store
from .telemetry import configure_telemetry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _vocab_stems(terms: list[str]) -> list[str]:
    """Stem ontology terms so inflected message words match domain vocabulary."""
    out = []
    for term in terms:
        for token in term.lower().split():
            s = stem_word(token)
            if len(s) >= 4 and s not in out:
                out.append(s)
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .guardrails import input_harness
    from .kb.ontology import ontology
    from .mcp.registry import registry as mcp_registry
    from .tools.base import registry as tool_registry

    validate_runtime_settings()
    if not settings.UNIT_TEST_MODE:
        from dmb_agent_contracts.limiter import require_runtime_limiter
        require_runtime_limiter()
        from dmb_agent_contracts.run_migration import validate as validate_run_schema
        validate_run_schema(session_store.engine, allowed_existing=("sessions", "message_receipts", "agent_runtime_bindings", "agent_runtime_migrations"))
        if settings.EXECUTION_BACKEND == "opencode":
            from dmb_agent_contracts.runtime_records import validate as validate_runtime_bindings
            from dmb_agent_contracts.remote_configuration import RemoteProfile
            validate_runtime_bindings(session_store.engine)
            RemoteProfile.from_settings(settings).preflight()
    input_harness.set_domain_vocabulary(
        _vocab_stems(ontology.strong_domain_terms()),
        _vocab_stems(ontology.weak_domain_terms()),
    )
    mcp_registry.init_from_config()
    tool_registry.init_from_config()
    from .runs import worker
    if not settings.UNIT_TEST_MODE:
        worker.start()
    try:
        yield
    finally:
        worker.stop()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
)

app.include_router(agent_router, prefix="/api/agent")

from .runs import api as run_api
app.include_router(run_api)
from dmb_agent_contracts.run_api import install_error_handlers
from dmb_agent_contracts.body_limit import BodyLimit
install_error_handlers(app)
app.add_middleware(BodyLimit)
from dmb_agent_contracts.run_metrics import install as install_run_metrics
from .runs import store as run_store, authenticate as run_authenticate
install_run_metrics(app, run_store, run_authenticate)

configure_telemetry(app, engine=session_store.engine, settings=settings)


@app.get("/health/live")
@app.get("/api/agent/health")
def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/health/ready")
@app.get("/api/agent/ready")
def readiness_check():
    """Verify dependencies required to accept new dialogue messages."""
    checks: dict[str, str] = {}
    ready = True
    try:
        validate_runtime_settings()
        checks["profile"] = "ok"
    except Exception:
        ready = False
        checks["profile"] = "configuration_invalid"
    try:
        with session_store.engine.connect() as connection:
            connection.execute(text("SELECT session_id FROM sessions LIMIT 1"))
            connection.execute(text("SELECT message_id FROM message_receipts LIMIT 1"))
            connection.execute(text("SELECT id FROM agent_runs LIMIT 1"))
            connection.execute(text("SELECT run_id FROM agent_run_events LIMIT 1"))
        checks["session_database"] = "ok"
    except Exception as exc:
        ready = False
        checks["session_database"] = f"error:{type(exc).__name__}"

    if not settings.UNIT_TEST_MODE:
        try:
            from dmb_agent_contracts.limiter import require_runtime_limiter
            require_runtime_limiter()
            checks["operation_limiter"]="ok"
        except Exception:
            ready=False
            checks["operation_limiter"]="unavailable"

    provider = settings.LLM_PROVIDER.strip().lower()
    if provider == "mock" and not settings.DEBUG:
        ready = False
        checks["llm"] = "mock_forbidden"
    elif provider == "openai_compat" and not settings.OPENAI_API_KEY:
        ready = False
        checks["llm"] = "credentials_missing"
    else:
        checks["llm"] = "configured"

    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready"},
    )
