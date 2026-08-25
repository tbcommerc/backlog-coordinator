"""
DMB Backlog - Auth Router
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from models import User
from schemas import LoginRequest, TokenResponse, UserResponse
from auth import verify_password, create_access_token, get_current_user, get_request_review_access, is_customer_portal_only, get_task_action_scope, can_make_pip_decision
from rate_limit import get_rate_limiter, rate_limit_key
from refresh_sessions import issue_refresh_session, revoke_refresh_session, rotate_refresh_session, cleanup_expired_sessions
from config import settings

router = APIRouter()
REFRESH_COOKIE_NAME = "dmb_refresh"


def _require_trusted_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin and settings.DEBUG:
        return
    same_origin = str(request.base_url).rstrip("/")
    allowed = {value.rstrip("/") for value in settings.CORS_ORIGINS} | {same_origin}
    if not origin or origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted request origin")
    if not settings.DEBUG and not origin.lower().startswith("https://"):
        raise HTTPException(status_code=403, detail="HTTPS origin required")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="strict",
        path="/api/v1/auth",
    )


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, response: Response, login_data: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return tokens"""
    _require_trusted_origin(request)
    client_ip = request.client.host if request.client else "unknown"
    limiter = get_rate_limiter()
    decisions = [
        await limiter.check(rate_limit_key("login-ip", client_ip), 5, 60),
        await limiter.check(rate_limit_key("login-account", login_data.email), 5, 60),
    ]
    blocked = next((decision for decision in decisions if not decision.allowed), None)
    if blocked:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(blocked.retry_after)},
        )
    user = db.query(User).filter(User.email == login_data.email).first()
    
    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated"
        )
    
    # Update last login and create the server-side refresh session atomically.
    user.last_login = datetime.utcnow()
    cleanup_expired_sessions(db)
    refresh_token, _session = issue_refresh_session(db, user)
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    
    # Create tokens
    token_data = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        expires_in=3600,
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.name if user.role else None,
            "role_id": user.role_id,
            "team_id": user.team_id,
            "team_name": user.team_rel.name if user.team_rel else None,
            "can_edit": user.can_edit,
            "can_delete": user.can_delete,
            "can_export": user.can_export,
            "permissions": {
                "backlog_dmb": user.role.backlog_dmb_access if user.role else "none",
                "backlog_team": user.role.backlog_team_access if user.role else "none",
                "reports": user.role.reports_access if user.role else "none",
                "analytics": user.role.analytics_access if user.role else "none",
                "customer": user.role.customer_access if user.role else "none",
                "settings": user.role.settings_access if user.role else "none",
                "admin": user.role.admin_access if user.role else "none",
                "customer_portal_mode": "only" if is_customer_portal_only(user) else "standard",
                "review": get_request_review_access(user),
                "task_edit": get_task_action_scope(user, "edit"),
                "task_comment": get_task_action_scope(user, "comment"),
                "task_delete": get_task_action_scope(user, "delete"),
                "pip_decision": "available" if can_make_pip_decision(user) else "none",
            }
        }
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """Refresh access token using refresh token"""
    _require_trusted_origin(request)
    client_ip = request.client.host if request.client else "unknown"
    decision = await get_rate_limiter().check(rate_limit_key("refresh-ip", client_ip), 10, 60)
    if not decision.allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(decision.retry_after)},
        )
    current_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if not current_refresh:
        raise HTTPException(status_code=401, detail="Refresh cookie not found")
    user, refresh_token = rotate_refresh_session(db, current_refresh)
    _set_refresh_cookie(response, refresh_token)
    
    token_data = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        expires_in=3600,
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.name if user.role else None,
            "role_id": user.role_id,
            "team_id": user.team_id,
            "team_name": user.team_rel.name if user.team_rel else None,
            "can_edit": user.can_edit,
            "can_delete": user.can_delete,
            "can_export": user.can_export,
            "permissions": {
                "backlog_dmb": user.role.backlog_dmb_access if user.role else "none",
                "backlog_team": user.role.backlog_team_access if user.role else "none",
                "reports": user.role.reports_access if user.role else "none",
                "analytics": user.role.analytics_access if user.role else "none",
                "customer": user.role.customer_access if user.role else "none",
                "settings": user.role.settings_access if user.role else "none",
                "admin": user.role.admin_access if user.role else "none",
                "customer_portal_mode": "only" if is_customer_portal_only(user) else "standard",
                "review": get_request_review_access(user),
                "task_edit": get_task_action_scope(user, "edit"),
                "task_comment": get_task_action_scope(user, "comment"),
                "task_delete": get_task_action_scope(user, "delete"),
                "pip_decision": "available" if can_make_pip_decision(user) else "none",
            }
        }
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
    return UserResponse(
        id=current_user.id,
        login=current_user.login,
        email=current_user.email,
        name=current_user.name,
        position=current_user.position,
        team_id=current_user.team_id,
        role_id=current_user.role_id,
        is_active=current_user.is_active,
        last_login=current_user.last_login,
        created_at=current_user.created_at,
        role_name=current_user.role.name if current_user.role else None,
        team_name=current_user.team_rel.name if current_user.team_rel else None,
        can_edit=current_user.can_edit,
        can_delete=current_user.can_delete,
        can_export=current_user.can_export,
        permissions={
            "backlog_dmb": current_user.role.backlog_dmb_access if current_user.role else "none",
            "backlog_team": current_user.role.backlog_team_access if current_user.role else "none",
            "reports": current_user.role.reports_access if current_user.role else "none",
            "analytics": current_user.role.analytics_access if current_user.role else "none",
            "customer": current_user.role.customer_access if current_user.role else "none",
            "settings": current_user.role.settings_access if current_user.role else "none",
            "admin": current_user.role.admin_access if current_user.role else "none",
            "customer_portal_mode": "only" if is_customer_portal_only(current_user) else "standard",
            "review": get_request_review_access(current_user),
            "task_edit": get_task_action_scope(current_user, "edit"),
            "task_comment": get_task_action_scope(current_user, "comment"),
            "task_delete": get_task_action_scope(current_user, "delete"),
            "pip_decision": "available" if can_make_pip_decision(current_user) else "none",
        },
    )


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Revoke the current server-side refresh session."""
    _require_trusted_origin(request)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        revoke_refresh_session(db, refresh_token)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Logged out successfully"}
