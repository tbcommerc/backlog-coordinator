"""Integrations stub - Jira / Confluence / internal requirements systems.

Placed as a separate module so the agent can later export drafts to external
systems. In the MVP the real creation is performed by the DMB Backlog proxy
(creates a Task); these stubs document the intended contract.
"""
from .review import required_reviewers, review_status_for


def create_issue(draft: dict, connector: str = "jira") -> dict:
    """Stub: export draft to Jira/Confluence. Returns a fake issue key."""
    return {
        "connector": connector,
        "issue_key": f"DMB-REQ-{draft.get('id', '').replace('DRAFT-', '')}",
        "status": review_status_for(draft),
        "reviewers": required_reviewers(draft),
        "created": True,
    }


def publish_draft(draft: dict, space: str = "DMB") -> dict:
    """Stub: publish draft to Confluence page."""
    return {"page": f"{space}:{draft.get('id', 'draft')}", "published": True}
