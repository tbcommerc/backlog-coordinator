"""
DMB Backlog - Auth Router
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from models import User
from schemas import LoginRequest, TokenResponse, RefreshRequest, UserResponse
from auth import verify_password, create_access_token, create_refresh_token, get_current_user, decode_token

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return tokens"""
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
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Create tokens
    token_data = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
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
            }
        }
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(refresh_data: RefreshRequest, db: Session = Depends(get_db)):
    """Refresh access token using refresh token"""
    payload = decode_token(refresh_data.refresh_token)
    
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    
    token_data = {"sub": str(user.id), "email": user.email}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
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
            }
        }
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
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
    )


@router.post("/logout")
async def logout():
    """Logout (client should discard tokens)"""
    return {"message": "Logged out successfully"}