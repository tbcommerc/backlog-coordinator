"""
DMB Backlog - Authentication & Authorization
"""
from datetime import datetime, timedelta
from typing import Literal, Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from config import settings
from database import get_db
from models import User, Role

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


TASK_TEAM_EDITOR_ROLES = {
    "po/pl/cl",
    "ba/участник команды",
    "it pl",
}
TASK_GLOBAL_EDITOR_ROLES = {
    "проектный офис (админ)",
    # Совместимость с текущей seed-ролью до её переименования.
    "администратор",
}
TASK_COMMENT_ROLES = TASK_TEAM_EDITOR_ROLES | TASK_GLOBAL_EDITOR_ROLES | {
    "лидер трайба",
}
BUSINESS_CUSTOMER_ROLES = {"бизнес-заказчик"}
TaskAction = Literal["read", "edit", "comment", "delete"]


def _task_team_id(task) -> Optional[int]:
    return getattr(task, "team_id", None)


def can_access_task(action: TaskAction, task, user: User, target_team_id: Optional[int] = None) -> bool:
    """Единая policy-функция объектного доступа к задаче."""
    role_name = (user.role_name or "").strip().casefold()
    task_team_id = _task_team_id(task)
    if role_name in BUSINESS_CUSTOMER_ROLES:
        return False
    if action == "read":
        return check_permission(user, "backlog_dmb", "read") or (
            user.team_id is not None and task_team_id == user.team_id
        )
    if action == "edit":
        return can_edit_task(user, task_team_id, target_team_id)
    if action == "comment":
        return can_comment_task(user)
    if action == "delete":
        return role_name in TASK_GLOBAL_EDITOR_ROLES
    return False


def authorize_task(action: TaskAction, task, user: User, target_team_id: Optional[int] = None) -> None:
    """Отклонить действие, не разрешённое единой task-policy."""
    if not can_access_task(action, task, user, target_team_id):
        messages = {
            "read": "Недостаточно прав для просмотра этой задачи",
            "edit": "Недостаточно прав для редактирования этой задачи",
            "comment": "Недостаточно прав для комментирования задач",
            "delete": "Удаление задач доступно только проектному офису (админу)",
        }
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=messages[action])


def can_edit_task(user: User, task_team_id: Optional[int], target_team_id: Optional[int] = None) -> bool:
    """Проверить право пользователя редактировать задачу.

    Командные редакторы могут менять только задачи своей команды и не могут
    переносить их в другую команду. Проектный офис (админ) не ограничен командой.
    """
    role_name = (user.role_name or "").strip().casefold()
    if role_name in TASK_GLOBAL_EDITOR_ROLES:
        return True
    if role_name not in TASK_TEAM_EDITOR_ROLES:
        return False
    if user.team_id is None or task_team_id != user.team_id:
        return False
    return target_team_id is None or target_team_id == user.team_id


def is_task_global_editor(user: User) -> bool:
    """Пользователь может редактировать задачи без ограничения по команде."""
    return (user.role_name or "").strip().casefold() in TASK_GLOBAL_EDITOR_ROLES


def require_task_edit_access(user: User, task_team_id: Optional[int], target_team_id: Optional[int] = None) -> None:
    """Отклонить изменение задачи, если роль или область команды не разрешены."""
    scope = type("TaskScope", (), {"team_id": task_team_id})()
    authorize_task("edit", scope, user, target_team_id)


def can_comment_task(user: User) -> bool:
    """Проверить право комментировать любую задачу независимо от команды."""
    return (user.role_name or "").strip().casefold() in TASK_COMMENT_ROLES


def require_task_comment_access(user: User) -> None:
    """Отклонить комментарий для ролей без явно выданного права."""
    scope = type("TaskScope", (), {"team_id": None})()
    authorize_task("comment", scope, user)


def require_bulk_task_edit_access(
    user: User,
    task_team_ids: list[Optional[int]],
    target_team_id: Optional[int] = None,
    is_delete: bool = False,
) -> None:
    """Атомарно проверить область массового изменения задач."""
    if is_delete and not is_task_global_editor(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Массовое удаление задач доступно только проектному офису (админу)",
        )
    if any(not can_edit_task(user, team_id, target_team_id) for team_id in task_team_ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Массовая операция содержит задачи недоступной команды",
        )


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict, jti: Optional[str] = None, family_id: Optional[str] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    if jti:
        to_encode["jti"] = jti
    if family_id:
        to_encode["family_id"] = family_id
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload is None or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    
    user = db.query(User).filter(User.id == int(user_id), User.is_active == True).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    
    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get current user if authenticated, None otherwise"""
    if credentials is None:
        return None
    try:
        return get_current_user(credentials, db)
    except HTTPException:
        return None


def require_non_business_customer_access(current_user: User = Depends(get_current_user)) -> User:
    """Закрыть предметный API для роли, ограниченной customer/agent API."""
    if (current_user.role_name or "").strip().casefold() in BUSINESS_CUSTOMER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Бизнес-заказчику доступен только портал «Мои задачи» и ИИ-ассистент",
        )
    return current_user


def require_backlog_page_access(current_user: User = Depends(get_current_user)) -> User:
    """Обратная совместимость для зависимости основного API задач."""
    return require_non_business_customer_access(current_user)


def require_role(allowed_roles: list):
    """Dependency factory: require user to have one of allowed roles"""
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role and current_user.role.name not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    return role_checker


def check_permission(user: User, permission: str, level: str = "read") -> bool:
    """Check if user has specific permission at required level"""
    if not user.role:
        return False
    
    role = user.role
    
    permission_map = {
        "backlog_dmb": role.backlog_dmb_access,
        "backlog_team": role.backlog_team_access,
        "reports": role.reports_access,
        "analytics": role.analytics_access,
        "customer": role.customer_access,
        "settings": role.settings_access,
        "admin": role.admin_access,
    }
    
    user_access = permission_map.get(permission, "none")
    
    # Access hierarchy
    hierarchy = {
        "none": 0,
        "read": 1,
        "read_own": 1,
        "write_own": 2,
        "read_write": 2,
        "read_all": 2,
        "write_all": 3,
        "available": 1,
        "partial": 2,
        "full": 3,
    }
    
    return hierarchy.get(user_access, 0) >= hierarchy.get(level, 0)


def require_permission(permission: str, level: str = "read"):
    """Dependency factory: require specific permission"""
    def permission_checker(current_user: User = Depends(get_current_user)):
        if not check_permission(current_user, permission, level):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission} ({level})"
            )
        return current_user
    return permission_checker
