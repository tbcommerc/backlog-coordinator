from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from enum import Enum
from typing import Any


DIGEST_ALGORITHM = "sha256:jcs-v1"


def canonical_json(value: Any) -> bytes:
    def encode(item: Any) -> Any:
        if isinstance(item, (datetime, date)):
            return item.isoformat()
        if isinstance(item, Enum):
            return item.value
        if hasattr(item, "model_dump"):
            return item.model_dump(mode="json")
        raise TypeError(f"Unsupported canonical JSON value: {type(item).__name__}")

    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
        default=encode,
    ).encode("utf-8")


def digest_json(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value)).hexdigest()


def digest_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()
