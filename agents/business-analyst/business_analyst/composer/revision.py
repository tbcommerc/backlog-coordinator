"""Stable identity of the exact draft snapshot approved by a customer."""
import hashlib
import json


def draft_fingerprint(draft: dict) -> str:
    canonical = json.dumps(draft, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
