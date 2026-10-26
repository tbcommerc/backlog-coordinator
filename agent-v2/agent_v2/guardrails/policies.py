"""Policy harness - what the agent is allowed to do.

Only requirement collection for the investment deals platform, only approved
roles, only curated knowledge sources. Refusal templates per policy level.
"""
from ..context import UserContext

# Roles allowed to use the assistant (DMB role names).
ALLOWED_ROLES = ("бизнес-заказчик", "администратор", "po/pl/cl", "лидер трайба", "it pl")


def check_role_allowed(ctx: UserContext) -> tuple[bool, str]:
    """Return (allowed, reason). Business customers may use the assistant."""
    if not ctx:
        return True, ""
    role = (ctx.role_name or "").strip().lower()
    access = (ctx.customer_access or "").lower()
    if role in ("администратор", "лидер трайба", "it pl", "po/pl/cl"):
        return True, ""
    if role == "бизнес-заказчик" and "read" in access:
        return True, ""
    return False, "У вашей роли нет доступа к ассистенту по требованиям."


REFUSAL_DOMAIN = (
    "Я помогаю только с формированием требований к платформе сопровождения "
    "инвестиционных сделок: доработки, изменения процессов, проблемы в текущем "
    "использовании. Если ваш запрос связан с её развитием — опишите, пожалуйста, "
    "проблему или желаемое изменение."
)

REFUSAL_DOMAIN_FINAL = (
    "К сожалению, это выходит за рамки моей области. Я могу помочь только "
    "с требованиями к платформе сопровождения инвестиционных сделок."
)

REFUSAL_SENSITIVE = "Я не могу обрабатывать этот запрос в рамках текущего сценария."
