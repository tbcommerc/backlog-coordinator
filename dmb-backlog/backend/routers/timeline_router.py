"""
DMB Backlog - Timeline Router
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from database import get_db
from models import TimelineEvent, User
from schemas import TimelineEventCreate, TimelineEventUpdate, TimelineEventResponse, TimelineEventListResponse
from auth import get_current_user, require_permission

router = APIRouter()


@router.get("/", response_model=TimelineEventListResponse)
def get_timeline_events(
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(TimelineEvent)
    if year:
        query = query.filter(TimelineEvent.year == year)
    if quarter:
        query = query.filter(TimelineEvent.quarter == quarter)
    if month:
        query = query.filter(TimelineEvent.month == month)
    query = query.order_by(TimelineEvent.date.asc())
    items = query.all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return TimelineEventListResponse(items=result, total=len(result))


@router.get("/year/{year}", response_model=TimelineEventListResponse)
def get_events_by_year(
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    items = db.query(TimelineEvent).filter(TimelineEvent.year == year).order_by(TimelineEvent.date.asc()).all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return TimelineEventListResponse(items=result, total=len(result))


@router.get("/admin", response_model=List[TimelineEventResponse])
def get_admin_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    items = db.query(TimelineEvent).order_by(TimelineEvent.date.desc()).all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return result


@router.post("/admin", response_model=TimelineEventResponse, status_code=201)
def admin_create_event(
    data: TimelineEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    event_date = data.date
    y = data.year if data.year is not None else event_date.year
    q = data.quarter if data.quarter is not None else ((event_date.month - 1) // 3) + 1
    m = data.month if data.month is not None else event_date.month
    ev = TimelineEvent(
        title=data.title,
        description=data.description,
        event_type=data.event_type or "event",
        color=data.color or "#6366f1",
        date=event_date,
        quarter=q,
        month=m,
        year=y,
        project_id=data.project_id,
        is_recurring=data.is_recurring or False,
        recurring_interval=data.recurring_interval,
        visibility_level=data.visibility_level or "team",
        creator_id=current_user.id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.put("/admin/{event_id}", response_model=TimelineEventResponse)
def admin_update_event(
    event_id: int,
    data: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ev, key, value)
    if ev.date is not None:
        if ev.year is None:
            ev.year = ev.date.year
        if ev.quarter is None:
            ev.quarter = ((ev.date.month - 1) // 3) + 1
        if ev.month is None:
            ev.month = ev.date.month
    db.commit()
    db.refresh(ev)
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.delete("/admin/{event_id}")
def admin_delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("admin", "full"))
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(ev)
    db.commit()
    return {"message": "Event deleted", "success": True}


@router.get("/{event_id}", response_model=TimelineEventResponse)
def get_timeline_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp
