"""Resolve explicit aliases without copying secrets between files."""
from urllib.parse import urlsplit
from .model import AgentError


def resolve_alias(values, canonical, *aliases, default=None):
    from .settings import select_alias
    selected = select_alias(values, [canonical, *aliases])
    return selected if selected is not None else ("default", default)


def validate_go_url(url):
    try:
        parsed = urlsplit(url)
        allowed = (parsed.scheme == "https" and parsed.hostname == "opencode.ai"
            and parsed.port in (None,443) and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment
            and parsed.path.rstrip("/") in ("/zen/go/v1","/inference/go/openai/v1"))
    except (ValueError,TypeError,AttributeError):
        allowed = False
    if not allowed:
        raise AgentError("model_origin_not_allowed",422) from None
    return url.rstrip("/")
