"""Read policies shared by the assistant and existing customer endpoints."""
from sqlalchemy import false, or_
from auth import is_customer_portal_only, task_read_scope_clause, get_request_review_access
from models import Task, RequirementRequest


def customer_tasks_clause(user):
    return Task.business_customer_id == user.business_customer_id if user.business_customer_id is not None else false()


def customer_task_allowed(db, user, task):
    if not task or task.is_deleted:
        return False
    return bool((user.business_customer_id is not None and task.business_customer_id == user.business_customer_id)
        or db.query(RequirementRequest.id).filter(RequirementRequest.task_id == task.id,
            RequirementRequest.user_id == user.id, RequirementRequest.is_deleted.is_(False)).first())


def task_clause(user):
    return customer_tasks_clause(user) if is_customer_portal_only(user) else task_read_scope_clause(user, Task)


def request_clause(user):
    scope = get_request_review_access(user)
    own = RequirementRequest.user_id == user.id
    if scope == "all" and not is_customer_portal_only(user):
        return True
    if scope == "team" and user.team_id is not None and not is_customer_portal_only(user):
        return or_(own, RequirementRequest.team_id == user.team_id)
    return own
