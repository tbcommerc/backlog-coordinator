"""
DMB Backlog - Users Router
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import User
from schemas import UserCreate, UserUpdate, UserResponse, UserDirectoryResponse
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
        result.append(UserDirectoryResponse(
            id=user.id,
            name=user.name,
            position=user.position,
            team_id=user.team_id,
            team_name=user.team_rel.name if user.team_rel else None
        ))
    return {"items": result, "total": total, "page": page, "per_page": per_page}


@router.get("/{user_id}", response_model=UserDirectoryResponse)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get user by ID"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserDirectoryResponse(
        id=user.id,
        name=user.name,
        position=user.position,
        team_id=user.team_id,
        team_name=user.team_rel.name if user.team_rel else None
    )


# Historical mutation paths are explicitly closed; no partial-admin bypass.
@router.api_route("/", methods=["POST"], include_in_schema=False)
@router.api_route("/{user_id}", methods=["PUT", "PATCH", "DELETE"], include_in_schema=False)
def legacy_mutation(user_id: int = 0, current_user: User = Depends(get_current_user)):
    raise HTTPException(410, "USE_ADMIN_ACCOUNT_API")
