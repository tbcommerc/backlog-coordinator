"""
DMB Backlog - Users Router
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import User
from schemas import UserCreate, UserUpdate, UserResponse
from auth import get_current_user, require_permission, get_password_hash

router = APIRouter()


@router.get("/")
def get_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all users with pagination"""
    query = db.query(User).filter(User.is_active == True)
    total = query.count()
    users = query.offset((page - 1) * per_page).limit(per_page).all()
    result = []
    for user in users:
        result.append(UserResponse(
            id=user.id,
            login=user.login,
            email=user.email,
            name=user.name,
            position=user.position,
            team_id=user.team_id,
            role_id=user.role_id,
            is_active=user.is_active,
            last_login=user.last_login,
            created_at=user.created_at,
            role_name=user.role.name if user.role else None,
            team_name=user.team_rel.name if user.team_rel else None
        ))
    return {"items": result, "total": total, "page": page, "per_page": per_page}


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get user by ID"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        position=user.position,
        team_id=user.team_id,
        role_id=user.role_id,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
        role_name=user.role.name if user.role else None,
        team_name=user.team_rel.name if user.team_rel else None
    )


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Create new user"""
    # Check if email already exists
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(
        email=user_data.email,
        login=user_data.login,
        password_hash=get_password_hash(user_data.password),
        name=user_data.name,
        position=user_data.position,
        team_id=user_data.team_id,
        role_id=user_data.role_id,
        is_active=user_data.is_active
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        position=user.position,
        team_id=user.team_id,
        role_id=user.role_id,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
        role_name=user.role.name if user.role else None,
        team_name=user.team_rel.name if user.team_rel else None
    )


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "partial"))
):
    """Update user"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    for field, value in user_data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        position=user.position,
        team_id=user.team_id,
        role_id=user.role_id,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
        role_name=user.role.name if user.role else None,
        team_name=user.team_rel.name if user.team_rel else None
    )


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    """Deactivate user (soft delete)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_active = False
    db.commit()
    return {"message": "User deactivated"}
