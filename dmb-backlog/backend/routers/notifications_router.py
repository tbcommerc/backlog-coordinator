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
    NotificationSnapshotResponse, NotificationUxEventRequest,
    UnreadCountResponse, NotificationPreferencesResponse,
    NotificationPreferencesUpdate, NotificationIdsRequest,
)
from auth import get_current_user
from notifications import (
    get_notifications, get_unread_count,
    get_notification_snapshot, get_notification_summary, notification_target,
    mark_read, mark_unread, mark_all_read, dismiss_notification, restore_notification,
    DEFAULT_PREFERENCES,
)
from metrics import inc_counter, observe_histogram

router = APIRouter()


def _notification_response(notification) -> NotificationResponse:
    response = NotificationResponse.model_validate(notification)
    target = notification_target(notification)
    return NotificationResponse.model_validate({
        **response.model_dump(),
        "action_url": f"#{target['url']}",
        "target": target,
    })


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    category: Optional[str] = None,
    unread_only: bool = False,
    importance: Optional[str] = None,
    resolved: Optional[bool] = None,
    requires_action: bool = False,
    search: Optional[str] = None,
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
        resolved=resolved,
        requires_action=requires_action,
        search=search,
        page=page,
        per_page=per_page,
        current_user=current_user,
    )
    return NotificationListResponse(
        items=[_notification_response(n) for n in items],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/notifications/snapshot", response_model=NotificationSnapshotResponse)
def notification_snapshot(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    snapshot = get_notification_snapshot(db, current_user.id, current_user)
    return NotificationSnapshotResponse(
        revision=snapshot["revision"],
        summary=snapshot["summary"],
        recent_items=[_notification_response(item) for item in snapshot["recent_items"]],
        recent_total=snapshot["recent_total"],
        action_items=[_notification_response(item) for item in snapshot["action_items"]],
        action_total=snapshot["action_total"],
    )


@router.post("/notifications/ux-events", status_code=status.HTTP_202_ACCEPTED)
def notification_ux_event(
    data: NotificationUxEventRequest,
    current_user: User = Depends(get_current_user),
):
    labels = {
        "event": data.event,
        "surface": data.surface,
        "category": data.category or "unknown",
        "state": data.state or "unknown",
    }
    inc_counter("dmb_notification_ux_events_total", labels=labels)
    if data.duration_ms is not None:
        observe_histogram(
            "dmb_notification_ux_duration_seconds",
            data.duration_ms / 1000,
            {"event": data.event, "surface": data.surface},
        )
    return {"message": "accepted"}


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return UnreadCountResponse(count=get_unread_count(db, current_user.id, current_user))


@router.get("/notifications/summary")
def notification_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_notification_summary(db, current_user.id, current_user)


@router.put("/notifications/read")
def read_notifications(
    data: NotificationIdsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mark_read(db, data.ids, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.put("/notifications/unread")
def unread_notifications(
    data: NotificationIdsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mark_unread(db, data.ids, current_user.id)
    db.commit()
    return {"message": "ok"}


@router.put("/notifications/read-all")
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    changed_ids = mark_all_read(db, current_user.id)
    db.commit()
    return {"message": "ok", "changed_ids": changed_ids}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = dismiss_notification(db, notification_id, current_user.id)
    if result == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    if result == "mandatory_action":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Обязательное действие нельзя скрыть, пока статусы не заполнены",
        )
    db.commit()
    return {"message": "ok"}


@router.put("/notifications/{notification_id}/restore")
def restore_user_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    restore_notification(db, notification_id, current_user.id)
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
        stored = json.loads(pref.preferences)
        prefs = {"comment": stored.get("comment", True)}
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
            preferences=json.dumps(data.preferences, ensure_ascii=False),
        )
        db.add(pref)
    else:
        pref.preferences = json.dumps(data.preferences, ensure_ascii=False)
    db.commit()
    db.refresh(pref)
    try:
        stored = json.loads(pref.preferences)
        prefs = {"comment": stored.get("comment", True)}
    except (json.JSONDecodeError, TypeError):
        prefs = DEFAULT_PREFERENCES.copy()
    return NotificationPreferencesResponse(preferences=prefs)
