"""Local process control with no management listener or credentials in argv."""
import argparse
import json
import os
import re
import threading
from pathlib import Path


def stopping_event():
    event = threading.Event()
    name = os.environ.get("DMB_AGENT_CONTROL_FILE")
    if not name:
        return event
    path = Path(name)
    if not path.is_absolute() or path.parent.name != ".runtime" or not re.fullmatch(r"[a-z0-9-]+-[0-9a-f]{32}\.stop", path.name):
        raise ValueError("invalid_process_control_path")
    def watch():
        while not event.wait(.1):
            try:
                if path.is_file() and json.loads(path.read_text(encoding="utf-8-sig")).get("action") == "shutdown":
                    event.set()
                    return
            except (OSError, ValueError, AttributeError):
                pass
    threading.Thread(target=watch, daemon=True, name="agent-process-control").start()
    return event


def serve(app, *, host="127.0.0.1", port=9000, **options):
    import uvicorn
    from uvicorn.importer import import_from_string
    from .limiter_health import LimiterReadiness
    if isinstance(app, str):
        app = import_from_string(app)
    app = LimiterReadiness(app)
    event = stopping_event()
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port,
        timeout_graceful_shutdown=10, **options))
    def watch():
        event.wait()
        server.should_exit = True
    threading.Thread(target=watch, daemon=True, name="agent-server-drain").start()
    server.run()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    serve(args.app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
