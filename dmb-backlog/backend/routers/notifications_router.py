"""
DMB Backlog - Notifications Router
API for reading, managing, and configuring notifications
"""
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import User, UserNotificationPreference
from schemas import (
    NotificationResponse, NotificationListResponse,
    UnreadCountResponse, NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
)
from auth import get_current_user
from notifications import (
    get_notifications, get_unread_count,
    get_notification_summary,
    mark_read, mark_all_read, dismiss_notification,
    resolve_notification,
    DEFAULT_PREFERENCES,
)

router = APIRouter()


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    category: Optional[str] = None,
    unread_only: bool = False,
    importance: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items, total = get_notifications(
        db, current_user.id,
        category=category,
        unread_only=unread_only,
        importance=importance,
        page=page,
        per_page=per_page,
    )
    return NotificationListResponse(
        items=[NotificationResponse.model_validate(n) for n in items],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return UnreadCountResponse(count=get_unread_count(db, current_user.id))


@router.get("/notifications/summary")
def notification_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_notification_summary(db, current_user.id)


@router.put("/notifications/read")
def read_notifications(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids = data.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="ids is required")
    mark_read(db, ids, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.put("/notifications/read-all")
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mark_all_read(db, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dismiss_notification(db, notification_id, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.put("/notifications/{notification_id}/resolve")
def resolve_user_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resolve_notification(db, notification_id, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.get("/notifications/preferences", response_model=NotificationPreferencesResponse)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pref = db.query(UserNotificationPreference).filter(
        UserNotificationPreference.user_id == current_user.id
    ).first()
    if not pref:
        return NotificationPreferencesResponse(preferences=DEFAULT_PREFERENCES.copy())
    try:
        prefs = json.loads(pref.preferences)
    except (json.JSONDecodeError, TypeError):
        prefs = DEFAULT_PREFERENCES.copy()
    return NotificationPreferencesResponse(preferences=prefs)


@router.put("/notifications/preferences", response_model=NotificationPreferencesResponse)
def update_preferences(
    data: NotificationPreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pref = db.query(UserNotificationPreference).filter(
        UserNotificationPreference.user_id == current_user.id
    ).first()
    if not pref:
        pref = UserNotificationPreference(
            user_id=current_user.id,
            preferences=json.dumps(data.preferences),
        )
        db.add(pref)
    else:
        pref.preferences = json.dumps(data.preferences)
    db.commit()
    db.refresh(pref)
    try:
        prefs = json.loads(pref.preferences)
    except (json.JSONDecodeError, TypeError):
        prefs = DEFAULT_PREFERENCES.copy()
    return NotificationPreferencesResponse(preferences=prefs)
