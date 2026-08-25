"""Path setup for running the agent as a standalone service."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent.main import app  # noqa: E402


if __name__ == "__main__":
    import uvicorn

    from agent.config import settings

    uvicorn.run(app, host="127.0.0.1", port=settings.AGENT_PORT)
