"""DMB AI Business Analyst Assistant - FastAPI service entry point."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
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
    input_harness.set_domain_vocabulary(
        _vocab_stems(ontology.strong_domain_terms()),
        _vocab_stems(ontology.weak_domain_terms()),
    )
    mcp_registry.init_from_config()
    tool_registry.init_from_config()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
)

app.include_router(agent_router, prefix="/api/agent")

configure_telemetry(app, engine=session_store.engine, settings=settings)


@app.get("/api/agent/health")
def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/api/agent/ready")
def readiness_check():
    checks: dict[str, str] = {}
    ready = True
    try:
        with session_store.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["session_database"] = "ok"
    except Exception as exc:
        ready = False
        checks["session_database"] = f"error:{type(exc).__name__}"

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
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


@app.get("/api/agent/ready")
def readiness_check():
    """Verify dependencies required to accept new dialogue messages."""
    checks: dict[str, str] = {}
    ready = True
    try:
        with session_store.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["session_database"] = "ok"
    except Exception as exc:
        ready = False
        checks["session_database"] = f"error:{type(exc).__name__}"

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
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )
