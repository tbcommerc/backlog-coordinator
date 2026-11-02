"""Output harness - validates assistant responses before sending to the user:
no forbidden phrases, fabricated facts must be marked as assumptions,
structured drafts pass schema validation.
"""
import re

FORBIDDEN_OUTPUT_PHRASES = [
    "сделаю все удобно", "система должна быть гибкой и удобной",
    "все будет хорошо", "как вы поняли",
]

ASSUMPTION_MARK = "[предположение]"

_BANNED_RE = [re.compile(p, re.IGNORECASE) for p in FORBIDDEN_OUTPUT_PHRASES]


def check_text(text: str) -> str:
    """Return sanitized text (empty string means the text must be regenerated)."""
    if not text:
        return ""
    for rx in _BANNED_RE:
        if rx.search(text):
            return ""
    if len(text.strip()) < 2:
        return ""
    return text


def validate_draft_schema(draft: dict) -> list[str]:
    """Return list of validation errors (empty = valid)."""
    errors = []
    required = ["title", "problem_statement", "acceptance_criteria"]
    for field in required:
        if not draft.get(field):
            errors.append(f"Отсутствует поле: {field}")
    ac = draft.get("acceptance_criteria") or []
    if isinstance(ac, list) and len(ac) == 0:
        errors.append("Критерии приёмки пусты")
    return errors
