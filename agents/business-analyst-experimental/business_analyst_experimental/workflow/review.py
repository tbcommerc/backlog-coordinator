"""Review workflow - human-in-the-loop guarantee.

The agent never approves a requirement. It produces a Draft and determines
which reviewers are needed (PO/BA, plus compliance/architect when flagged).
The actual task creation happens in the DMB Backlog integration.
"""
from typing import Optional

REVIEW_STATUSES = ["Draft", "Needs Review", "Pending PO/BA", "Approved", "Rejected"]


def required_reviewers(draft: dict) -> list[str]:
    """Determine required reviewers from draft flags."""
    reviewers = ["PO", "BA"]
    flags = draft.get("regulatory_flags") or []
    if any("комплаенс" in (f or "").lower() for f in flags):
        reviewers.append("Комплаенс")
    product = (draft.get("product") or "").lower()
    if "структурн" in product:
        reviewers.append("Комплаенс")
    if any("интеграц" in (d or "").lower() for d in (draft.get("data_integrations") or [])):
        reviewers.append("Архитектор")
    return reviewers


def review_status_for(draft: dict) -> str:
    return "Draft" if draft.get("completeness_score", 0) < 60 else "Needs Review"
