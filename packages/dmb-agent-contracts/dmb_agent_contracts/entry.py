"""Container entry: prepare the declared coordinator before domain imports."""
import argparse
import os
import runpy
import time

from .limiter_cli import prepare
from .model import AgentError


PREFIXES = {"business-analyst": "AGENT_", "business-analyst-experimental": "AGENT_V2_",
    "meeting-analyzer": "MEETING_ANALYZER_", "backlog-assistant": "BACKLOG_ASSISTANT_",
    "value-priority-assessor": "PRIORITISER_"}


def prepare_runtime():
    service = os.environ.get("DMB_AGENT_SERVICE_ID")
    if service not in PREFIXES:
        raise AgentError("limiter_service_required", 503)
    mode = os.environ.get("DMB_AGENT_LIMITER_MODE", "standalone")
    if mode not in ("global", "standalone"):
        raise AgentError("limiter_configuration_invalid", 503)
    url = os.environ.get("DMB_AGENT_LIMITER_REDIS_URL") or os.environ.get(PREFIXES[service]+"OPERATION_REDIS_URL")
    directory = os.environ.get("DMB_AGENT_LIMITER_STATE_DIR")
    if not url or not directory:
        raise AgentError("limiter_configuration_invalid", 503)
    namespace = os.environ.get("DMB_AGENT_LIMITER_NAMESPACE")
    if mode == "global" and not namespace:
        raise AgentError("limiter_configuration_invalid", 503)
    namespace = namespace or service+"-standalone"
    deadline = time.monotonic()+10
    while True:
        try:
            profile = prepare(directory, namespace, mode, url)
            break
        except AgentError as error:
            if error.code != "limiter_initialization_busy" or time.monotonic() >= deadline:
                raise
            time.sleep(.1)
    os.environ.update(DMB_AGENT_LIMITER_MODE=mode, DMB_AGENT_LIMITER_REDIS_URL=url,
        DMB_AGENT_LIMITER_NAMESPACE=namespace, DMB_AGENT_LIMITER_EPOCH=profile["epoch"],
        DMB_AGENT_LIMITER_JOURNAL_DIR=profile["journal_dir"], DMB_AGENT_REQUIRE_LIMITER="true")
    return profile


def main():
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--app")
    target.add_argument("--module")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    prepare_runtime()
    if args.module:
        runpy.run_module(args.module, run_name="__main__")
    else:
        if not args.port:
            raise AgentError("service_port_required", 503)
        from .serve import serve
        serve(args.app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
