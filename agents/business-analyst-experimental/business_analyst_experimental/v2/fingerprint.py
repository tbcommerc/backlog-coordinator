"""Canonical fingerprints for V2 artifacts and linked snapshots."""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any


def canonical_fingerprint(value: Any) -> str:
    payload = value.model_dump(mode="json") if hasattr(value, "model_dump") else deepcopy(value)
    if isinstance(payload, dict):
        payload.pop("fingerprint", None)
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
