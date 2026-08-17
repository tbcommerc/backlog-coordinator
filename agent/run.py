"""Path setup for running the agent as a standalone service."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent.main import app  # noqa: E402
