"""Service/admin authentication, independent of heavy application imports."""
import hmac
from fastapi import HTTPException
from .config import DEFAULT_SERVICE_SECRET, DEFAULT_METHODOLOGIST_SECRET


def verify_secret(provided, expected, capability, *, debug):
    if not expected or (not debug and expected in {DEFAULT_SERVICE_SECRET, DEFAULT_METHODOLOGIST_SECRET}):
        raise HTTPException(503, f"{capability} secret is not configured")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(401, "invalid service credentials")
    return capability
