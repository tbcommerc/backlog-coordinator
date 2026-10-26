"""Request-bound gateway attestation. mTLS is enforced by the ASGI TLS server."""
import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(method, path, body, key=""):
    return hashlib.sha256(method.encode() + b"\n" + path.encode() + b"\n" + key.encode() + b"\n" + body).hexdigest()


def sign(secret, subject, method, path, body=b"", key="", *, issuer="dmb", audience="backlog-assistant", ttl=30):
    now = int(time.time())
    claims = dict(issuer=issuer, audience=audience, subject_ref=subject, issued_at=now,
                  expires_at=now + ttl, request_digest=digest(method, path, body, key), nonce=str(uuid.uuid4()))
    payload = base64.urlsafe_b64encode(canonical(claims).encode()).decode().rstrip("=")
    return payload + "." + hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class Identity:
    issuer: str
    subject: str

    @property
    def owner(self):
        return canonical([self.issuer, self.subject])


def verify(secret, token, method, path, body, key="", *, issuer="dmb", audience="backlog-assistant"):
    try:
        payload, signature = token.split(".")
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if len(secret) < 32 or not hmac.compare_digest(signature, expected):
            raise ValueError()
        c = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        now = time.time()
        if (c["issuer"] != issuer or c["audience"] != audience or not c["subject_ref"]
                or c["issued_at"] > now + 5 or c["expires_at"] <= now
                or not 0 < c["expires_at"] - c["issued_at"] <= 60
                or c["request_digest"] != digest(method, path, body, key)):
            raise ValueError()
        uuid.UUID(c["nonce"])
        return Identity(c["issuer"], c["subject_ref"]), c
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid_attestation") from exc
