"""UserContext - minimal user data passed from DMB Backlog (RBAC).

The agent receives only the minimum necessary user context. Access decisions
are enforced in the DMB proxy; the agent additionally checks allowed roles.
"""
from typing import Optional
from pydantic import BaseModel


class UserContext(BaseModel):
    user_id: int
    name: str = ""
    email: str = ""
    role_name: str = ""          # e.g. "Бизнес-заказчик"
    customer_access: str = ""    # e.g. "read_write"
    team_name: str = ""
    department: str = ""
    is_ba: bool = False          # adapts language style (business vs BA/tech)


def style_for(ctx: Optional[UserContext]) -> str:
    """Return dialogue style key: 'business' or 'technical'."""
    if ctx and (ctx.is_ba or "аналитик" in (ctx.role_name or "").lower()
                or "архитектор" in (ctx.role_name or "").lower()
                or "pl" in (ctx.role_name or "").lower()):
        return "technical"
    return "business"
