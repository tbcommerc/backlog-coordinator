"""Protected aggregate metrics without conversation, actor or model payload labels."""
from fastapi import Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select

from .run_store import runs


def install(app, store, authenticate):
    @app.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
    def metrics(actor=Depends(authenticate)):
        with store.engine.connect() as connection:
            counts = dict(connection.execute(select(runs.c.status, func.count()).group_by(runs.c.status)).all())
        lines = ["# HELP agent_runs Durable operations by current state.", "# TYPE agent_runs gauge"]
        for state in ("queued", "preparing", "running", "validating", "completed", "failed", "cancelled", "interrupted"):
            lines.append('agent_runs{status="'+state+'"} '+str(counts.get(state, 0)))
        return "\n".join(lines)+"\n"
