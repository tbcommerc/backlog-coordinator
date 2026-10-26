"""Versioned V2 prompt layers and their immutable content hash."""
from __future__ import annotations

import hashlib
from functools import lru_cache

from ..config import settings
from .models import ProductMode


@lru_cache(maxsize=8)
def load_prompt_set(product_mode: str, operator_role: str) -> tuple[str, str]:
    try:
        mode = ProductMode(product_mode)
    except ValueError as exc:
        raise ValueError("unsupported_product_mode") from exc
    role = (operator_role or "").upper()
    if role not in {"BA", "PO"}:
        raise ValueError("unsupported_operator_role")
    files = [
        settings.PROMPTS_DIR / "base_guard.md",
        settings.PROMPTS_DIR / "operator_context.md",
        settings.PROMPTS_DIR / f"{mode.value}.md",
    ]
    layers = [path.read_text(encoding="utf-8").strip() for path in files]
    layers[1] = layers[1].replace("{{OPERATOR_ROLE}}", role)
    prompt = "\n\n---\n\n".join(layers)
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
    return prompt, f"{settings.PROMPT_SET_VERSION}+sha256:{digest}"
