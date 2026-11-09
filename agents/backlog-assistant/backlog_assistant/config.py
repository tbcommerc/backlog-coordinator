"""Independent service configuration; the shared resolver never writes files."""
from pathlib import Path
from dmb_agent_contracts.settings import resolve_environment

SERVICE_FILE = Path(__file__).resolve().parent.parent/".env"


def environment():
    return resolve_environment("backlog-assistant", SERVICE_FILE)[0]


def configuration_sources():
    return resolve_environment("backlog-assistant", SERVICE_FILE)[1]


def service_port(name,default):
    try:
        port=int(environment().get(name,default))
    except (TypeError,ValueError):
        raise ValueError("invalid_"+name) from None
    if not 1<=port<=65535:
        raise ValueError("invalid_"+name)
    return port
