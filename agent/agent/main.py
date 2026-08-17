"""DMB AI Business Analyst Assistant - FastAPI service entry point."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.router import router as agent_router
from .config import settings
from .kb.ontology import stem as stem_word

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
