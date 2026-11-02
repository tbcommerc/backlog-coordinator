"""Requirements history - search for duplicates and prior decisions.

Loaded from kb_seed/requirements_history.json. Helps the agent find similar
requirements, respect earlier accepted/rejected decisions, and reference
existing backlog items in the draft.
"""
import json
import re
from pathlib import Path

from ..config import settings
from ..kb.loader import kb


class RequirementsHistory:
    def __init__(self):
        self.items: list[dict] = []
        self._load()

    def _load(self):
        path = Path(settings.KB_DIR) / "requirements_history.json"
        if not path.exists():
            return
        try:
            self.items = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            self.items = []

    @staticmethod
    def _tokens(text: str) -> set:
        return set(re.findall(r"[а-яёa-z0-9]{3,}", (text or "").lower()))

    def find_similar(self, text: str, limit: int = 3) -> list[dict]:
        """Return similar requirements with similarity score."""
        query_tokens = self._tokens(text)
        if not query_tokens:
            return []
        scored = []
        for item in self.items:
            haystack = " ".join([
                item.get("title", ""),
                item.get("summary", ""),
                item.get("product", ""),
                item.get("module", ""),
                item.get("process", ""),
            ])
            tokens = self._tokens(haystack)
            if not tokens:
                continue
            inter = len(query_tokens & tokens)
            if inter == 0:
                continue
            score = inter / max(1.0, len(query_tokens | tokens))
            scored.append((score, item))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"score": round(s, 2), **item} for s, item in scored[:limit]]


history = RequirementsHistory()
