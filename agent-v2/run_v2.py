"""Path setup for running the isolated Assistant V2 service."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent_v2.main import app  # noqa: E402


if __name__ == "__main__":
    import uvicorn

    from agent_v2.config import settings

    uvicorn.run(app, host="127.0.0.1", port=settings.AGENT_PORT)
