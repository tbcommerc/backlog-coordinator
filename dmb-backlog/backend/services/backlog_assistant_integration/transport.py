import json
import ssl
import urllib.request
import urllib.error
from fastapi import HTTPException
from config import settings
from .ledger import sign


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def call(user, method, path, body=None, key="", proof=""):
    url = settings.BACKLOG_ASSISTANT_SERVICE_URL.rstrip("/")
    if not url.startswith("https://") or len(settings.BACKLOG_ASSISTANT_GATEWAY_SECRET) < 32:
        raise HTTPException(503, "assistant_configuration_incomplete")
    tls = ssl.create_default_context(cafile=settings.BACKLOG_ASSISTANT_TLS_CA)
    tls.load_cert_chain(settings.BACKLOG_ASSISTANT_TLS_CERT, settings.BACKLOG_ASSISTANT_TLS_KEY)
    raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
    token = sign(str(user.id), method, path, raw, key)
    req = urllib.request.Request(url+path, data=raw if body is not None else None, method=method,
        headers={"Content-Type": "application/json", "X-Gateway-Attestation": token,
                 "Idempotency-Key": key, "X-Read-Proof": proof})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=tls))
    try:
        with opener.open(req, timeout=5) as response:
            return json.loads(response.read(2_000_000))
    except urllib.error.HTTPError as exc:
        # Never pass raw internal errors, URLs, stack traces or runtime identifiers.
        raise HTTPException(exc.code if exc.code in {401, 403, 404, 409, 422, 429} else 503, "assistant_request_failed")
    except (OSError, ValueError, urllib.error.URLError):
        raise HTTPException(503, "assistant_unavailable")
